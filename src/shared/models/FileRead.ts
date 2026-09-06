import { z } from "zod";

export interface FileRead {
	readonly bytes: Uint8Array;
	readonly hash: string;
}

export const fileReadSchema = z.object({ bytes: z.instanceof(Uint8Array), hash: z.string() });
