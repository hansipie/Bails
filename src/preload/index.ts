import { contextBridge, ipcRenderer } from "electron";
import type { UsageApi, WindowApi } from "../shared/usage";

const usage: UsageApi = {
  get: (force = false) => ipcRenderer.invoke("usage:get", force),
  history: (provider) => ipcRenderer.invoke("usage:history", provider),
  setHidden: (provider, hidden) => ipcRenderer.invoke("usage:set-hidden", provider, hidden),
  openHistory: (provider) => ipcRenderer.invoke("usage:open-history", provider)
};

const win: WindowApi = {
  fitContent: (height) => ipcRenderer.send("window:fit-content", height)
};

contextBridge.exposeInMainWorld("bails", { usage, window: win });
