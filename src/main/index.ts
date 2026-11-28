import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UsageHistory } from "../shared/usage";
import { applyLaunchAtLogin, autostartSupported, startedHidden } from "./autostart";
import { HistoryStore } from "./usage/history";
import { runCommand } from "./usage/exec";
import { readKeyring } from "./usage/keyring";
import { providers } from "./usage/providers";
import { SettingsStore } from "./settings";
import { UsageService } from "./usage/service";

/** Background refresh so history keeps accumulating whatever window is open (the service caches). */
const BACKGROUND_REFRESH_MS = 5 * 60_000;

let history: HistoryStore | null = null;
let settings: SettingsStore | null = null;

const usage = new UsageService(
  providers,
  {
    now: () => Date.now(),
    fetch: globalThis.fetch.bind(globalThis),
    env: process.env,
    homeDir: homedir(),
    readKeyring,
    runCommand
  },
  {
    onFreshSnapshots: (snapshots, fetchedAt) => {
      history?.record(snapshots, fetchedAt).catch((err) => console.error("Failed to save usage history:", err));
    }
  }
);

const ICON_PATH = join(__dirname, "../../resources/icon.png");

const historyWindows = new Map<string, BrowserWindow>();

function buildWindow(options: { width: number; height: number; minWidth: number; minHeight?: number; title: string; show?: boolean }) {
  const win = new BrowserWindow({
    ...options,
    autoHideMenuBar: true,
    backgroundColor: "#4b4f93",
    icon: ICON_PATH,
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

const MIN_CONTENT_HEIGHT = 200;
let mainWindow: BrowserWindow | null = null;
/** True while the main window waits for its first fit before appearing (false when started in the tray). */
let revealPending = false;
/** Closing the main window only hides it to the tray; real quits go through the tray menu (or the OS). */
let quitting = false;
let tray: Tray | null = null;

function createWindow(reveal: boolean): void {
  const win = buildWindow({ width: 420, height: 640, minWidth: 320, title: "Bails", show: false });
  mainWindow = win;
  revealPending = reveal;
  // Shown once the first fit arrives (no 640px flash); fallback if it never does.
  const fallback = setTimeout(() => {
    if (revealPending && !win.isDestroyed() && !win.isVisible()) win.show();
    revealPending = false;
  }, 1500);
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on("show", updateTrayMenu);
  win.on("hide", updateTrayMenu);
  win.on("closed", () => {
    clearTimeout(fallback);
    if (mainWindow === win) mainWindow = null;
  });
  loadRenderer(win);
}

function showMainWindow(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showMainWindow();
}

let launchAtLogin = true;

function updateTrayMenu(): void {
  if (!tray) return;
  const visible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: visible ? "Hide Bails" : "Show Bails", click: () => (visible ? mainWindow?.hide() : showMainWindow()) },
      {
        label: "Refresh now",
        click: () => {
          showMainWindow();
          void usage.getReport(true).catch(() => undefined);
        }
      },
      { type: "separator" },
      {
        label: "Launch at login",
        type: "checkbox",
        checked: launchAtLogin,
        enabled: autostartSupported(),
        click: (item) => void setLaunchAtLogin(item.checked)
      },
      { type: "separator" },
      { label: "Quit Bails", click: () => app.quit() }
    ])
  );
}

async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  launchAtLogin = enabled;
  updateTrayMenu();
  await settings?.setLaunchAtLogin(enabled);
  await applyLaunchAtLogin(enabled, ICON_PATH).catch((err) => console.error("Failed to update launch at login:", err));
}

function createTray(): void {
  // Linux status bars (SNI / AppIndicator) and Windows want a small bitmap; macOS gets a template-sized one.
  const size = process.platform === "darwin" ? 18 : 24;
  const image = nativeImage.createFromPath(ICON_PATH).resize({ width: size, height: size, quality: "best" });
  tray = new Tray(image);
  tray.setToolTip("Bails");
  tray.on("click", toggleMainWindow);
  updateTrayMenu();
}

ipcMain.on("window:fit-content", (event, height: unknown) => {
  const win = mainWindow;
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return;
  if (win.isMaximized() || win.isFullScreen()) return;
  const frame = win.getBounds().height - win.getContentBounds().height;
  const maxContent = Math.max(MIN_CONTENT_HEIGHT, screen.getDisplayMatching(win.getBounds()).workArea.height - frame);
  const target = Math.round(Math.min(Math.max(height, MIN_CONTENT_HEIGHT), maxContent));
  const [width = 420, current = 0] = win.getContentSize();
  if (current !== target) win.setContentSize(width, target);
  if (revealPending && !win.isVisible()) win.show();
  revealPending = false;
});

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

ipcMain.handle("usage:set-hidden", async (_event, id: unknown, hidden: unknown) => {
  const provider = findProvider(id);
  if (!provider) throw new Error("Unknown provider");
  const next = new Set(usage.getHidden());
  if (hidden === true) next.add(provider.id);
  else next.delete(provider.id);
  usage.setHidden([...next]);
  await settings?.setHidden([...next]);
  return usage.getReport(false);
});

ipcMain.handle("usage:open-history", (_event, id: unknown) => {
  const provider = findProvider(id);
  if (provider) openHistoryWindow(provider.id, provider.label);
});

// One Bails per session: a second launch (menu, autostart racing a manual start) just shows the window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app.whenReady().then(async () => {
    settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
    usage.setHidden(await settings.getHidden());
    launchAtLogin = await settings.getLaunchAtLogin();
    history = new HistoryStore(join(app.getPath("userData"), "usage-history.json"));
    createTray();
    createWindow(!startedHidden());
    // Re-applied at every start: first run enables it, and the entry follows the current executable path.
    void applyLaunchAtLogin(launchAtLogin, ICON_PATH).catch((err) => console.error("Failed to set launch at login:", err));
    setInterval(() => void usage.getReport(false).catch(() => undefined), BACKGROUND_REFRESH_MS);
    app.on("activate", showMainWindow);
  });
}

app.on("before-quit", () => {
  quitting = true;
});

// The tray keeps Bails alive with no window open.
app.on("window-all-closed", () => undefined);
