import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export const MINIMIZE_ACTION = "minimize" as const;
export class MinimizeRendererIpc extends AsyncRendererIpc<typeof MINIMIZE_ACTION, [], void> {
	readonly action = MINIMIZE_ACTION;
	readonly response = z.void();
}
