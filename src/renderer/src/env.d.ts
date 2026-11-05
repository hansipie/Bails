/// <reference types="vite/client" />
import type { UsageApi } from "../../shared/usage";

declare global {
  interface Window {
    bails: { usage: UsageApi };
  }
}

export {};
