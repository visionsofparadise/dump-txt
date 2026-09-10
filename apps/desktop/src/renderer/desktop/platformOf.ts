declare global {
	interface Window {
		readonly dumpPlatform?: "windows" | "macos" | "linux";
	}
}

export function platformOf() {
	return window.dumpPlatform ?? "windows";
}
