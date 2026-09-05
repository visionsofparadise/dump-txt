import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export const TOGGLE_MAXIMIZE_ACTION = "toggleMaximize" as const;
export class ToggleMaximizeRendererIpc extends AsyncRendererIpc<typeof TOGGLE_MAXIMIZE_ACTION, [], void> {
	readonly action = TOGGLE_MAXIMIZE_ACTION;
	readonly response = z.void();
}
