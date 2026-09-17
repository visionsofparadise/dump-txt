declare global {
	interface Window {
		readonly dumpPlatform?: "windows" | "macos" | "linux" | "android" | "ios";
	}
}

export function platformOf() {
	return window.dumpPlatform ?? "windows";
}
