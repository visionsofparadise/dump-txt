import { GetPathsRendererIpc } from "../../shared/ipc/App/getPaths/Renderer";
import { ShowOpenDialogRendererIpc } from "../../shared/ipc/Dialog/showOpenDialog/Renderer";
import { ShowSaveDialogRendererIpc } from "../../shared/ipc/Dialog/showSaveDialog/Renderer";
import { ReadFileRendererIpc } from "../../shared/ipc/FileSystem/readFile/Renderer";
import { WriteFileRendererIpc } from "../../shared/ipc/FileSystem/writeFile/Renderer";
import { ShowTextContextMenuRendererIpc } from "../../shared/ipc/Menu/showTextContextMenu/Renderer";
import { FinishCloseRendererIpc } from "../../shared/ipc/Window/finishClose/Renderer";
import { MinimizeRendererIpc } from "../../shared/ipc/Window/minimize/Renderer";
import { SetTitleRendererIpc } from "../../shared/ipc/Window/setTitle/Renderer";
import { ToggleMaximizeRendererIpc } from "../../shared/ipc/Window/toggleMaximize/Renderer";
import { IpcError } from "../../shared/models/IpcFailure";
import type { Main } from "../models/Main";

function unavailable(): Promise<never> {
	return Promise.reject(
		new IpcError({ code: "io", message: "This desktop service is unavailable in the migration base." }),
	);
}

export function createElectronMain(): Main {
	const bridge = window.main;

	return {
		getPaths: new GetPathsRendererIpc().connect(bridge.getPaths),
		showOpenDialog: new ShowOpenDialogRendererIpc().connect(bridge.showOpenDialog),
		showSaveDialog: new ShowSaveDialogRendererIpc().connect(bridge.showSaveDialog),
		readFile: new ReadFileRendererIpc().connect(bridge.readFile),
		writeFile: new WriteFileRendererIpc().connect(bridge.writeFile),
		showTextContextMenu: new ShowTextContextMenuRendererIpc().connect(bridge.showTextContextMenu),
		finishClose: new FinishCloseRendererIpc().connect(bridge.finishClose),
		setTitle: new SetTitleRendererIpc().connect(bridge.setTitle),
		minimize: new MinimizeRendererIpc().connect(bridge.minimize),
		toggleMaximize: new ToggleMaximizeRendererIpc().connect(bridge.toggleMaximize),
		getSystemFonts: unavailable,
		readClipboard: unavailable,
		writeClipboard: unavailable,
		events: bridge.events,
	};
}
