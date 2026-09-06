import { randomBytes } from "node:crypto";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
export default defineConfig(({ command }) => {
	const nonce = command === "serve" ? randomBytes(24).toString("base64") : undefined;
	return {
		server: { watch: { ignored: ["**/.scratch/**"] } },
		html: { cspNonce: nonce },
		plugins: [
			react(),
			tailwindcss(),
			{
				name: "development-csp",
				apply: "serve",
				transformIndexHtml(html) {
					return html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
				},
			},
		],
	};
});
