import { z } from "zod";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type SetTitleParameters = [title: string];
export const SET_TITLE_ACTION = "setTitle" as const;

export class SetTitleRendererIpc extends AsyncRendererIpc<typeof SET_TITLE_ACTION, SetTitleParameters, void> {
	readonly action = SET_TITLE_ACTION;
	readonly response = z.void();
}
