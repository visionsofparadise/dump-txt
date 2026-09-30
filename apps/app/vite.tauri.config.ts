import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	clearScreen: false,
	cacheDir: "node_modules/.vite-tauri",
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "tauri-csp",
			transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/u, ""),
		},
	],
	server: {
		port: 5173,
		strictPort: true,
		host: "127.0.0.1",
		watch: { ignored: ["**/src/main/**", "**/target/**", "**/gen/**", "**/permissions/**", "**/.scratch/**"] },
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: ["chrome111", "safari16.4"],
	},
});
