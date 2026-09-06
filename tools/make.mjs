import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildTarget } from "./buildTarget.mjs";

const require = createRequire(import.meta.url);
const target = buildTarget();
const options = { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit" };

execFileSync(
	process.execPath,
	[
		require.resolve("@electron-forge/cli/dist/electron-forge.js"),
		"package",
		`--platform=${target.platform}`,
		`--arch=${target.arch}`,
	],
	options,
);
execFileSync(
	process.execPath,
	[
		require.resolve("electron-builder/cli.js"),
		"--config",
		"electron-builder.yml",
		target.flag,
		`--${target.arch}`,
		"--prepackaged",
		target.packaged,
		"--publish",
		"never",
	],
	options,
);
