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
}

const defaultFormatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export class UsageService {
  private cached: UsageReport | null = null;
  private inFlight: Promise<UsageReport> | null = null;
  private readonly resilience = new Map<ProviderId, Resilience>();
  private readonly cacheTtlMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly formatClock: (ms: number) => string;

  constructor(
    private readonly providers: UsageProvider[],
    private readonly ctx: ProviderContext,
    options: UsageServiceOptions = {}
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 2 * 60_000;
    this.minBackoffMs = options.minBackoffMs ?? 60_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 15 * 60_000;
    this.formatClock = options.formatClock ?? defaultFormatClock;
  }

  async getReport(force = false): Promise<UsageReport> {
    if (this.inFlight) return this.inFlight;
    if (!force && this.cached && this.ctx.now() - this.cached.fetchedAt < this.cacheTtlMs) {
      return this.cached;
    }
    const promise = (async () => {
      const snapshots = await Promise.all(this.providers.map((p) => this.fetchOne(p)));
      const report: UsageReport = { providers: snapshots, fetchedAt: this.ctx.now() };
      this.cached = report;
      return report;
    })();
    this.inFlight = promise;
    try {
      return await promise;
    } finally {
      this.inFlight = null;
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

  private async fetchOne(provider: UsageProvider): Promise<UsageSnapshot> {
    const s = this.state(provider.id);
    if (this.ctx.now() < s.blockedUntil) return this.rateLimited(provider, s);
    try {
      const snapshot = await provider.fetchSnapshot(this.ctx);
      if (snapshot.status === "ok") {
        s.lastGood = snapshot;
        s.lastGoodAt = this.ctx.now();
        s.blockedUntil = 0;
        s.backoffMs = 0;
      }
      return snapshot;
    } catch (err) {
      if (err instanceof RateLimitError) {
        s.backoffMs = Math.min(Math.max(s.backoffMs * 2, this.minBackoffMs), this.maxBackoffMs);
        s.blockedUntil = this.ctx.now() + Math.max(err.retryAfterMs ?? 0, s.backoffMs);
        return this.rateLimited(provider, s);
      }
      return errorSnapshot(provider, "error", err instanceof Error ? err.message : String(err));
    }
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
