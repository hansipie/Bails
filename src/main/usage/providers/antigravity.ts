// Google Antigravity CLI (`agy`) usage: the Gemini models' shared quota, plus the grouped
// 5h/weekly limits of the third-party models (Claude, GPT-OSS…) when the API reports them.
// Credentials: the OS keyring entry service "gemini" / account "antigravity", written by `agy`
// at sign-in (JSON holding an OAuth token). Bails never writes it: when the token has expired
// (it lasts an hour), it runs `agy models` once, which makes agy renew and save its own token,
// then reads the keyring again. Bails never touches the refresh token itself.
//
// The Cloud Code endpoints below are the ones `agy` calls. They answer a client that does not
// identify as Antigravity as an unsupported (legacy Gemini CLI) client, hence the User-Agent.
import { join } from "node:path";
import type { UsageSnapshot, UsageWindow } from "../../../shared/usage";
import { CommandNotFoundError } from "../exec";
import { asEpochMs, asNumber, asRecord, asString, clampPercent, type JsonRecord } from "../parse";
import {
  errorSnapshot,
  isAuthRejection,
  postJson,
  type JsonResponse,
  type ProviderContext,
  type UsageProvider
} from "../provider";

export const ANTIGRAVITY_API_BASE = "https://daily-cloudcode-pa.googleapis.com/v1internal";
export const ANTIGRAVITY_KEYRING = { service: "gemini", account: "antigravity" } as const;

const USER_AGENT = `antigravity/bails ${process.platform}/${process.arch}`;
const LOGIN_CTA = { kind: "terminal", title: "Sign in to Antigravity", command: "agy" } as const;

export interface AntigravityCredentials {
  accessToken: string;
  expiresAt: number | null;
  email: string | null;
}

/** Parses the keyring secret; also accepts go-keyring's base64/hex encoded forms. */
export function parseAntigravitySecret(secret: string): AntigravityCredentials | null {
  let text = secret.trim();
  if (text.startsWith("go-keyring-base64:")) text = Buffer.from(text.slice(18), "base64").toString("utf8");
  else if (text.startsWith("go-keyring-encoded:")) text = Buffer.from(text.slice(19), "hex").toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const root = asRecord(json);
  const token = asRecord(root?.token) ?? root;
  const accessToken = asString(token?.access_token) ?? asString(token?.accessToken);
  if (!root || !token || !accessToken) return null;
  return {
    accessToken,
    expiresAt: asEpochMs(token.expiry ?? token.expiry_date ?? token.expiresAt),
    email: asString(root.id_token_email) ?? asString(root.email)
  };
}

const usedPercent = (remainingFraction: number | null): number | null =>
  remainingFraction === null ? null : clampPercent(Math.round((1 - remainingFraction) * 1000) / 10);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Gemini models share one quota: report the most consumed bucket among them as the session
 * window (it resets on a rolling ~5h basis), so history charts it like the other providers.
 */
export function parseAntigravityModelQuota(json: unknown): UsageWindow | null {
  const buckets = Array.isArray(asRecord(json)?.buckets) ? (asRecord(json)!.buckets as unknown[]) : [];
  let worst: { fraction: number; resetsAt: number | null } | null = null;
  for (const value of buckets) {
    const bucket = asRecord(value);
    const model = asString(bucket?.modelId);
    const fraction = asNumber(bucket?.remainingFraction);
    if (!bucket || !model?.startsWith("gemini-") || fraction === null) continue;
    const resetsAt = asEpochMs(bucket.resetTime);
    if (
      !worst ||
      fraction < worst.fraction ||
      (fraction === worst.fraction && resetsAt !== null && (worst.resetsAt === null || resetsAt < worst.resetsAt))
    ) {
      worst = { fraction, resetsAt };
    }
  }
  return (
    worst && { id: "session", label: "Session · Gemini", usedPercent: usedPercent(worst.fraction), resetsAt: worst.resetsAt }
  );
}

