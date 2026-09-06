import { Menu } from "electron";
import { z } from "zod";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import {
	SHOW_TEXT_CONTEXT_MENU_ACTION,
	TEXT_CONTEXT_MENU_STATE,
	type TextContextMenuResponse,
	type TextContextMenuState,
} from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class ShowTextContextMenuMainIpc extends AsyncMainIpc<[state: TextContextMenuState], TextContextMenuResponse> {
	readonly action = SHOW_TEXT_CONTEXT_MENU_ACTION;
	readonly parameters = z.tuple([TEXT_CONTEXT_MENU_STATE]);

	handler(state: TextContextMenuState, { browserWindow }: IpcHandlerDependencies): Promise<TextContextMenuResponse> {
		if (browserWindow.isDestroyed()) return Promise.resolve(null);

		return new Promise((resolve) => {
			let settled = false;
			const finish = (response: TextContextMenuResponse) => {
				if (settled) return;

				settled = true;
				browserWindow.removeListener("closed", close);
				resolve(response);
			};
			const close = () => finish(null);
			const menu = Menu.buildFromTemplate([
				{ label: "Undo", enabled: state.canUndo && !state.locked, click: () => finish("undo") },
				{ label: "Redo", enabled: state.canRedo && !state.locked, click: () => finish("redo") },
				{ type: "separator" },
				{ role: "cut", enabled: state.hasSelection && !state.locked },
				{ role: "copy", enabled: state.hasSelection },
				{ role: "paste", enabled: !state.locked },
				{ label: "Delete", enabled: state.hasSelection && !state.locked, click: () => finish("delete") },
				{ type: "separator" },
				{ role: "selectAll" },
			]);

			browserWindow.once("closed", close);
			menu.popup({ window: browserWindow, callback: close });
		});
	}
}
