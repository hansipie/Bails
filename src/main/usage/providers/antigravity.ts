// Google Antigravity CLI (`agy`) usage: the Gemini models' shared quota, plus the grouped
// 5h/weekly limits of the third-party models (Claude, GPT-OSS…) when the API reports them.
// Credentials: the OS keyring entry service "gemini" / account "antigravity", written by `agy`
// at sign-in (JSON holding an OAuth token). Read-only: an expired token is reported, never refreshed.
//
// The Cloud Code endpoints below are the ones `agy` calls. They answer a client that does not
// identify as Antigravity as an unsupported (legacy Gemini CLI) client, hence the User-Agent.
import type { UsageSnapshot, UsageWindow } from "../../../shared/usage";
import { asEpochMs, asNumber, asRecord, asString, clampPercent, type JsonRecord } from "../parse";
import { errorSnapshot, isAuthRejection, postJson, type ProviderContext, type UsageProvider } from "../provider";

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
  return worst && { id: "session", label: "Gemini models", usedPercent: usedPercent(worst.fraction), resetsAt: worst.resetsAt };
}

function summaryWindowLabel(window: string | null, bucket: JsonRecord): string {
  if (window === "5h") return "5h";
  if (window === "weekly") return "Weekly";
  return window ?? asString(bucket.displayName) ?? "Limit";
}

/** Grouped limits (e.g. "Claude and GPT models": 5h + weekly), one window per bucket. */
export function parseAntigravityQuotaSummary(json: unknown): UsageWindow[] {
  const groups = asRecord(json)?.groups;
  if (!Array.isArray(groups)) return [];
  const windows: UsageWindow[] = [];
  for (const value of groups) {
    const group = asRecord(value);
    if (!group || !Array.isArray(group.buckets)) continue;
    const name = asString(group.displayName) ?? "Models";
    for (const b of group.buckets) {
      const bucket = asRecord(b);
      if (!bucket) continue;
      const window = asString(bucket.window);
      windows.push({
        id: `${slug(name)}-${slug(window ?? asString(bucket.bucketId) ?? String(windows.length))}`,
        label: `${name} · ${summaryWindowLabel(window, bucket)}`,
        usedPercent: usedPercent(asNumber(bucket.remainingFraction)),
        resetsAt: asEpochMs(bucket.resetTime)
      });
    }
  }
  return windows;
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

export const antigravityProvider: UsageProvider = {
  id: "antigravity",
  label: "Antigravity",
  async fetchSnapshot(ctx: ProviderContext): Promise<UsageSnapshot> {
    let secret: string | null;
    try {
      secret = await ctx.readKeyring(ANTIGRAVITY_KEYRING.service, ANTIGRAVITY_KEYRING.account);
    } catch (err) {
      return errorSnapshot(this, "error", `Could not read the Antigravity token from the keyring: ${(err as Error).message}`);
    }
    const creds = secret ? parseAntigravitySecret(secret) : null;
    if (!creds) {
      return errorSnapshot(this, "unauthenticated", "No Antigravity credentials found. Sign in with the agy CLI first.", LOGIN_CTA);
    }
    if (creds.expiresAt !== null && creds.expiresAt < ctx.now()) {
      return errorSnapshot(
        this,
        "unauthenticated",
        "Antigravity token is expired. Run `agy` once to refresh it, then refresh here.",
        LOGIN_CTA
      );
    }

    const headers = { Authorization: `Bearer ${creds.accessToken}`, "User-Agent": USER_AGENT };
    const [quota, summary, load] = await Promise.all([
      postJson(ctx, `${ANTIGRAVITY_API_BASE}:retrieveUserQuota`, headers, {}),
      postJson(ctx, `${ANTIGRAVITY_API_BASE}:retrieveUserQuotaSummary`, headers, {}),
      postJson(ctx, `${ANTIGRAVITY_API_BASE}:loadCodeAssist`, headers, {
        metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" }
      })
    ]);
    if (!quota.ok) {
      if (quota.status === 401) {
        return errorSnapshot(this, "unauthenticated", "Antigravity rejected the token (HTTP 401). Run `agy` once, then refresh here.", LOGIN_CTA);
      }
      const message = asString(asRecord(asRecord(quota.json)?.error)?.message);
      return isAuthRejection(quota.status)
        ? errorSnapshot(this, "error", `Antigravity denied access to the quota (HTTP ${quota.status})${message ? `: ${message}` : "."}`)
        : errorSnapshot(this, "error", `Antigravity quota API returned HTTP ${quota.status}.`);
    }

    const gemini = parseAntigravityModelQuota(quota.json);
    const windows = [...(gemini ? [gemini] : []), ...(summary.ok ? parseAntigravityQuotaSummary(summary.json) : [])];
    return {
      provider: this.id,
      label: this.label,
      status: "ok",
      account: creds.email,
      plan: load.ok ? parseAntigravityPlan(load.json) : null,
      windows,
      costUsd: null,
      detail: windows.length === 0 ? "Connected, but no usage windows in the response." : null,
      cta: null
    };
  }
};
