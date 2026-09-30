import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		projects: [
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
