import { z } from "zod";

export interface FileDialogOptions {
	readonly title?: string;
	readonly defaultPath?: string;
}

export const dialogChoiceSchema = z.object({ path: z.string(), hash: z.string().nullable() }).nullable();
export type DialogChoice = z.infer<typeof dialogChoiceSchema>;
