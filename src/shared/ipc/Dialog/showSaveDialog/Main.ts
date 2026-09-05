import { dialog } from "electron";
import { grantPath } from "../../../../main/authorizePath";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { readFileSnapshot } from "../../../utils/readFileSnapshot";
import { dialogParametersSchema, type DialogChoice, type FileDialogOptions } from "../showOpenDialog/Renderer";
import { SHOW_SAVE_DIALOG_ACTION, type ShowSaveDialogParameters } from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class ShowSaveDialogMainIpc extends AsyncMainIpc<ShowSaveDialogParameters, DialogChoice> {
	readonly action = SHOW_SAVE_DIALOG_ACTION;
	readonly parameters = dialogParametersSchema;
	async handler(options: FileDialogOptions | undefined, dependencies: IpcHandlerDependencies): Promise<DialogChoice> {
		const selection = await dialog.showSaveDialog(dependencies.browserWindow, {
			...options,
			properties: ["showOverwriteConfirmation"],
			filters: [{ name: "Text files", extensions: ["txt"] }],
		});

		if (selection.canceled || !selection.filePath) return null;

		const filePath = await grantPath(selection.filePath, dependencies);

		return { path: filePath, hash: (await readFileSnapshot(filePath))?.hash ?? null };
	}
}
