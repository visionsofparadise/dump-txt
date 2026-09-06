import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
	root: fileURLToPath(new URL(".", import.meta.url)),
	clearScreen: false,
	cacheDir: "node_modules/.vite-tauri",
	define: {
		"import.meta.env.VITE_DESKTOP": JSON.stringify("tauri"),
		"import.meta.env.VITE_TEST_AUTOMATION": JSON.stringify(process.env.TAURI_TEST_AUTOMATION === "true"),
	},
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "tauri-csp",
			transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/u, ""),
		},
	],
	server: {
		port: 1420,
		strictPort: true,
		host: "127.0.0.1",
		watch: { ignored: ["**/src-tauri/**", "**/.scratch/**"] },
	},
	build: {
		outDir: "dist-tauri",
		emptyOutDir: true,
		target: ["chrome111", "safari16.4"],
		rollupOptions: { input: mode === "probe" ? "probe.html" : "index.html" },
	},
}));
