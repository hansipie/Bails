import { describe, expect, it } from "vitest";
import { desktopEntry, quoteExecArg } from "./autostart";

describe("autostart desktop entry", () => {
  it("leaves plain paths alone and quotes the rest per the Desktop Entry spec", () => {
    expect(quoteExecArg("/opt/Bails/bails")).toBe("/opt/Bails/bails");
    expect(quoteExecArg("/home/me/My Apps/Bails.AppImage")).toBe('"/home/me/My Apps/Bails.AppImage"');
    expect(quoteExecArg('/x/a"b$c`d\\e')).toBe('"/x/a\\"b\\$c\\`d\\\\e"');
  });

  it("starts hidden in the tray", () => {
    const entry = desktopEntry("/opt/Bails/bails", "/home/me/.config/Bails/icon.png");
    expect(entry).toContain("[Desktop Entry]\nType=Application\n");
    expect(entry).toContain("\nExec=/opt/Bails/bails --hidden\n");
    expect(entry).toContain("\nIcon=/home/me/.config/Bails/icon.png\n");
  });
});