/** Same naming as the other cards: "Session (5h)" / "Weekly", sessions listed before weeklies. */
function summaryWindow(window: string | null, bucket: JsonRecord): { label: string; rank: number } {
  if (window === "5h") return { label: "Session (5h)", rank: 0 };
  if (window === "weekly") return { label: "Weekly", rank: 1 };
  return { label: window ?? asString(bucket.displayName) ?? "Limit", rank: 2 };
}

/** "Claude and GPT models" -> "Claude/GPT", to match labels like "Weekly · Sonnet". */
function shortGroupName(name: string): string {
  return name.replace(/\s+models?$/i, "").replace(/\s+and\s+/gi, "/").trim() || name;
}

/** Grouped limits (e.g. "Claude and GPT models": 5h + weekly), one window per bucket. */
export function parseAntigravityQuotaSummary(json: unknown): UsageWindow[] {
  const groups = asRecord(json)?.groups;
  if (!Array.isArray(groups)) return [];
  const windows: (UsageWindow & { rank: number })[] = [];
  for (const value of groups) {
    const group = asRecord(value);
    if (!group || !Array.isArray(group.buckets)) continue;
    const name = asString(group.displayName) ?? "Models";
    for (const b of group.buckets) {
      const bucket = asRecord(b);
      if (!bucket) continue;
      const window = asString(bucket.window);
      const { label, rank } = summaryWindow(window, bucket);
      windows.push({
        id: `${slug(name)}-${slug(window ?? asString(bucket.bucketId) ?? String(windows.length))}`,
        label: `${label} · ${shortGroupName(name)}`,
        usedPercent: usedPercent(asNumber(bucket.remainingFraction)),
        resetsAt: asEpochMs(bucket.resetTime),
        rank
      });
    }
  }
  // Stable sort: sessions first, then weeklies, groups kept in API order within each.
  return windows.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...w }) => w);
}

/** Plan name from loadCodeAssist: the paid tier when there is one, else the current tier. */
export function parseAntigravityPlan(json: unknown): string | null {
  const root = asRecord(json);
  const paid = asString(asRecord(root?.paidTier)?.name);
  if (paid) return paid;
  const current = asRecord(root?.currentTier);
  if (asString(current?.id) === "free-tier") return "Free";
  return asString(current?.name);
}

const AGY_TIMEOUT_MS = 60_000;
/** After a failed renewal, wait this long before launching agy again for the same token. */
export const AGY_RETRY_MS = 15 * 60_000;

/**
 * Lets agy renew its own token. `agy models` only lists models (no quota used), but it has to
 * sign in, so it refreshes the token and saves it to the keyring. Returns an error message, or null.
 */
async function runAgyRefresh(ctx: ProviderContext): Promise<string | null> {
  // Apps started from a desktop menu often lack ~/.local/bin in their PATH.
  for (const cmd of [join(ctx.homeDir, ".local", "bin", "agy"), "agy"]) {
    try {
      const { code } = await ctx.runCommand(cmd, ["models"], AGY_TIMEOUT_MS);
      return code === 0 ? null : `agy exited with code ${code}`;
    } catch (err) {
      if (err instanceof CommandNotFoundError) continue;
      return (err as Error).message;
    }
  }
  return "agy is not installed or not on the PATH";
}

type CredsResult = { creds: AntigravityCredentials } | { snapshot: UsageSnapshot };

function fetchQuota(ctx: ProviderContext, creds: AntigravityCredentials): Promise<JsonResponse[]> {
  const headers = { Authorization: `Bearer ${creds.accessToken}`, "User-Agent": USER_AGENT };
  return Promise.all([
    postJson(ctx, `${ANTIGRAVITY_API_BASE}:retrieveUserQuota`, headers, {}),
    postJson(ctx, `${ANTIGRAVITY_API_BASE}:retrieveUserQuotaSummary`, headers, {}),
    postJson(ctx, `${ANTIGRAVITY_API_BASE}:loadCodeAssist`, headers, {
      metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" }
    })
  ]);
}

