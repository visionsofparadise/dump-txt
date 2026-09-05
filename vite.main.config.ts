import { defineConfig } from "vite";
export default defineConfig({
	build: {
		lib: { entry: "src/main/index.ts", formats: ["cjs"], fileName: () => "main.cjs" },
		rollupOptions: {
			external: ["electron", "node:fs", "node:fs/promises", "node:path", "node:crypto", "node:events"],
		},
	},
});
