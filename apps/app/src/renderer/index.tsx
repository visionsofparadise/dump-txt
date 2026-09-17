import { createTauriMain } from "./host/createTauriMain";
import { mountApp } from "./host/mountApp";
import { readyTauriRenderer } from "./host/readyTauriRenderer";
import "./styles.css";

async function start(): Promise<void> {
	const desktop = await createTauriMain();

	mountApp(desktop.main, readyTauriRenderer, desktop.dispose);
}

void start().catch((error: unknown) => console.error(error));
