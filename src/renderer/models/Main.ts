import { GetPathsRendererIpc } from "../../shared/ipc/App/getPaths/Renderer";
import { ShowOpenDialogRendererIpc } from "../../shared/ipc/Dialog/showOpenDialog/Renderer";
import { ShowSaveDialogRendererIpc } from "../../shared/ipc/Dialog/showSaveDialog/Renderer";
import { ReadFileRendererIpc } from "../../shared/ipc/FileSystem/readFile/Renderer";
import { WriteFileRendererIpc } from "../../shared/ipc/FileSystem/writeFile/Renderer";
import { FinishCloseRendererIpc } from "../../shared/ipc/Window/finishClose/Renderer";
import { MinimizeRendererIpc } from "../../shared/ipc/Window/minimize/Renderer";
import { ToggleMaximizeRendererIpc } from "../../shared/ipc/Window/toggleMaximize/Renderer";
import type { BridgeCapabilities, MainCapabilities } from "../../shared/ipc/asyncRendererIpcs";
import type { MainEventMap } from "../../shared/utils/emitToRenderer";

export interface Main extends MainCapabilities {
	readonly events: {
		on<Channel extends keyof MainEventMap>(
			channel: Channel,
			listener: (...parameters: MainEventMap[Channel]) => void,
		): () => void;
	};
}

export interface MainBridge extends BridgeCapabilities {
	readonly events: Main["events"];
}

export function createMain(bridge: MainBridge): Main {
	return {
		getPaths: new GetPathsRendererIpc().connect(bridge.getPaths),
		showOpenDialog: new ShowOpenDialogRendererIpc().connect(bridge.showOpenDialog),
		showSaveDialog: new ShowSaveDialogRendererIpc().connect(bridge.showSaveDialog),
		readFile: new ReadFileRendererIpc().connect(bridge.readFile),
		writeFile: new WriteFileRendererIpc().connect(bridge.writeFile),
		finishClose: new FinishCloseRendererIpc().connect(bridge.finishClose),
		minimize: new MinimizeRendererIpc().connect(bridge.minimize),
		toggleMaximize: new ToggleMaximizeRendererIpc().connect(bridge.toggleMaximize),
		events: bridge.events,
	};
}
