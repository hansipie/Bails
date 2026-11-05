// Types shared by the main process (which fetches usage) and the renderer (which shows it).

/** Provider identifier. A plain string so new providers need no change here. */
export type ProviderId = string;

export type UsageStatus = "ok" | "unauthenticated" | "error";

/** What the UI can offer to help the user fix a non-ok provider. */
export type UsageCta =
  | { kind: "terminal"; title: string; command: string }
  | null;

export interface UsageWindow {
  id: string;
  label: string;
  /** 0..100, or null when the provider only gives a reset date. */
  usedPercent: number | null;
  /** Epoch ms, or null when unknown. */
  resetsAt: number | null;
}

export interface UsageSnapshot {
  provider: ProviderId;
  label: string;
  status: UsageStatus;
  account: string | null;
  plan: string | null;
  windows: UsageWindow[];
  costUsd: number | null;
  detail: string | null;
  cta: UsageCta;
}

export interface UsageReport {
  providers: UsageSnapshot[];
  fetchedAt: number;
}

export interface UsageApi {
  get(force?: boolean): Promise<UsageReport>;
}
