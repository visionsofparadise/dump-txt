import type { MainBridge } from "./models/Main";

declare global {
	interface Window {
		readonly main: MainBridge;
		readonly queryLocalFonts?: () => Promise<unknown>;
	}
}
