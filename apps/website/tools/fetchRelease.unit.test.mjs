import assert from "node:assert/strict";
import { test } from "node:test";
import { manifestOf } from "./fetchRelease.mjs";

const names = [
	"dump-txt-0.3.2-windows-x64.exe",
	"dump-txt-0.3.2-mac-arm64.dmg",
	"dump-txt-0.3.2-mac-x64.dmg",
	"dump-txt-0.3.2-linux-x86_64.AppImage",
	"dump-txt-0.3.2-linux-amd64.deb",
	"SHA256SUMS",
];

function releaseOf(assetNames, flags = {}) {
	return {
		tag_name: "v0.3.2",
		draft: false,
		prerelease: false,
		...flags,
		assets: assetNames.map((name, index) => ({
			name,
			size: (index + 1) * 1_000_000,
			browser_download_url: `https://github.com/visionsofparadise/dump-txt/releases/download/v0.3.2/${name}`,
		})),
	};
}

function downloadOf(name, bytes) {
	return { name, url: `https://github.com/visionsofparadise/dump-txt/releases/download/v0.3.2/${name}`, bytes };
}

test("maps the five release assets to the manifest", () => {
	assert.deepEqual(manifestOf(releaseOf(names)), {
		tag: "v0.3.2",
		version: "0.3.2",
		downloads: {
			windows: { x64: downloadOf("dump-txt-0.3.2-windows-x64.exe", 1_000_000) },
			macos: {
				arm64: downloadOf("dump-txt-0.3.2-mac-arm64.dmg", 2_000_000),
				x64: downloadOf("dump-txt-0.3.2-mac-x64.dmg", 3_000_000),
			},
			linux: {
				appImage: downloadOf("dump-txt-0.3.2-linux-x86_64.AppImage", 4_000_000),
				deb: downloadOf("dump-txt-0.3.2-linux-amd64.deb", 5_000_000),
			},
		},
	});
});

test("rejects a release missing an asset", () => {
	assert.throws(() => manifestOf(releaseOf(names.filter((name) => !name.endsWith(".deb")))), /linux-amd64/u);
});

for (const flag of ["prerelease", "draft"]) {
	test(`rejects a ${flag} release`, () => {
		assert.throws(() => manifestOf(releaseOf(names, { [flag]: true })), /published stable release/u);
	});
}
