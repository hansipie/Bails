// Codex (ChatGPT plan) usage: primary (session) and secondary (weekly) rate-limit windows.
// Credentials: $CODEX_HOME/auth.json (default ~/.codex), written by `codex login`.
// Read-only: the file is never rewritten and tokens are never refreshed.
import { join } from "node:path";
import type { UsageSnapshot, UsageWindow } from "../../../shared/usage";
import { asEpochMs, asRecord, asString, clampPercent, decodeJwtClaims, firstNumber } from "../parse";
import {
  errorSnapshot,
  getJson,
  isAuthRejection,
  readJsonFile,
  type ProviderContext,
  type UsageProvider
} from "../provider";

export const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";

const LOGIN_CTA = { kind: "terminal", title: "Sign in to Codex", command: "codex login" } as const;

export interface CodexCredentials {
  accessToken: string;
  accountId: string | null;
  plan: string | null;
  email: string | null;
}

export function parseCodexAuth(json: unknown): CodexCredentials | null {
  const tokens = asRecord(asRecord(json)?.tokens);
  if (!tokens) return null;
  const accessToken = asString(tokens.access_token) ?? asString(tokens.accessToken);
  if (!accessToken) return null;

  let accountId = asString(tokens.account_id) ?? asString(tokens.accountId);
  let plan: string | null = null;
  let email: string | null = null;
  const idToken = asString(tokens.id_token) ?? asString(tokens.idToken);
  const claims = idToken ? decodeJwtClaims(idToken) : null;
  if (claims) {
    email = asString(claims.email);
    const auth = asRecord(claims["https://api.openai.com/auth"]);
    if (auth) {
      accountId ??= asString(auth.chatgpt_account_id);
      plan = asString(auth.chatgpt_plan_type);
    }
  }
  return { accessToken, accountId, plan, email };
}

function windowLabel(id: string, windowSeconds: number | null): string {
  if (windowSeconds !== null) {
    const hours = windowSeconds / 3600;
    if (hours <= 12) return `Session (${Math.round(hours)}h)`;
    return hours / 24 <= 10 ? "Weekly" : "Monthly";
  }
  return id === "session" ? "Session" : "Weekly";
}

function codexWindow(id: string, value: unknown, now: number): UsageWindow | null {
  const record = asRecord(value);
  if (!record) return null;
  const minutes = firstNumber(record, ["window_minutes", "limit_window_minutes"]);
  const windowSeconds =
    firstNumber(record, ["limit_window_seconds", "window_seconds"]) ?? (minutes !== null ? minutes * 60 : null);
  let resetsAt = asEpochMs(record.reset_at ?? record.resets_at ?? record.resetsAt);
  if (resetsAt === null) {
    const resetIn = firstNumber(record, ["resets_in_seconds", "reset_after_seconds"]);
    if (resetIn !== null) resetsAt = now + resetIn * 1000;
  }
  return {
    id,
    label: windowLabel(id, windowSeconds),
    usedPercent: clampPercent(
      firstNumber(record, ["used_percent", "usedPercent", "percent_used", "usage_percent", "utilization"])
    ),
    resetsAt
  };
}

export function parseCodexUsage(json: unknown, now: number): { windows: UsageWindow[]; plan: string | null } {
  const root = asRecord(json) ?? {};
  const rateLimit = asRecord(root.rate_limit) ?? asRecord(root.rate_limits) ?? root;
  const windows = [
    codexWindow("session", rateLimit.primary_window ?? rateLimit.primary, now),
    codexWindow("weekly", rateLimit.secondary_window ?? rateLimit.secondary, now)
  ].filter((w): w is UsageWindow => w !== null);
  return { windows, plan: asString(root.plan_type) };
}

export const codexProvider: UsageProvider = {
  id: "codex",
  label: "Codex",
  async fetchSnapshot(ctx: ProviderContext): Promise<UsageSnapshot> {
    const dir = ctx.env.CODEX_HOME ?? join(ctx.homeDir, ".codex");
    const file = join(dir, "auth.json");

    let raw: unknown;
    try {
      raw = await readJsonFile(file);
    } catch (err) {
      return errorSnapshot(this, "error", `Could not read ${file}: ${(err as Error).message}`);
    }
    const creds = raw ? parseCodexAuth(raw) : null;
    if (!creds) {
      return errorSnapshot(this, "unauthenticated", "No Codex credentials found. Sign in with the codex CLI first.", LOGIN_CTA);
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${creds.accessToken}` };
    if (creds.accountId) headers["chatgpt-account-id"] = creds.accountId;
    const usage = await getJson(ctx, CODEX_USAGE_ENDPOINT, headers);
    if (!usage.ok) {
      return isAuthRejection(usage.status)
        ? errorSnapshot(
            this,
            "unauthenticated",
            "Codex token was rejected. Run `codex` once (it refreshes its token) or `codex login`, then refresh here.",
            LOGIN_CTA
          )
        : errorSnapshot(this, "error", `Codex usage API returned HTTP ${usage.status}.`);
    }

    const { windows, plan } = parseCodexUsage(usage.json, ctx.now());
    return {
      provider: this.id,
      label: this.label,
      status: "ok",
      account: creds.email,
      plan: plan ?? creds.plan,
      windows,
      costUsd: null,
      detail: windows.length === 0 ? "Connected, but no usage windows in the response." : null,
      cta: null
    };
  }
};
