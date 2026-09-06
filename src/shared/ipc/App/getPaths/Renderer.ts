import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";
import { fileReadSchema, type FileRead } from "../../FileSystem/readFile/Renderer";

export type GetPathsParameters = [];
export interface AppPaths {
	readonly userData: string;
	readonly restoredFilePath: string | null;
	readonly startupSettings?: FileRead | null;
}
export const GET_PATHS_ACTION = "getPaths" as const;
export class GetPathsRendererIpc extends AsyncRendererIpc<typeof GET_PATHS_ACTION, GetPathsParameters, AppPaths> {
	readonly action = GET_PATHS_ACTION;
	readonly response = z.object({
		userData: z.string(),
		restoredFilePath: z.string().nullable(),
		startupSettings: fileReadSchema.nullable().optional(),
	});
}
