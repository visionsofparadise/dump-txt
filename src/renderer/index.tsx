import { mountApp } from "./desktop/mountApp";
import "./styles.css";

async function start(): Promise<void> {
	if (import.meta.env.VITE_DESKTOP === "tauri") {
		const { createTauriMain } = await import("./desktop/createTauriMain");
		const { readyTauriRenderer } = await import("./desktop/readyTauriRenderer");
		const desktop = await createTauriMain();

		mountApp(desktop.main, readyTauriRenderer, desktop.dispose);
	} else {
		const { createElectronMain } = await import("./desktop/createElectronMain");

		mountApp(createElectronMain());
	}
}

void start().catch((error: unknown) => console.error(error));
