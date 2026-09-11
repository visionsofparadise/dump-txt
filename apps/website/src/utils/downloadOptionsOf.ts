import type { Platform } from "./platformOf";

export interface DownloadOption {
	readonly id: string;
	readonly label: string;
	readonly download: ReleaseDownload;
}

export function downloadOptionsOf(
	manifest: ReleaseManifest,
	platform: Platform,
): { readonly group: "Architecture" | "Package"; readonly options: ReadonlyArray<DownloadOption> } {
	const { windows, macos, linux } = manifest.downloads;

	switch (platform) {
		case "windows":
			return { group: "Architecture", options: [{ id: "x64", label: "x64", download: windows.x64 }] };
		case "macos":
			return {
				group: "Architecture",
				options: [
					{ id: "arm64", label: "Apple Silicon", download: macos.arm64 },
					{ id: "x64", label: "Intel", download: macos.x64 },
				],
			};
		case "linux":
			return {
				group: "Package",
				options: [
					{ id: "appImage", label: "AppImage", download: linux.appImage },
					{ id: "deb", label: "Debian", download: linux.deb },
				],
			};
	}
}

export function megabytesOf(bytes: number): number {
	return Math.max(1, Math.round(bytes / 1_000_000));
}
