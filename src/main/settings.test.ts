import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UsageSnapshot } from "../shared/usage";
import type { ProviderContext, UsageProvider } from "./usage/provider";
import { UsageService } from "./usage/service";
import { sanitizeSettings, SettingsStore } from "./settings";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "bails-settings-"));
  dirs.push(d);
  return join(d, "settings.json");
};

describe("settings", () => {
  it("sanitizes garbage input", () => {
    expect(sanitizeSettings(null)).toEqual({ hiddenProviders: [], launchAtLogin: true });
    expect(sanitizeSettings({ hiddenProviders: ["a", 3, "", "a", "b"], launchAtLogin: "no" })).toEqual({
      hiddenProviders: ["a", "b"],
      launchAtLogin: true
    });
  });

  it("persists hidden providers across instances and tolerates a corrupt file", async () => {
    const file = tmp();
    expect(await new SettingsStore(file).getHidden()).toEqual([]);
    await new SettingsStore(file).setHidden(["codex"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ hiddenProviders: ["codex"], launchAtLogin: true });
    expect(await new SettingsStore(file).getHidden()).toEqual(["codex"]);
    writeFileSync(file, "{nope");
    expect(await new SettingsStore(file).getHidden()).toEqual([]);
  });

  it("keeps launch-at-login and hidden providers independent", async () => {
    const file = tmp();
    const store = new SettingsStore(file);
    expect(await store.getLaunchAtLogin()).toBe(true);
    await store.setHidden(["codex"]);
    await store.setLaunchAtLogin(false);
    const reloaded = new SettingsStore(file);
    expect(await reloaded.getLaunchAtLogin()).toBe(false);
    expect(await reloaded.getHidden()).toEqual(["codex"]);
  });
});

describe("UsageService hidden providers", () => {
  const ctx: ProviderContext = {
    now: () => 1000,
    fetch: (() => Promise.reject(new Error("no"))) as never,
    env: {},
    homeDir: "/",
    readKeyring: async () => null
  } as never;
  const make = (id: string, calls: string[]): UsageProvider => ({
    id,
    label: id.toUpperCase(),
    fetchSnapshot: async () => {
      calls.push(id);
      return { provider: id, label: id, status: "ok", account: null, plan: null, windows: [], costUsd: null, detail: null, cta: null } as UsageSnapshot;
    }
  }) as never;

  it("skips hidden providers, lists them, and brings them back", async () => {
    const calls: string[] = [];
    const service = new UsageService([make("a", calls), make("b", calls)], ctx);
    service.setHidden(["b"]);
    const report = await service.getReport();
    expect(report.providers.map((p) => p.provider)).toEqual(["a"]);
    expect(report.hidden).toEqual([{ provider: "b", label: "B" }]);
    expect(calls).toEqual(["a"]);

    service.setHidden([]);
    const again = await service.getReport();
    expect(again.providers.map((p) => p.provider)).toEqual(["a", "b"]);
    expect(again.hidden).toEqual([]);
  });
});
