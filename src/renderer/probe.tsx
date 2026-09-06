import { createProbeMain } from "./desktop/createProbeMain";
import { createTauriMain } from "./desktop/createTauriMain";
import { mountApp } from "./desktop/mountApp";
import { readyTauriRenderer } from "./desktop/readyTauriRenderer";
import "./styles.css";

void createTauriMain()
	.then((desktop) => mountApp(createProbeMain(desktop.main), readyTauriRenderer, desktop.dispose))
	.catch((error: unknown) => console.error(error));
