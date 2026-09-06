import { GetPathsMainIpc } from "./App/getPaths/Main";
import { ReadClipboardMainIpc } from "./Clipboard/readText/Main";
import { WriteClipboardMainIpc } from "./Clipboard/writeText/Main";
import { ShowOpenDialogMainIpc } from "./Dialog/showOpenDialog/Main";
import { ShowSaveDialogMainIpc } from "./Dialog/showSaveDialog/Main";
import { ReadFileMainIpc } from "./FileSystem/readFile/Main";
import { WriteFileMainIpc } from "./FileSystem/writeFile/Main";
import { ShowTextContextMenuMainIpc } from "./Menu/showTextContextMenu/Main";
import { FinishCloseMainIpc } from "./Window/finishClose/Main";
import { MinimizeMainIpc } from "./Window/minimize/Main";
import { SetTitleMainIpc } from "./Window/setTitle/Main";
import { ToggleMaximizeMainIpc } from "./Window/toggleMaximize/Main";

export const ASYNC_MAIN_IPCS = [
	GetPathsMainIpc,
	ReadClipboardMainIpc,
	WriteClipboardMainIpc,
	ShowOpenDialogMainIpc,
	ShowSaveDialogMainIpc,
	ReadFileMainIpc,
	WriteFileMainIpc,
	ShowTextContextMenuMainIpc,
	FinishCloseMainIpc,
	MinimizeMainIpc,
	SetTitleMainIpc,
	ToggleMaximizeMainIpc,
];
