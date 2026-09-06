import type { FileRead } from "../ipc/FileSystem/readFile/Renderer";
import type { BrowserWindow } from "electron";

export interface IpcHandlerDependencies {
	readonly browserWindow: BrowserWindow;
	readonly userData: string;
	readonly restoredFilePath: string | null;
	readonly grants: Set<string>;
	readonly finishClose: () => void;
	readonly takeStartupSettings?: () => FileRead | null | undefined;
}
