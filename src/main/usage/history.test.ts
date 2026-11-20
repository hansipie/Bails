import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UsageSnapshot } from "../../shared/usage";
import { segments, timeTicks } from "../../renderer/src/historyChart";
import { appendSample, HISTORY_RETENTION_MS, HistoryStore, sampleFromSnapshot } from "./history";
import { UsageService } from "./service";
import type { ProviderContext, UsageProvider } from "./provider";

const snap = (provider: string, session: number | null, weekly: number | null): UsageSnapshot => ({
  provider,
  label: provider,
  status: "ok",
  account: null,
  plan: null,
  windows: [
    { id: "session", label: "S", usedPercent: session, resetsAt: null },
    { id: "weekly", label: "W", usedPercent: weekly, resetsAt: null }
  ],
  costUsd: null,
  detail: null,
  cta: null
});

describe("history samples", () => {
  it("extracts session and weekly percentages from ok snapshots only", () => {
    expect(sampleFromSnapshot(snap("claude", 12, 40), 5)).toEqual({ t: 5, session: 12, weekly: 40 });
    expect(sampleFromSnapshot({ ...snap("claude", 1, 2), status: "error" }, 5)).toBeNull();
    expect(sampleFromSnapshot(snap("claude", null, null), 5)).toBeNull();
  });

  it("prunes old samples and collapses samples closer than a minute", () => {
    const now = HISTORY_RETENTION_MS + 1_000_000;
    const old = { t: 1, session: 1, weekly: 1 };
    const a = { t: now - 120_000, session: 10, weekly: 20 };
    const b = { t: now - 30_000, session: 11, weekly: 20 };
    const c = { t: now, session: 12, weekly: 21 };
    expect(appendSample([old, a], b, now)).toEqual([a, b]);
    expect(appendSample([a, b], c, now)).toEqual([a, c]);
  });
});

describe("HistoryStore", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("persists samples per provider and reloads them", async () => {
    dir = mkdtempSync(join(tmpdir(), "bails-history-"));
    const file = join(dir, "sub", "history.json");
    const now = 10 * 86_400_000;
    const store = new HistoryStore(file, () => now);
    await store.record([snap("claude", 5, 50), snap("codex", 7, null)], now - 600_000);
    await store.record([snap("claude", 9, 51)], now);
    expect(JSON.parse(readFileSync(file, "utf8")).claude).toHaveLength(2);

    const reloaded = new HistoryStore(file, () => now);
    expect(await reloaded.get("claude")).toEqual([
      { t: now - 600_000, session: 5, weekly: 50 },
      { t: now, session: 9, weekly: 51 }
    ]);
    expect(await reloaded.get("codex")).toEqual([{ t: now - 600_000, session: 7, weekly: null }]);
    expect(await reloaded.get("other")).toEqual([]);
  });

  it("starts empty when the file is corrupt", async () => {
    dir = mkdtempSync(join(tmpdir(), "bails-history-"));
    const file = join(dir, "history.json");
    writeFileSync(file, "{not json");
    expect(await new HistoryStore(file).get("claude")).toEqual([]);
  });
});

describe("UsageService fresh snapshots", () => {
  it("reports only freshly fetched ok snapshots", async () => {
    let now = 0;
    const ctx = { now: () => now } as unknown as ProviderContext;
    const ok: UsageProvider = { id: "a", label: "A", fetchSnapshot: async () => snap("a", 1, 2) } as UsageProvider;
    const seen: string[][] = [];
    const service = new UsageService([ok], ctx, {
      cacheTtlMs: 1000,
      onFreshSnapshots: (s) => seen.push(s.map((x) => x.provider))
    });
    await service.getReport();
    await service.getReport(); // cached: no new sample
    now = 5000;
    await service.getReport();
    expect(seen).toEqual([["a"], ["a"]]);
  });
});

describe("history chart helpers", () => {
  it("splits series on gaps and missing values", () => {
    const s = [
      { t: 0, session: 1, weekly: 1 },
      { t: 60_000, session: 2, weekly: null },
      { t: 120_000, session: 3, weekly: 3 },
      { t: 120_000 + 3_600_000, session: 4, weekly: 4 }
    ];
    expect(segments(s, "session")).toEqual([
      [
        [0, 1],
        [60_000, 2],
        [120_000, 3]
      ],
      [[3_720_000, 4]]
    ]);
    expect(segments(s, "weekly")).toEqual([[[0, 1]], [[120_000, 3]], [[3_720_000, 4]]]);
  });

  it("puts one tick per day on a 7 day range", () => {
    const to = new Date(2026, 10, 20, 15).getTime();
    const ticks = timeTicks(to - 7 * 86_400_000, to);
    expect(ticks).toHaveLength(7);
    expect(ticks.every((t) => new Date(t).getHours() === 0)).toBe(true);
  });
});
