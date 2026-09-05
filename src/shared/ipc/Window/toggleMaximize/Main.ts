import { z } from "zod";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { TOGGLE_MAXIMIZE_ACTION } from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class ToggleMaximizeMainIpc extends AsyncMainIpc<[], void> {
	readonly action = TOGGLE_MAXIMIZE_ACTION;
	readonly parameters = z.tuple([]);
	handler(dependencies: IpcHandlerDependencies): Promise<void> {
		if (dependencies.browserWindow.isMaximized()) dependencies.browserWindow.unmaximize();
		else dependencies.browserWindow.maximize();

		return Promise.resolve();
	}
}
