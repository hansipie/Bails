import { describe, expect, it } from "vitest";
import {
  antigravityProvider,
  parseAntigravityModelQuota,
  parseAntigravityPlan,
  parseAntigravityQuotaSummary,
  parseAntigravitySecret
} from "./providers/antigravity";
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

describe("antigravity", () => {
  const secret = JSON.stringify({
    token: { access_token: "t", token_type: "Bearer", expiry: "2026-11-27T23:23:09.902127932+02:00" },
    auth_method: "consumer",
    id_token_email: "me@example.com"
  });

  it("parses the keyring secret, plain or go-keyring encoded", () => {
    const expected = { accessToken: "t", expiresAt: Date.parse("2026-11-27T21:23:09.902Z"), email: "me@example.com" };
    expect(parseAntigravitySecret(secret)).toEqual(expected);
    expect(parseAntigravitySecret(`go-keyring-base64:${Buffer.from(secret).toString("base64")}`)).toEqual(expected);
    expect(parseAntigravitySecret("not json")).toBeNull();
  });

  it("reports the most consumed Gemini bucket as the session window", () => {
    const w = parseAntigravityModelQuota({
      buckets: [
        { modelId: "claude-opus-5-5-high", remainingFraction: 0.1, resetTime: "2026-11-28T02:00:41Z" },
        { modelId: "gemini-3-flash", remainingFraction: 0.976909, resetTime: "2026-11-28T01:24:58Z" },
        { modelId: "gemini-4-hydrogen-sonar", remainingFraction: 0.5, resetTime: "2026-11-28T01:30:00Z" },
        { modelId: "tab_flash_lite_preview", remainingFraction: 0 }
      ]
    });
    expect(w).toEqual({ id: "session", label: "Session · Gemini", usedPercent: 50, resetsAt: Date.parse("2026-11-28T01:30:00Z") });
    expect(parseAntigravityModelQuota({ buckets: [] })).toBeNull();
  });

  it("parses grouped 5h/weekly limits and the plan", () => {
    const windows = parseAntigravityQuotaSummary({
      groups: [
        {
          displayName: "Claude and GPT models",
          buckets: [
            { bucketId: "3p-weekly", window: "weekly", resetTime: "2026-12-04T21:01:21Z", remainingFraction: 0.75 },
            { bucketId: "3p-5h", window: "5h", remainingFraction: 1 }
          ]
        }
      ]
    });
    expect(windows).toEqual([
      { id: "claude-and-gpt-models-5h", label: "Session (5h) · Claude/GPT", usedPercent: 0, resetsAt: null },
      { id: "claude-and-gpt-models-weekly", label: "Weekly · Claude/GPT", usedPercent: 25, resetsAt: Date.parse("2026-12-04T21:01:21Z") }
    ]);
    expect(parseAntigravityPlan({ currentTier: { id: "free-tier", name: "Antigravity" } })).toBe("Free");
    expect(parseAntigravityPlan({ currentTier: { id: "x" }, paidTier: { name: "Google AI Pro" } })).toBe("Google AI Pro");
  });

  it("fetches with the keyring token and an Antigravity user agent", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ctx: ProviderContext = {
      now: () => Date.parse("2026-11-27T21:00:00Z"),
      env: {},
      homeDir: "/home/x",
      readKeyring: async (service, account) => (service === "gemini" && account === "antigravity" ? secret : null),
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const body = url.endsWith(":retrieveUserQuota")
          ? { buckets: [{ modelId: "gemini-3-flash", remainingFraction: 0.8 }] }
          : url.endsWith(":loadCodeAssist")
            ? { currentTier: { id: "free-tier" } }
            : { groups: [] };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch
    };
    const snap = await antigravityProvider.fetchSnapshot(ctx);
    expect(snap).toMatchObject({ status: "ok", account: "me@example.com", plan: "Free" });
    expect(snap.windows.map((w) => [w.id, w.usedPercent])).toEqual([["session", 20]]);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.init.method).toBe("POST");
    expect(headers.Authorization).toBe("Bearer t");
    expect(headers["User-Agent"]).toMatch(/^antigravity\//);

    const expired = await antigravityProvider.fetchSnapshot({ ...ctx, now: () => Date.parse("2026-11-28T00:00:00Z") });
    expect(expired.status).toBe("unauthenticated");
    const missing = await antigravityProvider.fetchSnapshot({ ...ctx, readKeyring: async () => null });
    expect(missing.status).toBe("unauthenticated");
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
