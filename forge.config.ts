import { copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import type { ForgeConfig } from "@electron-forge/shared-types";

const config: ForgeConfig = {
	packagerConfig: { asar: true, executableName: "dump-txt", icon: "assets/icon.ico" },
	rebuildConfig: {},
	hooks: {
		preMake: async () => {
			const require = createRequire(import.meta.url);
			const vendor = path.join(path.dirname(require.resolve("electron-winstaller/package.json")), "vendor");

			await Promise.all(
				["exe", "dll"].map((extension) =>
					copyFile(path.join(vendor, `7z-${process.arch}.${extension}`), path.join(vendor, `7z.${extension}`)),
				),
			);
		},
	},
	makers: [new MakerSquirrel({ name: "dump_txt", setupExe: "dump-txt-Setup.exe" })],
	plugins: [
		new AutoUnpackNativesPlugin({}),
		new VitePlugin({
			build: [
				{ entry: "src/main/index.ts", config: "vite.main.config.ts", target: "main" },
				{ entry: "src/preload/index.ts", config: "vite.preload.config.ts", target: "preload" },
			],
			renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
		}),
		new FusesPlugin({
			version: FuseVersion.V1,
			[FuseV1Options.RunAsNode]: false,
			[FuseV1Options.EnableCookieEncryption]: true,
			[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
			[FuseV1Options.EnableNodeCliInspectArguments]: false,
			[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
			[FuseV1Options.OnlyLoadAppFromAsar]: true,
		}),
	],
};
export default config;
