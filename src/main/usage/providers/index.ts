import type { UsageProvider } from "../provider";
import { antigravityProvider } from "./antigravity";
import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";

/** Registered providers, in display order. Add new providers here. */
export const providers: UsageProvider[] = [claudeProvider, codexProvider, antigravityProvider];
