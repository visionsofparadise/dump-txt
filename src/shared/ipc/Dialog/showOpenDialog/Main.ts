import { dialog } from "electron";
import { grantPath } from "../../../../main/authorizePath";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { readFileSnapshot } from "../../../utils/readFileSnapshot";
import {
	SHOW_OPEN_DIALOG_ACTION,
	dialogParametersSchema,
	type DialogChoice,
	type FileDialogOptions,
	type ShowOpenDialogParameters,
} from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class ShowOpenDialogMainIpc extends AsyncMainIpc<ShowOpenDialogParameters, DialogChoice> {
	readonly action = SHOW_OPEN_DIALOG_ACTION;
	readonly parameters = dialogParametersSchema;
	async handler(options: FileDialogOptions | undefined, dependencies: IpcHandlerDependencies): Promise<DialogChoice> {
		const selection = await dialog.showOpenDialog(dependencies.browserWindow, {
			...options,
			properties: ["openFile"],
			filters: [
				{ name: "Text files", extensions: ["txt"] },
				{ name: "All files", extensions: ["*"] },
			],
		});
		const selected = selection.filePaths[0];

		if (selection.canceled || !selected) return null;

		const filePath = await grantPath(selected, dependencies);

		return { path: filePath, hash: (await readFileSnapshot(filePath))?.hash ?? null };
	}
}
