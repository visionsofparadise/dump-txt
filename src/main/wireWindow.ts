import { ASYNC_MAIN_IPCS } from "../shared/ipc/asyncMainIpcs";
import { emitToRenderer } from "../shared/utils/emitToRenderer";
import type { IpcHandlerDependencies } from "../shared/models/IpcHandlerDependencies";
import type { BrowserWindow } from "electron";

export function wireWindow(
	browserWindow: BrowserWindow,
	paths: Pick<IpcHandlerDependencies, "userData" | "restoredFilePath" | "grants" | "takeStartupSettings">,
): void {
	let allowClose = false;
	const dependencies: IpcHandlerDependencies = {
		browserWindow,
		...paths,
		finishClose: () => {
			allowClose = true;
			setImmediate(() => {
				if (!browserWindow.isDestroyed()) browserWindow.close();
			});
		},
	};
	const unregister = ASYNC_MAIN_IPCS.map((Handler) => new Handler().register(dependencies));
	const boundsChanged = () => {
		if (!browserWindow.isMinimized() && !browserWindow.isMaximized())
			emitToRenderer(browserWindow, "windowBoundsChanged", browserWindow.getBounds());
	};
	const maximized = () => emitToRenderer(browserWindow, "maximizedChanged", browserWindow.isMaximized());

	browserWindow.on("move", boundsChanged);
	browserWindow.on("resize", boundsChanged);
	browserWindow.on("maximize", maximized);
	browserWindow.on("unmaximize", maximized);
	browserWindow.on("close", (event) => {
		if (!allowClose) {
			event.preventDefault();
			emitToRenderer(browserWindow, "closeRequested");
		}
	});
	browserWindow.webContents.on("will-navigate", (event) => event.preventDefault());
	browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	browserWindow.on("closed", () => {
		browserWindow.removeListener("move", boundsChanged);
		browserWindow.removeListener("resize", boundsChanged);
		browserWindow.removeListener("maximize", maximized);
		browserWindow.removeListener("unmaximize", maximized);

		for (const remove of unregister) remove();
	});
}
