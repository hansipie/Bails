import { contextBridge, ipcRenderer } from "electron";
import type { UsageApi } from "../shared/usage";

const usage: UsageApi = {
  get: (force = false) => ipcRenderer.invoke("usage:get", force)
};

contextBridge.exposeInMainWorld("bails", { usage });
