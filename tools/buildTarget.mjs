import { join } from "node:path";

export function buildTarget(platform = process.platform, arch = process.arch) {
	if (
		!((platform === "win32" || platform === "linux") && arch === "x64") &&
		!(platform === "darwin" && (arch === "x64" || arch === "arm64"))
	)
		throw new Error(`Unsupported build target: ${platform}/${arch}`);

	const directory = join("out", `dump.txt-${platform}-${arch}`);
	const packaged = platform === "darwin" ? join(directory, "dump.txt.app") : directory;
	const executable =
		platform === "darwin"
			? join(packaged, "Contents", "MacOS", "dump-txt")
			: join(packaged, platform === "win32" ? "dump-txt.exe" : "dump-txt");

	return {
		platform,
		arch,
		packaged,
		executable,
		flag: platform === "win32" ? "--win" : platform === "darwin" ? "--mac" : "--linux",
	};
}
