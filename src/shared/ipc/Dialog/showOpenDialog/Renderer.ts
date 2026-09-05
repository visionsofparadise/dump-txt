import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

const dialogOptionsSchema = z.object({ title: z.string().optional(), defaultPath: z.string().optional() }).strict();

export const dialogChoiceSchema = z.object({ path: z.string(), hash: z.string().nullable() }).nullable();
export type FileDialogOptions = z.infer<typeof dialogOptionsSchema>;

export const dialogParametersSchema = z
	.tuple([dialogOptionsSchema.optional()])
	.transform(([options]): [FileDialogOptions | undefined] => [options]);

export type DialogChoice = z.infer<typeof dialogChoiceSchema>;
export type ShowOpenDialogParameters = [options?: FileDialogOptions];
export const SHOW_OPEN_DIALOG_ACTION = "showOpenDialog" as const;
export class ShowOpenDialogRendererIpc extends AsyncRendererIpc<
	typeof SHOW_OPEN_DIALOG_ACTION,
	ShowOpenDialogParameters,
	DialogChoice
> {
	readonly action = SHOW_OPEN_DIALOG_ACTION;
	readonly response = dialogChoiceSchema;
}
