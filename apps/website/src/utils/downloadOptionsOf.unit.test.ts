import { describe, expect, test } from "vitest";
import { downloadOptionsOf, firstOptionIdOf, megabytesOf } from "./downloadOptionsOf";

function downloadOf(name: string, bytes: number): ReleaseDownload {
	return { name, url: `https://github.com/visionsofparadise/dump-txt/releases/download/v0.3.2/${name}`, bytes };
}

const manifest: ReleaseManifest = {
	tag: "v0.3.2",
	version: "0.3.2",
	downloads: {
		windows: { x64: downloadOf("dump-txt-0.3.2-windows-x64.exe", 2_823_057) },
		macos: {
			arm64: downloadOf("dump-txt-0.3.2-mac-arm64.dmg", 3_560_865),
			x64: downloadOf("dump-txt-0.3.2-mac-x64.dmg", 3_744_556),
		},
		linux: {
			appImage: downloadOf("dump-txt-0.3.2-linux-x86_64.AppImage", 79_882_744),
			deb: downloadOf("dump-txt-0.3.2-linux-amd64.deb", 5_096_988),
		},
	},
};

describe("downloadOptionsOf", () => {
	test("offers the Windows x64 installer by architecture", () => {
		expect(downloadOptionsOf(manifest, "windows")).toEqual({
			group: "Architecture",
			options: [{ id: "x64", label: "x64", download: manifest.downloads.windows.x64 }],
		});
	});

	test("offers Apple Silicon before Intel by architecture", () => {
		expect(downloadOptionsOf(manifest, "macos")).toEqual({
			group: "Architecture",
			options: [
				{ id: "arm64", label: "Apple Silicon", download: manifest.downloads.macos.arm64 },
				{ id: "x64", label: "Intel", download: manifest.downloads.macos.x64 },
			],
		});
	});

	test("offers AppImage before Debian by package", () => {
		expect(downloadOptionsOf(manifest, "linux")).toEqual({
			group: "Package",
			options: [
				{ id: "appImage", label: "AppImage", download: manifest.downloads.linux.appImage },
				{ id: "deb", label: "Debian", download: manifest.downloads.linux.deb },
			],
		});
	});
});

describe("firstOptionIdOf", () => {
	test("selects the first download option of each platform", () => {
		expect(firstOptionIdOf(manifest, "windows")).toBe("x64");
		expect(firstOptionIdOf(manifest, "macos")).toBe("arm64");
		expect(firstOptionIdOf(manifest, "linux")).toBe("appImage");
	});
});

describe("megabytesOf", () => {
	test("rounds to whole megabytes", () => {
		expect(megabytesOf(2_823_057)).toBe(3);
		expect(megabytesOf(79_882_744)).toBe(80);
		expect(megabytesOf(5_499_999)).toBe(5);
	});

	test("reports at least one megabyte", () => {
		expect(megabytesOf(0)).toBe(1);
		expect(megabytesOf(400_000)).toBe(1);
	});
});
