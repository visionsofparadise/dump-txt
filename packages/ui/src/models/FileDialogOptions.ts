import { z } from "zod";

export interface FileDialogOptions {
	readonly title?: string;
	readonly writable?: boolean;
	readonly defaultPath?: string;
	readonly filters?: ReadonlyArray<{ readonly name: string; readonly extensions: ReadonlyArray<string> }>;
}

export const dialogChoiceSchema = z
	.object({ path: z.string(), name: z.string().min(1), hash: z.string().nullable() })
	.nullable();
export type DialogChoice = z.infer<typeof dialogChoiceSchema>;
