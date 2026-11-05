// Defensive helpers for reading loosely-typed JSON from credential files and usage APIs.

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function clampPercent(value: number | null): number | null {
  return value === null ? null : Math.min(100, Math.max(0, value));
}

/** Accepts epoch seconds, epoch ms or an ISO date string. */
export function asEpochMs(value: unknown): number | null {
  const num = asNumber(value);
  if (num !== null) {
    if (num <= 0) return null;
    return num < 1e12 ? num * 1000 : num;
  }
  const str = asString(value);
  if (str !== null) {
    const parsed = Date.parse(str);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function firstNumber(record: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

export function decodeJwtClaims(token: string): JsonRecord | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return asRecord(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/** Retry-After header: seconds or HTTP date. */
export function parseRetryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}
