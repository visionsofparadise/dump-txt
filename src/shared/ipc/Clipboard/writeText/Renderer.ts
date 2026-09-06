import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export const WRITE_CLIPBOARD_ACTION = "writeClipboard" as const;

export class WriteClipboardRendererIpc extends AsyncRendererIpc<typeof WRITE_CLIPBOARD_ACTION, [text: string], void> {
	readonly action = WRITE_CLIPBOARD_ACTION;
	readonly response = z.void();
}
