import { z } from "zod";

export interface TextContextMenuState {
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly hasSelection: boolean;
	readonly locked: boolean;
}

export const textContextMenuResponseSchema = z
	.enum(["undo", "redo", "cut", "copy", "paste", "delete", "selectAll"])
	.nullable();
export type TextContextMenuResponse = z.infer<typeof textContextMenuResponseSchema>;
