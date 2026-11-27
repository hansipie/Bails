// Aggregates all providers into one report, with a short cache, in-flight
// de-duplication and per-provider exponential backoff on HTTP 429.
import type { ProviderId, UsageReport, UsageSnapshot } from "../../shared/usage";
import { errorSnapshot, RateLimitError, type ProviderContext, type UsageProvider } from "./provider";

interface Resilience {
  lastGood: UsageSnapshot | null;
  lastGoodAt: number;
  blockedUntil: number;
  backoffMs: number;
}

export interface UsageServiceOptions {
  cacheTtlMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  formatClock?: (ms: number) => string;
  /** Called with the snapshots actually fetched (not cached or rate-limited copies) on each report. */
  onFreshSnapshots?: (snapshots: UsageSnapshot[], fetchedAt: number) => void;
}

const defaultFormatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export class UsageService {
  private cached: UsageReport | null = null;
  private inFlight: Promise<UsageReport> | null = null;
  private hidden = new Set<ProviderId>();
  private generation = 0;
  private readonly resilience = new Map<ProviderId, Resilience>();
  private readonly cacheTtlMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly formatClock: (ms: number) => string;
  private readonly onFreshSnapshots: UsageServiceOptions["onFreshSnapshots"];

  constructor(
    private readonly providers: UsageProvider[],
    private readonly ctx: ProviderContext,
    options: UsageServiceOptions = {}
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 2 * 60_000;
    this.minBackoffMs = options.minBackoffMs ?? 60_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 15 * 60_000;
    this.formatClock = options.formatClock ?? defaultFormatClock;
    this.onFreshSnapshots = options.onFreshSnapshots;
  }

  getHidden(): ProviderId[] {
    return [...this.hidden];
  }

  /** Hidden providers are not fetched at all and are listed in `report.hidden` instead. */
  setHidden(ids: ProviderId[]): void {
    this.hidden = new Set(ids);
    this.generation++;
    this.cached = null;
    this.inFlight = null;
  }

  async getReport(force = false): Promise<UsageReport> {
    if (this.inFlight) return this.inFlight;
    if (!force && this.cached && this.ctx.now() - this.cached.fetchedAt < this.cacheTtlMs) {
      return this.cached;
    }
    const generation = this.generation;
    const promise = (async () => {
      const results = await Promise.all(this.providers.filter((p) => !this.hidden.has(p.id)).map((p) => this.fetchOne(p)));
      const report: UsageReport = {
        providers: results.map((r) => r.snapshot),
        hidden: this.providers.filter((p) => this.hidden.has(p.id)).map((p) => ({ provider: p.id, label: p.label })),
        fetchedAt: this.ctx.now()
      };
      if (generation === this.generation) this.cached = report;
      const fresh = results.filter((r) => r.fresh).map((r) => r.snapshot);
      if (fresh.length > 0) this.onFreshSnapshots?.(fresh, report.fetchedAt);
      return report;
    })();
    this.inFlight = promise;
    try {
      return await promise;
    } finally {
      if (this.inFlight === promise) this.inFlight = null;
    }
  }

  private state(id: ProviderId): Resilience {
    let s = this.resilience.get(id);
    if (!s) {
      s = { lastGood: null, lastGoodAt: 0, blockedUntil: 0, backoffMs: 0 };
      this.resilience.set(id, s);
    }
    return s;
  }

  private async fetchOne(provider: UsageProvider): Promise<{ snapshot: UsageSnapshot; fresh: boolean }> {
    const s = this.state(provider.id);
    if (this.ctx.now() < s.blockedUntil) return { snapshot: this.rateLimited(provider, s), fresh: false };
    try {
      const snapshot = await provider.fetchSnapshot(this.ctx);
      if (snapshot.status === "ok") {
        s.lastGood = snapshot;
        s.lastGoodAt = this.ctx.now();
        s.blockedUntil = 0;
        s.backoffMs = 0;
      } else if (snapshot.status === "unauthenticated" && provider.keepLastGoodWhenSignedOut && s.lastGood) {
        return { snapshot: this.stale(snapshot, s.lastGood, s.lastGoodAt), fresh: false };
      }
      return { snapshot, fresh: snapshot.status === "ok" };
    } catch (err) {
      if (err instanceof RateLimitError) {
        s.backoffMs = Math.min(Math.max(s.backoffMs * 2, this.minBackoffMs), this.maxBackoffMs);
        s.blockedUntil = this.ctx.now() + Math.max(err.retryAfterMs ?? 0, s.backoffMs);
        return { snapshot: this.rateLimited(provider, s), fresh: false };
      }
      return {
        snapshot: errorSnapshot(provider, "error", err instanceof Error ? err.message : String(err)),
        fresh: false
      };
    }
  }

  /** Last good gauges, but with the current status, explanation and sign-in command. */
  private stale(current: UsageSnapshot, lastGood: UsageSnapshot, lastGoodAt: number): UsageSnapshot {
    const note = `Showing usage from ${this.formatClock(lastGoodAt)}.`;
    return {
      ...lastGood,
      status: current.status,
      detail: current.detail ? `${current.detail} ${note}` : note,
      cta: current.cta
    };
  }

  private rateLimited(provider: UsageProvider, s: Resilience): UsageSnapshot {
    if (s.lastGood) {
      return { ...s.lastGood, detail: `Rate limited; showing usage from ${this.formatClock(s.lastGoodAt)}.` };
    }
    return errorSnapshot(
      provider,
      "error",
      `Rate limited (HTTP 429). Retrying after ${this.formatClock(s.blockedUntil)}.`
    );
  }
}
