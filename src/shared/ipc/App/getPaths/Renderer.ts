import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type GetPathsParameters = [];
export interface AppPaths {
	readonly userData: string;
	readonly restoredFilePath: string | null;
}
export const GET_PATHS_ACTION = "getPaths" as const;
export class GetPathsRendererIpc extends AsyncRendererIpc<typeof GET_PATHS_ACTION, GetPathsParameters, AppPaths> {
	readonly action = GET_PATHS_ACTION;
	readonly response = z.object({ userData: z.string(), restoredFilePath: z.string().nullable() });
}
