import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
export default defineConfig({
	plugins: [react()],
	test: {
		projects: [
			{ test: { name: "unit", include: ["src/**/*.unit.test.ts"], environment: "node" } },
			{
				test: {
					name: "integration",
					include: ["src/**/*.integration.test.{ts,tsx}"],
					environment: "jsdom",
					pool: "threads",
				},
			},
		],
	},
});
