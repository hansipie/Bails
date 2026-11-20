import { contextBridge, ipcRenderer } from "electron";
import type { UsageApi } from "../shared/usage";

const usage: UsageApi = {
  get: (force = false) => ipcRenderer.invoke("usage:get", force),
  history: (provider) => ipcRenderer.invoke("usage:history", provider),
  openHistory: (provider) => ipcRenderer.invoke("usage:open-history", provider)
};

contextBridge.exposeInMainWorld("bails", { usage });
