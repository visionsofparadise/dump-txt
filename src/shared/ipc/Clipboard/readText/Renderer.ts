import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export const READ_CLIPBOARD_ACTION = "readClipboard" as const;

export class ReadClipboardRendererIpc extends AsyncRendererIpc<typeof READ_CLIPBOARD_ACTION, [], string> {
	readonly action = READ_CLIPBOARD_ACTION;
	readonly response = z.string();
}
