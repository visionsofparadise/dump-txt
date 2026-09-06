import { z } from "zod";

export interface WriteRequest {
	readonly path: string;
	readonly bytes: Uint8Array;
	readonly expectedHash: string | null;
}

export const writeResultSchema = z.object({ hash: z.string() });
