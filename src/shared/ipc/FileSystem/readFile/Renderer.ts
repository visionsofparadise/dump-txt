import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface FileRead {
	readonly bytes: Uint8Array;
	readonly hash: string;
}
export type ReadFileParameters = [path: string];
export const READ_FILE_ACTION = "readFile" as const;

export const fileReadSchema = z.object({ bytes: z.instanceof(Uint8Array), hash: z.string() });

export class ReadFileRendererIpc extends AsyncRendererIpc<
	typeof READ_FILE_ACTION,
	ReadFileParameters,
	FileRead | null
> {
	readonly action = READ_FILE_ACTION;
	readonly response = fileReadSchema.nullable();
}
