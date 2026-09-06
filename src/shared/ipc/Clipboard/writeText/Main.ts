import { clipboard } from "electron";
import { z } from "zod";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { WRITE_CLIPBOARD_ACTION } from "./Renderer";

export class WriteClipboardMainIpc extends AsyncMainIpc<[text: string], void> {
	readonly action = WRITE_CLIPBOARD_ACTION;
	readonly parameters = z.tuple([z.string()]);

	handler(text: string): Promise<void> {
		return clipboard.writeText(text);
	}
}
