import type { WindowState } from "../utils/windowMessages";

export type WindowAnimation = `${"win" | "mac" | "gnome"}-${"min" | "restore" | "close" | "open"}` | "mac-hold";

export type BoxPose = "flat" | "maximized" | "tilted";

export interface AppWindow {
	state: WindowState;
	isMaximized: boolean;
	animation: WindowAnimation | null;
	tileOffset: { x: number; y: number };
	pose: BoxPose | null;
}
