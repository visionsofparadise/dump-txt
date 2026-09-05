import { GetPathsMainIpc } from "./App/getPaths/Main";
import { ShowOpenDialogMainIpc } from "./Dialog/showOpenDialog/Main";
import { ShowSaveDialogMainIpc } from "./Dialog/showSaveDialog/Main";
import { ReadFileMainIpc } from "./FileSystem/readFile/Main";
import { WriteFileMainIpc } from "./FileSystem/writeFile/Main";
import { FinishCloseMainIpc } from "./Window/finishClose/Main";
import { MinimizeMainIpc } from "./Window/minimize/Main";
import { ToggleMaximizeMainIpc } from "./Window/toggleMaximize/Main";

export const ASYNC_MAIN_IPCS = [
	GetPathsMainIpc,
	ShowOpenDialogMainIpc,
	ShowSaveDialogMainIpc,
	ReadFileMainIpc,
	WriteFileMainIpc,
	FinishCloseMainIpc,
	MinimizeMainIpc,
	ToggleMaximizeMainIpc,
];
