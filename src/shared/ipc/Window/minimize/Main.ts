import { z } from "zod";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { MINIMIZE_ACTION } from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class MinimizeMainIpc extends AsyncMainIpc<[], void> {
	readonly action = MINIMIZE_ACTION;
	readonly parameters = z.tuple([]);
	handler(dependencies: IpcHandlerDependencies): Promise<void> {
		dependencies.browserWindow.minimize();

		return Promise.resolve();
	}
}
