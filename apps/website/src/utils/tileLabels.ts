import type { WindowState } from "./windowMessages";

export const tileLabels: Record<WindowState, string> = {
	open: "Minimize dump.txt",
	minimized: "Restore dump.txt",
	closed: "Open dump.txt",
};
