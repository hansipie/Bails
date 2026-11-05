/// <reference types="vite/client" />
import type { UsageApi } from "../../shared/usage";

declare global {
  /** Injected at build time from package.json (see electron.vite.config.ts). */
  const __APP_VERSION__: string;

  interface Window {
    bails: { usage: UsageApi };
  }
}

export {};
