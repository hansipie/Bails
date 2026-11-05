/** "resets in 2h 14m" / "resets in 3d 4h" / null when unknown or past. */
export function formatResetCountdown(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null;
  const ms = resetsAt - now;
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `resets in ${days}d ${hours}h`;
  if (hours > 0) return `resets in ${hours}h ${mins}m`;
  return `resets in ${mins}m`;
}

export function remainingTone(remaining: number): "danger" | "warn" | "ok" {
  if (remaining <= 0.5) return "danger";
  if (remaining <= 20) return "warn";
  return "ok";
}
