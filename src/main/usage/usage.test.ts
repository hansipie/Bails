import { describe, expect, it } from "vitest";
import { parseClaudeCredentials, parseClaudeUsage } from "./providers/claude";
import { parseCodexAuth, parseCodexUsage } from "./providers/codex";
import { RateLimitError, type ProviderContext, type UsageProvider } from "./provider";
import { UsageService } from "./service";

const jwt = (claims: object) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

describe("claude", () => {
  it("parses credentials file", () => {
    const c = parseClaudeCredentials({
      claudeAiOauth: { accessToken: "a", subscriptionType: "max", expiresAt: 1_900_000_000_000 }
    });
    expect(c).toEqual({ accessToken: "a", subscriptionType: "max", expiresAt: 1_900_000_000_000 });
    expect(parseClaudeCredentials({})).toBeNull();
  });

  it("parses usage windows and extra usage", () => {
    const { windows, costUsd } = parseClaudeUsage({
      five_hour: { utilization: 42, resets_at: "2026-11-05T15:00:00Z" },
      seven_day: { utilization: 130 },
      seven_day_opus: null,
      extra_usage: { is_enabled: true, used_credits: 250, monthly_limit: 1000 }
    });
    expect(windows.map((w) => [w.id, w.usedPercent])).toEqual([
      ["session", 42],
      ["weekly", 100],
      ["extra-usage", 25]
    ]);
    expect(windows[0]!.resetsAt).toBe(Date.parse("2026-11-05T15:00:00Z"));
    expect(costUsd).toBe(2.5);
  });
});

describe("codex", () => {
  it("reads account and plan from the id_token", () => {
    const c = parseCodexAuth({
      tokens: {
        access_token: "t",
        id_token: jwt({
          email: "me@example.com",
          "https://api.openai.com/auth": { chatgpt_account_id: "acc", chatgpt_plan_type: "plus" }
        })
      }
    });
    expect(c).toEqual({ accessToken: "t", accountId: "acc", plan: "plus", email: "me@example.com" });
  });

  it("parses primary/secondary windows", () => {
    const now = 1_000_000;
    const { windows, plan } = parseCodexUsage(
      {
        plan_type: "pro",
        rate_limit: {
          primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_after_seconds: 60 },
          secondary_window: { used_percent: 55, limit_window_seconds: 604800, reset_at: 2_000_000_000 }
        }
      },
      now
    );
    expect(plan).toBe("pro");
    expect(windows).toEqual([
      { id: "session", label: "Session (5h)", usedPercent: 10, resetsAt: now + 60_000 },
      { id: "weekly", label: "Weekly", usedPercent: 55, resetsAt: 2_000_000_000_000 }
    ]);
  });
});

describe("UsageService", () => {
  it("backs off on 429 and keeps the last good snapshot", async () => {
    let t = 0;
    let calls = 0;
    let rateLimit = false;
    const fake: UsageProvider = {
      id: "fake",
      label: "Fake",
      async fetchSnapshot() {
        calls++;
        if (rateLimit) throw new RateLimitError(null);
        return { provider: "fake", label: "Fake", status: "ok", account: null, plan: null, windows: [], costUsd: null, detail: null, cta: null };
      }
    };
    const ctx = { now: () => t } as ProviderContext;
    const svc = new UsageService([fake], ctx, { cacheTtlMs: 0, formatClock: () => "clock" });

    expect((await svc.getReport(true)).providers[0]!.status).toBe("ok");
    rateLimit = true;
    const limited = (await svc.getReport(true)).providers[0]!;
    expect(limited.status).toBe("ok");
    expect(limited.detail).toContain("Rate limited");
    t += 1000; // still inside the 60s backoff: provider not called again
    await svc.getReport(true);
    expect(calls).toBe(2);
  });
});
