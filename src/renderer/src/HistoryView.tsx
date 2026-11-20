import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { UsageHistory, UsageSample } from "../../shared/usage";
import { nearestIndex, segments, timeTicks, type Series } from "./historyChart";

const REFRESH_MS = 60_000;
const DAY_MS = 86_400_000;
const RANGES = [
  { id: "1d", label: "24H", ms: DAY_MS },
  { id: "3d", label: "3D", ms: 3 * DAY_MS },
  { id: "7d", label: "7D", ms: 7 * DAY_MS }
] as const;

const SERIES: { id: Series; label: string }[] = [
  { id: "session", label: "Session" },
  { id: "weekly", label: "Weekly" }
];

const PAD = { top: 12, right: 14, bottom: 26, left: 42 };

export function HistoryView({ provider }: { provider: string }) {
  const [data, setData] = useState<UsageHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("7d");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setData(await window.bails.usage.history(provider));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setNow(Date.now());
  }, [provider]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    document.title = `Bails · ${data?.label ?? provider} history`;
  }, [data, provider]);

  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[2];
  const from = now - range.ms;
  const samples = (data?.samples ?? []).filter((s) => s.t >= from);

  return (
    <main className="usage history">
      <header className="history-head">
        <div className="brand-text history-title">
          <h1>{(data?.label ?? provider).toUpperCase()}</h1>
          <span className="tagline">QUOTA USED · HISTORY</span>
        </div>
        <div className="range" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className="btn small"
              aria-pressed={r.id === rangeId}
              onClick={() => setRangeId(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>
      {error ? <p className="alert">{error}</p> : null}
      <div className="legend">
        {SERIES.map((s) => (
          <span key={s.id} className="legend-item">
            <span className={`swatch swatch-${s.id}`} aria-hidden />
            {s.label} % used
          </span>
        ))}
      </div>
      <Chart samples={samples} from={from} to={now} />
      <footer className="footer">
        <span className="muted small">
          {samples.length} samples · updated {new Date(now).toLocaleTimeString()}
        </span>
      </footer>
    </main>
  );
}

function Chart({ samples, from, to }: { samples: UsageSample[]; from: number; to: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<number>(-1);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = Math.max(0, height - PAD.top - PAD.bottom);
  const x = (t: number) => PAD.left + ((t - from) / (to - from)) * plotW;
  const y = (v: number) => PAD.top + (1 - v / 100) * plotH;
  const span = to - from;
  const tickLabel = (t: number) =>
    span <= 26 * 3_600_000
      ? new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) +
        (new Date(t).getHours() !== 0 ? ` ${new Date(t).getHours()}h` : "");

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < PAD.left || px > PAD.left + plotW || plotW === 0) return setHover(-1);
    setHover(nearestIndex(samples, from + ((px - PAD.left) / plotW) * span));
  };

  const hovered = hover >= 0 ? samples[hover] : undefined;
  const fmt = (v: number | null) => (v === null ? "-" : `${Math.round(v)}%`);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {width > 0 ? (
        <svg
          className="chart"
          width={width}
          height={height}
          role="img"
          aria-label="Session and weekly quota used over time"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(-1)}
        >
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line className="gridline" x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} />
              <text className="axis-label" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
                {v}%
              </text>
            </g>
          ))}
          {timeTicks(from, to).map((t) => (
            <g key={t}>
              <line className="gridline" x1={x(t)} x2={x(t)} y1={PAD.top} y2={PAD.top + plotH} />
              <text className="axis-label" x={x(t)} y={height - 8} textAnchor="middle">
                {tickLabel(t)}
              </text>
            </g>
          ))}
          {SERIES.map((s) =>
            segments(samples, s.id).map((run) =>
              run.length === 1 ? (
                <circle key={`${s.id}-${run[0]![0]}`} className={`dot-${s.id}`} cx={x(run[0]![0])} cy={y(run[0]![1])} r={2.5} />
              ) : (
                <polyline
                  key={`${s.id}-${run[0]![0]}`}
                  className={`line line-${s.id}`}
                  points={run.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
                />
              )
            )
          )}
          {hovered ? (
            <g>
              <line className="cursor" x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={PAD.top + plotH} />
              {SERIES.map((s) =>
                hovered[s.id] !== null ? (
                  <circle key={s.id} className={`dot-${s.id}`} cx={x(hovered.t)} cy={y(hovered[s.id]!)} r={4} />
                ) : null
              )}
            </g>
          ) : null}
        </svg>
      ) : null}
      {hovered ? (
        <div
          className="tooltip"
          style={{
            top: PAD.top + 4,
            ...(x(hovered.t) > width / 2 ? { right: width - x(hovered.t) + 8 } : { left: x(hovered.t) + 8 })
          }}
        >
          <div className="muted small">
            {new Date(hovered.t).toLocaleString(undefined, {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit"
            })}
          </div>
          <div>Session {fmt(hovered.session)}</div>
          <div>Weekly {fmt(hovered.weekly)}</div>
        </div>
      ) : null}
      {samples.length === 0 ? (
        <div className="chart-empty muted">
          No data yet for this period. Samples are recorded each time usage is refreshed while Bails is running.
        </div>
      ) : null}
    </div>
  );
}
