import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";
import { dialogChoiceSchema, type DialogChoice, type FileDialogOptions } from "../showOpenDialog/Renderer";

export type ShowSaveDialogParameters = [options?: FileDialogOptions];
export const SHOW_SAVE_DIALOG_ACTION = "showSaveDialog" as const;
export class ShowSaveDialogRendererIpc extends AsyncRendererIpc<
	typeof SHOW_SAVE_DIALOG_ACTION,
	ShowSaveDialogParameters,
	DialogChoice
> {
	readonly action = SHOW_SAVE_DIALOG_ACTION;
	readonly response = dialogChoiceSchema;
}
