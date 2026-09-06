import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export const TEXT_CONTEXT_MENU_STATE = z
	.object({
		canUndo: z.boolean(),
		canRedo: z.boolean(),
		hasSelection: z.boolean(),
		locked: z.boolean(),
	})
	.strict();

const TEXT_CONTEXT_MENU_RESPONSE = z.enum(["undo", "redo", "cut", "copy", "paste", "delete", "selectAll"]).nullable();

export type TextContextMenuState = z.infer<typeof TEXT_CONTEXT_MENU_STATE>;
export type TextContextMenuResponse = z.infer<typeof TEXT_CONTEXT_MENU_RESPONSE>;
export const SHOW_TEXT_CONTEXT_MENU_ACTION = "showTextContextMenu" as const;

export class ShowTextContextMenuRendererIpc extends AsyncRendererIpc<
	typeof SHOW_TEXT_CONTEXT_MENU_ACTION,
	[state: TextContextMenuState],
	TextContextMenuResponse
> {
	readonly action = SHOW_TEXT_CONTEXT_MENU_ACTION;
	readonly response = TEXT_CONTEXT_MENU_RESPONSE;
}
