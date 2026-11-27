// Small user preferences (currently: which provider cards are hidden), kept as one JSON file in userData.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderId } from "../shared/usage";

export interface Settings {
  hiddenProviders: ProviderId[];
}

export function sanitizeSettings(value: unknown): Settings {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).hiddenProviders : undefined;
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  return { hiddenProviders: [...new Set(ids)] };
}

export class SettingsStore {
  private data: Settings | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    if (this.data) return this.data;
    let loaded: Settings = { hiddenProviders: [] };
    try {
      loaded = sanitizeSettings(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch {
      // Missing or corrupt file: fall back to defaults.
    }
    this.data ??= loaded;
    return this.data;
  }

  async getHidden(): Promise<ProviderId[]> {
    return [...(await this.load()).hiddenProviders];
  }

  async setHidden(ids: ProviderId[]): Promise<void> {
    const data = sanitizeSettings({ hiddenProviders: ids });
    this.data = data;
    // Serialize writes; temp file then rename so a crash never leaves a half file.
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await writeFile(tmp, JSON.stringify(data), "utf8");
        await rename(tmp, this.filePath);
      });
    return this.writing;
  }
}
