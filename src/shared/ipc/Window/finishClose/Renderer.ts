import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export const FINISH_CLOSE_ACTION = "finishClose" as const;
export class FinishCloseRendererIpc extends AsyncRendererIpc<typeof FINISH_CLOSE_ACTION, [], void> {
	readonly action = FINISH_CLOSE_ACTION;
	readonly response = z.void();
}
