import { z } from "zod";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { GET_PATHS_ACTION, type AppPaths, type GetPathsParameters } from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class GetPathsMainIpc extends AsyncMainIpc<GetPathsParameters, AppPaths> {
	readonly action = GET_PATHS_ACTION;
	readonly parameters = z.tuple([]);
	handler(dependencies: IpcHandlerDependencies): Promise<AppPaths> {
		return Promise.resolve({
			userData: dependencies.userData,
			restoredFilePath: dependencies.restoredFilePath,
			startupSettings: dependencies.takeStartupSettings?.(),
		});
	}
}
