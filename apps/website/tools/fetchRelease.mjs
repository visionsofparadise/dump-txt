import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function downloadOf(release, pattern) {
	const asset = release.assets.find((candidate) => pattern.test(candidate.name));

	if (!asset) throw new Error(`Release ${release.tag_name} has no asset matching ${pattern}`);

	return { name: asset.name, url: asset.browser_download_url, bytes: asset.size };
}

export function manifestOf(release) {
	if (release.draft || release.prerelease)
		throw new Error(`Release ${release.tag_name} is not a published stable release`);

	return {
		tag: release.tag_name,
		version: release.tag_name.replace(/^v/u, ""),
		downloads: {
			windows: { x64: downloadOf(release, /-windows-x64\.exe$/u) },
			macos: { arm64: downloadOf(release, /-mac-arm64\.dmg$/u), x64: downloadOf(release, /-mac-x64\.dmg$/u) },
			linux: {
				appImage: downloadOf(release, /-linux-x86_64\.AppImage$/u),
				deb: downloadOf(release, /-linux-amd64\.deb$/u),
			},
		},
	};
}

async function requestRelease(repository, tag) {
	const endpoint = tag
		? `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`
		: `repos/${repository}/releases/latest`;
	const response = await fetch(`https://api.github.com/${endpoint}`, {
		headers: {
			...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});

	if (!response.ok) throw new Error(`GitHub GET ${endpoint} failed: ${response.status}`);

	return response.json();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const release = await requestRelease(
		process.env.GITHUB_REPOSITORY || "visionsofparadise/dump-txt",
		process.env.DUMP_TXT_RELEASE_TAG,
	);
	const manifest = manifestOf(release);
	const directory = fileURLToPath(new URL("../gen", import.meta.url));

	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`Linked ${manifest.tag}`);
}
