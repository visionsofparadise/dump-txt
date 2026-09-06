import { clipboard } from "electron";
import { z } from "zod";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { READ_CLIPBOARD_ACTION } from "./Renderer";

export class ReadClipboardMainIpc extends AsyncMainIpc<[], string> {
	readonly action = READ_CLIPBOARD_ACTION;
	readonly parameters = z.tuple([]);

	handler(): Promise<string> {
		return clipboard.readText();
	}
}
