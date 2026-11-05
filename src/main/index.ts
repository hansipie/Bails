import { app, BrowserWindow, ipcMain, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { providers } from "./usage/providers";
import { UsageService } from "./usage/service";

const usage = new UsageService(providers, {
  now: () => Date.now(),
  fetch: globalThis.fetch.bind(globalThis),
  env: process.env,
  homeDir: homedir()
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 320,
    title: "Bails",
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

ipcMain.handle("usage:get", (_event, force: unknown) => usage.getReport(force === true));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
