import { mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, Menu, nativeTheme, screen } from "electron";
import { z } from "zod";
import { windowBoundsSchema } from "../shared/utils/emitToRenderer";
import { readFileSnapshot } from "../shared/utils/readFileSnapshot";
import { grantPath } from "./authorizePath";
import { wireWindow } from "./wireWindow";
import type { FileRead } from "../shared/ipc/FileSystem/readFile/Renderer";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

declare const MAIN_WINDOW_VITE_NAME: string;

if (MAIN_WINDOW_VITE_DEV_SERVER_URL && !app.commandLine.hasSwitch("user-data-dir")) {
	const developmentProfile = path.resolve(__dirname, "../../.scratch/dev-profile");

	mkdirSync(developmentProfile, { recursive: true });
	app.setPath("userData", developmentProfile);
}

let browserWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
	const userData = app.getPath("userData");

	await mkdir(userData, { recursive: true });

	const grants = new Set<string>();
	let restoredFilePath: string | null = null;
	let bounds: z.infer<typeof windowBoundsSchema> | undefined;
	let theme: "system" | "light" | "dark" = "system";
	let startupSettings: FileRead | null | undefined;

	try {
		startupSettings = await readFileSnapshot(path.join(userData, "app-state.json"));

		const decoded: unknown = startupSettings ? JSON.parse(Buffer.from(startupSettings.bytes).toString("utf8")) : null;
		const appearance = z
			.object({
				appearance: z.object({ theme: z.enum(["system", "light", "dark"]) }),
			})
			.safeParse(decoded);

		if (appearance.success) theme = appearance.data.appearance.theme;

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
		frame: false,
		backgroundColor:
			theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors) ? "#2c2c2c" : "#fafafa",
		title: "dump.txt",
		icon: MAIN_WINDOW_VITE_DEV_SERVER_URL ? path.join(__dirname, "../../assets/icon.png") : undefined,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			additionalArguments: [`--startup-theme=${theme}`],
		},
	});
	browserWindow.setMenu(null);

	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		const contents = browserWindow.webContents;

		contents.on("before-input-event", (event, input) => {
			if (
				input.type === "keyDown" &&
				(input.key === "F12" || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i"))
			) {
				event.preventDefault();
				contents.toggleDevTools();
			}
		});
	}

	wireWindow(browserWindow, {
		userData,
		restoredFilePath,
		grants,
		takeStartupSettings: () => {
			const snapshot = startupSettings;

			startupSettings = undefined;

			return snapshot;
		},
	});

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
	void app.whenReady().then(() => {
		Menu.setApplicationMenu(null);

		return createWindow();
	});
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) void createWindow();
	});
	app.on("window-all-closed", () => {
		app.quit();
	});
}
