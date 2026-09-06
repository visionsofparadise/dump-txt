import { GetPathsRendererIpc } from "./App/getPaths/Renderer";
import { ShowOpenDialogRendererIpc } from "./Dialog/showOpenDialog/Renderer";
import { ShowSaveDialogRendererIpc } from "./Dialog/showSaveDialog/Renderer";
import { ReadFileRendererIpc } from "./FileSystem/readFile/Renderer";
import { WriteFileRendererIpc } from "./FileSystem/writeFile/Renderer";
import { ShowTextContextMenuRendererIpc } from "./Menu/showTextContextMenu/Renderer";
import { FinishCloseRendererIpc } from "./Window/finishClose/Renderer";
import { MinimizeRendererIpc } from "./Window/minimize/Renderer";
import { SetTitleRendererIpc } from "./Window/setTitle/Renderer";
import { ToggleMaximizeRendererIpc } from "./Window/toggleMaximize/Renderer";

export const ASYNC_RENDERER_IPCS = [
	GetPathsRendererIpc,
	ShowOpenDialogRendererIpc,
	ShowSaveDialogRendererIpc,
	ReadFileRendererIpc,
	WriteFileRendererIpc,
	ShowTextContextMenuRendererIpc,
	FinishCloseRendererIpc,
	MinimizeRendererIpc,
	SetTitleRendererIpc,
	ToggleMaximizeRendererIpc,
];

type RegisteredIpc = ReturnType<InstanceType<(typeof ASYNC_RENDERER_IPCS)[number]>["register"]>;

export type BridgeCapabilities = { [Handler in RegisteredIpc as Handler[0]]: Handler[1] };

type RendererHandler = InstanceType<(typeof ASYNC_RENDERER_IPCS)[number]>;

export type MainCapabilities = { [Handler in RendererHandler as Handler["action"]]: ReturnType<Handler["connect"]> };
