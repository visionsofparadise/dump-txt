import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, screen } from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { z } from "zod";
import { windowBoundsSchema } from "../shared/utils/emitToRenderer";
import { grantPath } from "./authorizePath";
import { wireWindow } from "./wireWindow";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

declare const MAIN_WINDOW_VITE_NAME: string;

if (squirrelStartup) app.quit();

let browserWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
	const userData = app.getPath("userData");

	await mkdir(userData, { recursive: true });

	const grants = new Set<string>();
	let restoredFilePath: string | null = null;
	let bounds: z.infer<typeof windowBoundsSchema> | undefined;

	try {
		const decoded: unknown = JSON.parse(await readFile(path.join(userData, "app-state.json"), "utf8"));
		const state = z
			.object({
				version: z.literal(1),
				activePath: z.string().min(1),
				windowBounds: windowBoundsSchema.nullable().optional(),
			})
			.parse(decoded);

		restoredFilePath = await grantPath(state.activePath, { grants }, true);

		if (state.windowBounds) {
			const display = screen.getDisplayMatching(state.windowBounds).workArea;
			const width = Math.min(state.windowBounds.width, Math.max(420, display.width));
			const height = Math.min(state.windowBounds.height, Math.max(280, display.height));

			bounds = {
				width,
				height,
				x: Math.max(display.x, Math.min(state.windowBounds.x, display.x + display.width - width)),
				y: Math.max(display.y, Math.min(state.windowBounds.y, display.y + display.height - height)),
			};
		}
	} catch {
		restoredFilePath = null;
	}

	browserWindow = new BrowserWindow({
		width: 960,
		height: 640,
		...bounds,
		minWidth: 420,
		minHeight: 280,
		title: "dump.txt",
		webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
	});
	browserWindow.setMenu(null);
	wireWindow(browserWindow, { userData, restoredFilePath, grants });

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
		if (BrowserWindow.getAllWindows().length === 0) void createWindow();
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
}
