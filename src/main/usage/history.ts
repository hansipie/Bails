// Persists quota samples over time so the history window can chart them.
// Stored as one small JSON file in the app's userData directory, pruned on write.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderId, UsageSample, UsageSnapshot } from "../../shared/usage";

/** Samples older than this are dropped. */
export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** A new sample closer than this to the previous one replaces it instead of being appended. */
export const HISTORY_MIN_INTERVAL_MS = 60_000;

type HistoryData = Record<ProviderId, UsageSample[]>;

const percentOf = (snapshot: UsageSnapshot, id: string): number | null =>
  snapshot.windows.find((w) => w.id === id)?.usedPercent ?? null;

export function sampleFromSnapshot(snapshot: UsageSnapshot, t: number): UsageSample | null {
  if (snapshot.status !== "ok") return null;
  const sample = { t, session: percentOf(snapshot, "session"), weekly: percentOf(snapshot, "weekly") };
  return sample.session === null && sample.weekly === null ? null : sample;
}

/** Returns a new list with `sample` added, sorted, de-duplicated and pruned. */
export function appendSample(samples: UsageSample[], sample: UsageSample, now: number): UsageSample[] {
  const cutoff = now - HISTORY_RETENTION_MS;
  const kept = samples.filter((s) => s.t >= cutoff && s.t <= sample.t);
  const last = kept[kept.length - 1];
  if (last && sample.t - last.t < HISTORY_MIN_INTERVAL_MS) kept.pop();
  kept.push(sample);
  return kept;
}

function sanitize(value: unknown): HistoryData {
  const out: HistoryData = {};
  if (!value || typeof value !== "object") return out;
  for (const [id, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    out[id] = list
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof s.t === "number")
      .map((s) => ({ t: s.t as number, session: pct(s.session), weekly: pct(s.weekly) }))
      .sort((a, b) => a.t - b.t);
  }
  return out;
}

export class HistoryStore {
  private data: HistoryData | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now
  ) {}

  private async load(): Promise<HistoryData> {
    if (this.data) return this.data;
    let loaded: HistoryData = {};
    try {
      loaded = sanitize(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch {
      // Missing or corrupt file: start a fresh history.
    }
    this.data ??= loaded;
    return this.data;
  }

  async get(provider: ProviderId): Promise<UsageSample[]> {
    const data = await this.load();
    const cutoff = this.now() - HISTORY_RETENTION_MS;
    return (data[provider] ?? []).filter((s) => s.t >= cutoff);
  }

  async record(snapshots: UsageSnapshot[], t: number): Promise<void> {
    const data = await this.load();
    let changed = false;
    for (const snapshot of snapshots) {
      const sample = sampleFromSnapshot(snapshot, t);
      if (!sample) continue;
      data[snapshot.provider] = appendSample(data[snapshot.provider] ?? [], sample, this.now());
      changed = true;
    }
    if (changed) await this.save(data);
  }

  private save(data: HistoryData): Promise<void> {
    // Serialize writes; write to a temp file then rename so a crash never leaves a half file.
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await writeFile(tmp, JSON.stringify(data), "utf8");
        await rename(tmp, this.filePath);
      });
    return this.writing;
  }
}
