import type { AppPaths } from "./AppPaths";
import type { DialogChoice, FileDialogOptions } from "./FileDialogOptions";
import type { FileRead } from "./FileRead";
import type { MainCapabilities } from "./MainCapabilities";
import type { MainEventMap } from "./MainEventMap";
import type { TextContextMenuResponse, TextContextMenuState } from "./TextContextMenuState";
import type { WriteRequest } from "./WriteRequest";

export interface Main {
	readonly platform?: "windows" | "macos" | "linux";
	readonly decorations?: "native" | "drawn";
	readonly capabilities?: MainCapabilities;

	getPaths(): Promise<AppPaths>;

	readFile(path: string): Promise<FileRead | null>;

	writeFile(request: WriteRequest): Promise<{ hash: string }>;

	showOpenDialog(options?: FileDialogOptions): Promise<DialogChoice>;

	showSaveDialog(options?: FileDialogOptions): Promise<DialogChoice>;

	minimize(): Promise<void>;

	toggleMaximize(): Promise<void>;

	setTitle(title: string): Promise<void>;

	setTheme(theme: "system" | "light" | "dark"): Promise<void>;

	finishClose(): Promise<void>;

	showTextContextMenu(state: TextContextMenuState): Promise<TextContextMenuResponse>;

	getSystemFonts(): Promise<ReadonlyArray<string>>;

	readClipboard(): Promise<string>;

	writeClipboard(text: string): Promise<void>;
	readonly events: {
		on<Channel extends keyof MainEventMap>(
			channel: Channel,
			listener: (...parameters: MainEventMap[Channel]) => void,
		): () => void;
	};
}
