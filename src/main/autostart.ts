// Launch-at-login. Electron's login-item API covers macOS and Windows only; on Linux we
// write an XDG autostart entry (~/.config/autostart/bails.desktop), which GNOME, KDE & co. honour.
import { app } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Passed by the autostart entry so Bails starts straight into the tray, window hidden. */
export const HIDDEN_ARG = "--hidden";

/** Quotes one argument for a .desktop Exec key (freedesktop Desktop Entry spec). */
export function quoteExecArg(arg: string): string {
  if (/^[A-Za-z0-9_\-./=:+,@]+$/.test(arg)) return arg;
  return `"${arg.replace(/(["`$\\])/g, "\\$1")}"`;
}

export function desktopEntry(execPath: string, iconPath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Bails",
    "Comment=Retro-arcade AI token usage tracker",
    `Exec=${quoteExecArg(execPath)} ${HIDDEN_ARG}`,
    `Icon=${iconPath}`,
    "Terminal=false",
    "Categories=Development;",
    "X-GNOME-Autostart-enabled=true",
    ""
  ].join("\n");
}

function linuxEntryPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "autostart", "bails.desktop");
}

/** Only an installed build registers itself; `npm run dev` would point at the bare electron binary. */
export function autostartSupported(): boolean {
  return app.isPackaged;
}

/** `bundledIcon` may live inside app.asar, which the desktop shell cannot read: copy it out first. */
export async function applyLaunchAtLogin(enabled: boolean, bundledIcon: string): Promise<void> {
  if (!autostartSupported()) return;
  if (process.platform === "linux") {
    const file = linuxEntryPath();
    if (!enabled) return rm(file, { force: true });
    const icon = join(app.getPath("userData"), "icon.png");
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(icon, await readFile(bundledIcon));
    // AppImage: execPath points inside the temporary mount, the stable file is $APPIMAGE.
    const exec = process.env.APPIMAGE || process.execPath;
    await mkdir(join(file, ".."), { recursive: true });
    // Rewritten at each start, so a moved/updated AppImage keeps a valid entry.
    await writeFile(file, desktopEntry(exec, icon), "utf8");
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] });
}

export function startedHidden(): boolean {
  if (process.argv.includes(HIDDEN_ARG)) return true;
  return process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin === true;
}
