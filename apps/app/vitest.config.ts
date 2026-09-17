import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		projects: [
			{ test: { name: "unit", include: ["src/renderer/host/**/*.unit.test.ts"], environment: "node" } },
			{
				test: {
					name: "integration",
					include: ["src/renderer/host/**/*.integration.test.ts"],
					environment: "jsdom",
				},
			},
		],
	},
});
