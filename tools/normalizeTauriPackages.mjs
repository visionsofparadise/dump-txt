import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { artifactNamesOf } from "./release.mjs";

export function normalizeTauriPackages(root, version, platform = process.platform, architecture = process.arch) {
	const supported =
		((platform === "win32" || platform === "linux") && architecture === "x64") ||
		(platform === "darwin" && ["x64", "arm64"].includes(architecture));
	if (!supported) throw new Error(`Unsupported Tauri package target: ${platform}/${architecture}`);
	const expected = artifactNamesOf(version).filter((name) => {
		if (platform === "win32") return name.endsWith(".exe");
		if (platform === "darwin") return name.endsWith(`-mac-${architecture}.dmg`);
		return name.includes("-linux-");
	});
	const output = join(root, "out", "make");
	mkdirSync(output, { recursive: true });
	return expected.map((name) => {
		const extension = name.slice(name.lastIndexOf("."));
		const type = extension === ".exe" ? "nsis" : extension.slice(1).toLowerCase();
		const directory = join(root, "src-tauri", "target", "release", "bundle", type);
		const candidates = readdirSync(directory).filter(
			(file) => file.includes(`_${version}_`) && file.endsWith(extension),
		);
		if (candidates.length !== 1)
			throw new Error(`Expected exactly one ${type} package for ${version}; found ${candidates.length}`);
		const destination = join(output, name);
		copyFileSync(join(directory, candidates[0]), destination);
		return destination;
	});
}
