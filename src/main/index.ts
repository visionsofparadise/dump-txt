import path from "node:path";
import { app, BrowserWindow } from "electron";
import squirrelStartup from "electron-squirrel-startup";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

declare const MAIN_WINDOW_VITE_NAME: string;

if (squirrelStartup) app.quit();

let browserWindow: BrowserWindow | null = null;

function createWindow(): void {
	browserWindow = new BrowserWindow({
		width: 960,
		height: 640,
		minWidth: 420,
		minHeight: 280,
		title: "dump.txt",
		webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
	});
	browserWindow.setMenu(null);

	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void browserWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
	else void browserWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));

	browserWindow.on("closed", () => {
		browserWindow = null;
	});
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", () => {
		if (browserWindow?.isMinimized()) browserWindow.restore();

		browserWindow?.focus();
	});
	void app.whenReady().then(createWindow);
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
}
