import { createProbeMain } from "./desktop/createProbeMain";
import { createTauriMain } from "./desktop/createTauriMain";
import { mountApp } from "./desktop/mountApp";
import { readyTauriRenderer } from "./desktop/readyTauriRenderer";
import "./styles.css";

if (import.meta.env.VITE_TEST_AUTOMATION) await import("@wdio/tauri-plugin");

void createTauriMain()
	.then((desktop) => mountApp(createProbeMain(desktop.main), readyTauriRenderer, desktop.dispose))
	.catch((error: unknown) => console.error(error));
