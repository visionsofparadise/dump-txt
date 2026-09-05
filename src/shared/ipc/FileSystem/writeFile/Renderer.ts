import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface WriteRequest {
	readonly path: string;
	readonly bytes: Uint8Array;
	readonly expectedHash: string | null;
}
export type WriteFileParameters = [request: WriteRequest];
export const WRITE_FILE_ACTION = "writeFile" as const;
export class WriteFileRendererIpc extends AsyncRendererIpc<
	typeof WRITE_FILE_ACTION,
	WriteFileParameters,
	{ hash: string }
> {
	readonly action = WRITE_FILE_ACTION;
	readonly response = z.object({ hash: z.string() });
}
