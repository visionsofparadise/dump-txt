import { z } from "zod";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { SET_TITLE_ACTION, type SetTitleParameters } from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class SetTitleMainIpc extends AsyncMainIpc<SetTitleParameters, void> {
	readonly action = SET_TITLE_ACTION;
	readonly parameters = z.tuple([z.string().min(1).max(32767)]);
	handler(title: string, dependencies: IpcHandlerDependencies): Promise<void> {
		dependencies.browserWindow.setTitle(title);

		return Promise.resolve();
	}
}
