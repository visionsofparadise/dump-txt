import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		projects: [
			{ test: { name: "unit", include: ["src/renderer/desktop/**/*.unit.test.ts"], environment: "node" } },
			{
				test: {
					name: "integration",
					include: ["src/renderer/desktop/**/*.integration.test.ts"],
					environment: "jsdom",
				},
			},
		],
	},
});
