import { z } from "zod";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { FINISH_CLOSE_ACTION } from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class FinishCloseMainIpc extends AsyncMainIpc<[], void> {
	readonly action = FINISH_CLOSE_ACTION;
	readonly parameters = z.tuple([]);
	handler(dependencies: IpcHandlerDependencies): Promise<void> {
		dependencies.finishClose();

		return Promise.resolve();
	}
}