/** A provider instance remembers its last renewal attempt, so agy is not relaunched on every refresh. */
export function createAntigravityProvider(): UsageProvider {
  let lastAttempt: { token: string; at: number } | null = null;

  const provider: UsageProvider = {
    id: "antigravity",
    label: "Antigravity",
    keepLastGoodWhenSignedOut: true,
    async fetchSnapshot(ctx: ProviderContext): Promise<UsageSnapshot> {
      const readCreds = async (): Promise<CredsResult> => {
        let secret: string | null;
        try {
          secret = await ctx.readKeyring(ANTIGRAVITY_KEYRING.service, ANTIGRAVITY_KEYRING.account);
        } catch (err) {
          return {
            snapshot: errorSnapshot(provider, "error", `Could not read the Antigravity token from the keyring: ${(err as Error).message}`)
          };
        }
        const creds = secret ? parseAntigravitySecret(secret) : null;
        return creds
          ? { creds }
          : {
              snapshot: errorSnapshot(
                provider,
                "unauthenticated",
                "No Antigravity credentials found. Sign in with the agy CLI first.",
                LOGIN_CTA
              )
            };
      };

      const first = await readCreds();
      if ("snapshot" in first) return first.snapshot;
      let creds = first.creds;
      let refreshError: string | null = null;

      /** Runs agy at most once per token (and per AGY_RETRY_MS); true when a new token was read. */
      const renew = async (): Promise<boolean> => {
        if (lastAttempt && lastAttempt.token === creds.accessToken && ctx.now() - lastAttempt.at < AGY_RETRY_MS) {
          return false;
        }
        lastAttempt = { token: creds.accessToken, at: ctx.now() };
        refreshError = await runAgyRefresh(ctx);
        if (refreshError) return false;
        const again = await readCreds();
        if ("snapshot" in again) return false;
        if (again.creds.accessToken === creds.accessToken) {
          refreshError = "agy did not renew the token";
          return false;
        }
        creds = again.creds;
        return true;
      };
      const expired = () => creds.expiresAt !== null && creds.expiresAt <= ctx.now();
      const signedOut = (reason: string) =>
        errorSnapshot(
          provider,
          "unauthenticated",
          `${reason}${refreshError ? ` and agy could not renew it (${refreshError})` : ""}. Run \`agy\` to sign in again, then refresh here.`,
          LOGIN_CTA
        );

      if (expired() && (!(await renew()) || expired())) return signedOut("Antigravity token is expired");

      let responses = await fetchQuota(ctx, creds);
      if (responses[0]!.status === 401 && (await renew())) responses = await fetchQuota(ctx, creds);
      return toSnapshot(provider, creds, responses, signedOut);
    }
  };
  return provider;
}

function toSnapshot(
  provider: UsageProvider,
  creds: AntigravityCredentials,
  [quota, summary, load]: JsonResponse[],
  signedOut: (reason: string) => UsageSnapshot
): UsageSnapshot {
  if (!quota!.ok) {
    if (quota!.status === 401) return signedOut("Antigravity rejected the token (HTTP 401)");
    const message = asString(asRecord(asRecord(quota!.json)?.error)?.message);
    return isAuthRejection(quota!.status)
      ? errorSnapshot(provider, "error", `Antigravity denied access to the quota (HTTP ${quota!.status})${message ? `: ${message}` : "."}`)
      : errorSnapshot(provider, "error", `Antigravity quota API returned HTTP ${quota!.status}.`);
  }

  const gemini = parseAntigravityModelQuota(quota!.json);
  const windows = [...(gemini ? [gemini] : []), ...(summary!.ok ? parseAntigravityQuotaSummary(summary!.json) : [])];
  return {
    provider: provider.id,
    label: provider.label,
    status: "ok",
    account: creds.email,
    plan: load!.ok ? parseAntigravityPlan(load!.json) : null,
    windows,
    costUsd: null,
    detail: windows.length === 0 ? "Connected, but no usage windows in the response." : null,
    cta: null
  };
}

export const antigravityProvider = createAntigravityProvider();
