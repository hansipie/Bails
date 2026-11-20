import { app, BrowserWindow, ipcMain, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UsageHistory } from "../shared/usage";
import { HistoryStore } from "./usage/history";
import { providers } from "./usage/providers";
import { UsageService } from "./usage/service";

/** Background refresh so history keeps accumulating whatever window is open (the service caches). */
const BACKGROUND_REFRESH_MS = 5 * 60_000;

let history: HistoryStore | null = null;

const usage = new UsageService(
  providers,
  {
    now: () => Date.now(),
    fetch: globalThis.fetch.bind(globalThis),
    env: process.env,
    homeDir: homedir()
  },
  {
    onFreshSnapshots: (snapshots, fetchedAt) => {
      history?.record(snapshots, fetchedAt).catch((err) => console.error("Failed to save usage history:", err));
    }
  }
);

const historyWindows = new Map<string, BrowserWindow>();

function buildWindow(options: { width: number; height: number; minWidth: number; minHeight?: number; title: string }) {
  const win = new BrowserWindow({
    ...options,
    autoHideMenuBar: true,
    backgroundColor: "#4b4f93",
    icon: join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  // Open external links in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}

function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(hash ? `${process.env.ELECTRON_RENDERER_URL}#${hash}` : process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"), hash ? { hash } : undefined);
  }
}

function createWindow(): void {
  loadRenderer(buildWindow({ width: 420, height: 640, minWidth: 320, title: "Bails" }));
}

function findProvider(id: unknown) {
  return typeof id === "string" ? providers.find((p) => p.id === id) : undefined;
}

function openHistoryWindow(providerId: string, label: string): void {
  const existing = historyWindows.get(providerId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  const win = buildWindow({ width: 760, height: 520, minWidth: 420, minHeight: 360, title: `Bails · ${label} history` });
  historyWindows.set(providerId, win);
  win.on("closed", () => historyWindows.delete(providerId));
  loadRenderer(win, `history=${encodeURIComponent(providerId)}`);
}

ipcMain.handle("usage:get", (_event, force: unknown) => usage.getReport(force === true));

ipcMain.handle("usage:history", async (_event, id: unknown): Promise<UsageHistory> => {
  const provider = findProvider(id);
  if (!provider) throw new Error("Unknown provider");
  return { provider: provider.id, label: provider.label, samples: (await history?.get(provider.id)) ?? [] };
});

ipcMain.handle("usage:open-history", (_event, id: unknown) => {
  const provider = findProvider(id);
  if (provider) openHistoryWindow(provider.id, provider.label);
});

app.whenReady().then(() => {
  history = new HistoryStore(join(app.getPath("userData"), "usage-history.json"));
  createWindow();
  setInterval(() => void usage.getReport(false).catch(() => undefined), BACKGROUND_REFRESH_MS);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
