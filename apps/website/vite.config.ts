import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const releaseManifest: Plugin = {
	name: "release-manifest",
	config: (_config, { mode }) => {
		if (mode === "test") return;

		const manifestPath = new URL("gen/release.json", import.meta.url);

		if (!existsSync(manifestPath)) throw new Error("Run npm run release first.");

		return { define: { releaseManifest: JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8"))) } };
	},
};

export default defineConfig({
	plugins: [react(), releaseManifest],
	server: { host: "127.0.0.1" },
	build: { outDir: "dist" },
});
