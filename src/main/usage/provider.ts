import { readFile } from "node:fs/promises";
import type { ProviderId, UsageCta, UsageSnapshot } from "../../shared/usage";
import { asRecord, parseRetryAfterMs } from "./parse";

/**
 * A usage provider. To add one: create a file in ./providers exporting a
 * UsageProvider, then add it to the list in ./providers/index.ts.
 *
 * fetchSnapshot returns a snapshot for every expected outcome (ok, signed out,
 * HTTP error). It throws RateLimitError on HTTP 429 so the service can back off
 * and keep showing the last good snapshot.
 */
export interface UsageProvider {
  id: ProviderId;
  label: string;
  fetchSnapshot(ctx: ProviderContext): Promise<UsageSnapshot>;
}

export interface ProviderContext {
  now(): number;
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs: number | null) {
    super("rate limited");
  }
}

export function errorSnapshot(
  provider: Pick<UsageProvider, "id" | "label">,
  status: "unauthenticated" | "error",
  detail: string,
  cta: UsageCta = null
): UsageSnapshot {
  return {
    provider: provider.id,
    label: provider.label,
    status,
    account: null,
    plan: null,
    windows: [],
    costUsd: null,
    detail,
    cta
  };
}

/** Reads a JSON file. Returns null if absent; throws if present but unreadable/invalid. */
export async function readJsonFile(path: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(text);
}

export interface JsonResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

const REQUEST_TIMEOUT_MS = 15_000;

/** GET a JSON endpoint; throws RateLimitError on 429. */
export async function getJson(
  ctx: ProviderContext,
  url: string,
  headers: Record<string, string>
): Promise<JsonResponse> {
  const res = await ctx.fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (res.status === 429) {
    throw new RateLimitError(parseRetryAfterMs(res.headers.get("retry-after"), ctx.now()));
  }
  let json: unknown = null;
  try {
    json = asRecord(await res.json());
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

export function isAuthRejection(status: number): boolean {
  return status === 401 || status === 403;
}
