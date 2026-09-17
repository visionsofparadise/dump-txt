import { createProbeMain } from "./host/createProbeMain";
import { createTauriMain } from "./host/createTauriMain";
import { mountApp } from "./host/mountApp";
import { readyTauriRenderer } from "./host/readyTauriRenderer";
import "./styles.css";

if (import.meta.env.VITE_TEST_AUTOMATION) await import("@wdio/tauri-plugin");

void createTauriMain()
	.then((desktop) => mountApp(createProbeMain(desktop.main), readyTauriRenderer, desktop.dispose))
	.catch((error: unknown) => console.error(error));
