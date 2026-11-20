// Pure helpers for the history chart (kept free of React/DOM so they can be unit tested).
import type { UsageSample } from "../../shared/usage";

/** Two samples further apart than this are not joined (the app was closed or offline). */
export const GAP_MS = 20 * 60_000;

export type Series = "session" | "weekly";

/** Splits the samples of one series into continuous runs of [t, value] points. */
export function segments(samples: UsageSample[], series: Series, gapMs = GAP_MS): [number, number][][] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  let lastT = -Infinity;
  for (const s of samples) {
    const v = s[series];
    if (v === null || s.t - lastT > gapMs) {
      if (run.length > 0) runs.push(run);
      run = [];
    }
    if (v !== null) {
      run.push([s.t, v]);
      lastT = s.t;
    } else {
      lastT = -Infinity;
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/** Index of the sample closest in time to `t`, or -1 when there is none. */
export function nearestIndex(samples: UsageSample[], t: number): number {
  let best = -1;
  let bestDist = Infinity;
  samples.forEach((s, i) => {
    const d = Math.abs(s.t - t);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

/** Tick positions (epoch ms) at local midnights, or every few hours for short ranges. */
export function timeTicks(from: number, to: number): number[] {
  const span = to - from;
  const stepHours = span <= 26 * 3_600_000 ? 4 : span <= 4 * 86_400_000 ? 12 : 24;
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  d.setHours(Math.ceil(d.getHours() / stepHours) * stepHours);
  const ticks: number[] = [];
  while (d.getTime() <= to) {
    if (d.getTime() >= from) ticks.push(d.getTime());
    d.setHours(d.getHours() + stepHours);
  }
  return ticks;
}
