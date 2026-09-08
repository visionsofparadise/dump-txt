import type { AppPaths } from "../../shared/models/AppPaths";
import type { DialogChoice, FileDialogOptions } from "../../shared/models/FileDialogOptions";
import type { FileRead } from "../../shared/models/FileRead";
import type { MainEventMap } from "../../shared/models/MainEventMap";
import type { TextContextMenuResponse, TextContextMenuState } from "../../shared/models/TextContextMenuState";
import type { WriteRequest } from "../../shared/models/WriteRequest";

export interface Main {
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
