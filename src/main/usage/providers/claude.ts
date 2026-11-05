// Claude Code subscription usage (5h session + weekly windows).
// Credentials: $CLAUDE_CONFIG_DIR/.credentials.json (default ~/.claude), written by `claude auth login`.
// Read-only: an expired token is reported, never refreshed.
import { join } from "node:path";
import type { UsageSnapshot, UsageWindow } from "../../../shared/usage";
import { asEpochMs, asRecord, asString, clampPercent, firstNumber } from "../parse";
import {
  errorSnapshot,
  getJson,
  isAuthRejection,
  readJsonFile,
  type ProviderContext,
  type UsageProvider
} from "../provider";

export const CLAUDE_USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";

const LOGIN_CTA = { kind: "terminal", title: "Sign in to Claude Code", command: "claude auth login" } as const;

export interface ClaudeCredentials {
  accessToken: string;
  subscriptionType: string | null;
  expiresAt: number | null;
}

export function parseClaudeCredentials(json: unknown): ClaudeCredentials | null {
  const root = asRecord(json);
  const oauth = asRecord(root?.claudeAiOauth) ?? root;
  if (!oauth) return null;
  const accessToken = asString(oauth.accessToken) ?? asString(oauth.access_token);
  if (!accessToken) return null;
  return {
    accessToken,
    subscriptionType: asString(oauth.subscriptionType) ?? asString(oauth.subscription_type),
    expiresAt: asEpochMs(oauth.expiresAt ?? oauth.expires_at)
  };
}

function claudeWindow(id: string, label: string, value: unknown): UsageWindow | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    id,
    label,
    usedPercent: clampPercent(firstNumber(record, ["utilization", "used_percent", "usage"])),
    resetsAt: asEpochMs(record.resets_at ?? record.resetsAt)
  };
}

export function parseClaudeUsage(json: unknown): { windows: UsageWindow[]; costUsd: number | null } {
  const root = asRecord(json) ?? {};
  const windows = [
    claudeWindow("session", "Session (5h)", root.five_hour),
    claudeWindow("weekly", "Weekly · all models", root.seven_day),
    claudeWindow("weekly-sonnet", "Weekly · Sonnet", root.seven_day_sonnet),
    claudeWindow("weekly-opus", "Weekly · Opus", root.seven_day_opus)
  ].filter((w): w is UsageWindow => w !== null);

  let costUsd: number | null = null;
  const extra = asRecord(root.extra_usage);
  if (extra) {
    const cents = firstNumber(extra, ["used_cents", "spend_cents", "monthly_spend_cents", "used_credits"]);
    const limitCents = firstNumber(extra, ["monthly_limit", "limit_cents", "monthly_limit_cents", "spend_limit_cents"]);
    costUsd = cents !== null ? cents / 100 : firstNumber(extra, ["used_usd", "spend_usd", "amount_spent"]);
    const utilization =
      clampPercent(firstNumber(extra, ["utilization", "used_percent", "usage"])) ??
      (cents !== null && limitCents !== null && limitCents > 0 ? clampPercent((cents / limitCents) * 100) : null);
    if (extra.is_enabled !== false && extra.enabled !== false && utilization !== null) {
      windows.push({
        id: "extra-usage",
        label:
          cents !== null && limitCents !== null
            ? `Extra usage ($${(cents / 100).toFixed(2)} / $${(limitCents / 100).toFixed(2)})`
            : "Extra usage",
        usedPercent: utilization,
        resetsAt: asEpochMs(extra.resets_at ?? extra.resetsAt)
      });
    }
  }
  return { windows, costUsd };
}

export const claudeProvider: UsageProvider = {
  id: "claude",
  label: "Claude Code",
  async fetchSnapshot(ctx: ProviderContext): Promise<UsageSnapshot> {
    const dir = ctx.env.CLAUDE_CONFIG_DIR ?? join(ctx.homeDir, ".claude");
    const file = join(dir, ".credentials.json");

    let raw: unknown;
    try {
      raw = await readJsonFile(file);
    } catch (err) {
      return errorSnapshot(this, "error", `Could not read ${file}: ${(err as Error).message}`);
    }
    const creds = raw ? parseClaudeCredentials(raw) : null;
    if (!creds) {
      return errorSnapshot(this, "unauthenticated", "No Claude Code credentials found. Sign in with the claude CLI first.", LOGIN_CTA);
    }
    if (creds.expiresAt !== null && creds.expiresAt < ctx.now()) {
      return errorSnapshot(
        this,
        "unauthenticated",
        "Claude Code OAuth token is expired. Run `claude` once to refresh it, then refresh here.",
        LOGIN_CTA
      );
    }

    const usage = await getJson(ctx, CLAUDE_USAGE_ENDPOINT, {
      Authorization: `Bearer ${creds.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20"
    });
    if (!usage.ok) {
      return isAuthRejection(usage.status)
        ? errorSnapshot(this, "unauthenticated", `Claude rejected the token (HTTP ${usage.status}).`, LOGIN_CTA)
        : errorSnapshot(this, "error", `Claude usage API returned HTTP ${usage.status}.`);
    }

    const { windows, costUsd } = parseClaudeUsage(usage.json);
    return {
      provider: this.id,
      label: this.label,
      status: "ok",
      account: null,
      plan: creds.subscriptionType,
      windows,
      costUsd,
      detail: windows.length === 0 ? "Connected, but no usage windows in the response." : null,
      cta: null
    };
  }
};
