import { useCallback, useEffect, useState } from "react";
import type { UsageCta, UsageReport, UsageSnapshot, UsageStatus, UsageWindow } from "../../shared/usage";
import { formatResetCountdown, remainingTone } from "./format";
import iconUrl from "./assets/icon.svg";
import { About } from "./About";

const AUTO_REFRESH_MS = 5 * 60_000;

export function UsageView() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const closeAbout = useCallback(() => setAboutOpen(false), []);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await window.bails.usage.get(force));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const refresh = setInterval(() => void load(false), AUTO_REFRESH_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 30_000); // keep countdowns fresh
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load]);

  return (
    <main className="usage">
      <header className="usage-header">
        <div className="brand">
          <img className="brand-icon" src={iconUrl} alt="" />
          <div className="brand-text">
            <h1>BAILS</h1>
            <span className="tagline">TOKEN WATCH</span>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="btn" onClick={() => void load(true)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button type="button" className="btn" onClick={() => setAboutOpen(true)}>
            About
          </button>
        </div>
      </header>
      {aboutOpen ? <About onClose={closeAbout} /> : null}
      {error ? <p className="alert">{error}</p> : null}
      {report?.providers.map((s) => <ProviderCard key={s.provider} snapshot={s} />)}
      <footer className="footer">
        {report ? (
          <span className="muted small">Updated {new Date(report.fetchedAt).toLocaleTimeString()}</span>
        ) : (
          <span className="blink">Insert coin…</span>
        )}
      </footer>
    </main>
  );
}

function ProviderCard({ snapshot }: { snapshot: UsageSnapshot }) {
  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <div className="row">
            <span className="name">{snapshot.label}</span>
            {snapshot.plan ? <span className="badge">{snapshot.plan}</span> : null}
          </div>
          {snapshot.account ? <BlurReveal>{snapshot.account}</BlurReveal> : null}
        </div>
        <StatusDot status={snapshot.status} />
      </div>
      {snapshot.windows.length > 0 ? (
        <div className="windows">
          {snapshot.windows.map((w) => (
            <UsageWindowRow key={w.id} window={w} />
          ))}
        </div>
      ) : null}
      {snapshot.costUsd !== null ? (
        <div className="muted small">On-demand spend ${snapshot.costUsd.toFixed(2)}</div>
      ) : null}
      {snapshot.detail ? <p className="muted">{snapshot.detail}</p> : null}
      <CtaBlock cta={snapshot.cta} />
    </section>
  );
}

function StatusDot({ status }: { status: UsageStatus }) {
  const label = status === "ok" ? "Ready" : status === "error" ? "Error" : "Offline";
  return (
    <span className="status">
      <span className={`dot dot-${status}`} aria-hidden />
      {label}
    </span>
  );
}

function UsageWindowRow({ window: win }: { window: UsageWindow }) {
  const countdown = formatResetCountdown(win.resetsAt, Date.now());
  const remaining = win.usedPercent === null ? null : 100 - win.usedPercent;
  return (
    <div className="window">
      <div className="row baseline">
        <span className="window-label">{win.label}</span>
        <span className="muted small nums">
          {remaining !== null ? `${Math.round(remaining)}% remaining` : "-"}
          {countdown ? ` · ${countdown}` : ""}
        </span>
      </div>
      {remaining !== null ? (
        <div
          className="meter"
          role="progressbar"
          aria-label={`${win.label}: ${Math.round(remaining)}% remaining`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(remaining)}
        >
          <div className={`meter-fill tone-${remainingTone(remaining)}`} style={{ width: `${remaining}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function CtaBlock({ cta }: { cta: UsageCta }) {
  const [copied, setCopied] = useState(false);
  if (!cta) return null;
  const copy = async () => {
    await navigator.clipboard.writeText(cta.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="cta">
      <p className="muted">{cta.title} in a terminal, then refresh:</p>
      <div className="copyline">
        <code>{cta.command}</code>
        <button type="button" className="btn small" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function BlurReveal({ children }: { children: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <button
      type="button"
      className={`blur-reveal ${revealed ? "" : "hidden"}`}
      title={revealed ? "Hide account email" : "Reveal account email"}
      onClick={() => setRevealed((r) => !r)}
    >
      {children}
    </button>
  );
}
