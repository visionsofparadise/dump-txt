import { createTauriMain } from "./desktop/createTauriMain";
import { mountApp } from "./desktop/mountApp";
import { readyTauriRenderer } from "./desktop/readyTauriRenderer";
import "./styles.css";

async function start(): Promise<void> {
	const desktop = await createTauriMain();

	mountApp(desktop.main, readyTauriRenderer, desktop.dispose);
}

void start().catch((error: unknown) => console.error(error));
