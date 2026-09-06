import { contextBridge, ipcRenderer } from "electron";
import { ASYNC_RENDERER_IPCS } from "../shared/ipc/asyncRendererIpcs";
import { mainEventSchemas, type MainEventMap } from "../shared/utils/emitToRenderer";

const startupTheme = process.argv.find((argument) => argument.startsWith("--startup-theme="))?.split("=")[1];

if (startupTheme === "system" || startupTheme === "light" || startupTheme === "dark") {
	window.addEventListener("DOMContentLoaded", () => {
		document.documentElement.dataset.theme = startupTheme;
	}, { once: true });
}

function subscribe<Channel extends keyof MainEventMap>(
	channel: Channel,
	listener: (...parameters: MainEventMap[Channel]) => void,
): () => void {
	if (!Object.hasOwn(mainEventSchemas, channel)) throw new Error("Unknown desktop event.");

	const handler = (_event: Electron.IpcRendererEvent, ...parameters: Array<unknown>) => {
		listener(...mainEventSchemas[channel].parse(parameters));
	};

	ipcRenderer.on(channel, handler);

	return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("main", {
	...Object.fromEntries(ASYNC_RENDERER_IPCS.map((Handler) => new Handler().register(ipcRenderer))),
	events: { on: subscribe },
});
