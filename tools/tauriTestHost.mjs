import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { arch, homedir, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTauriCapabilities, startWdioSession } from "@wdio/tauri-service";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const executable =
	process.env.TAURI_TEST_BINARY ??
	path.join(root, "target", "release", process.platform === "win32" ? "dump-txt.exe" : "dump-txt");
export const driverProvider =
	process.env.TAURI_TEST_DRIVER ?? (process.platform === "darwin" ? "embedded" : "external");

export function hostReport() {
	return {
		executable,
		driverProvider,
		platform: process.platform,
		architecture: arch(),
		osRelease: release(),
		commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
		harnessSourceDirty:
			execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0,
	};
}

export async function startHostSession(folder, { sessionName, commandTimeout = 30000 } = {}) {
	const installedDriver = path.join(
		homedir(),
		".cargo",
		"bin",
		process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver",
	);
	const tauriDriverPath = process.env.TAURI_DRIVER_PATH ?? (existsSync(installedDriver) ? installedDriver : undefined);
	const capabilities = createTauriCapabilities(executable, {
		driverProvider,
		logLevel: "warn",
		startTimeout: 120000,
		commandTimeout,
	});
	const webviewRoot = process.env.TAURI_TEST_WEBVIEW_DATA_FOLDER;
	if (process.platform === "win32" && webviewRoot) {
		capabilities["tauri:options"].webviewOptions = {
			userDataFolder: sessionName ? path.join(webviewRoot, sessionName) : webviewRoot,
			additionalBrowserArguments: [
				"remote-debugging-port=0",
				"remote-debugging-address=127.0.0.1",
				"enable-logging",
				`log-file=${path.join(folder, "webview2.log")}`,
			],
		};
	}
	Object.assign(capabilities["wdio:tauriServiceOptions"], {
		logDir: folder,
		captureBackendLogs: true,
		autoDownloadEdgeDriver: !process.env.MS_EDGE_DRIVER,
		...(tauriDriverPath ? { tauriDriverPath } : {}),
	});
	return startWdioSession(capabilities, {
		rootDir: root,
		...(process.env.MS_EDGE_DRIVER ? { nativeDriverPath: process.env.MS_EDGE_DRIVER } : {}),
	});
}
