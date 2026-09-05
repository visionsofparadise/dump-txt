import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("main", {});
