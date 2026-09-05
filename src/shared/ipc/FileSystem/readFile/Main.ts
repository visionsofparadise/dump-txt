import { z } from "zod";
import { authorizePath } from "../../../../main/authorizePath";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { readFileSnapshot } from "../../../utils/readFileSnapshot";
import { READ_FILE_ACTION, type FileRead, type ReadFileParameters } from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class ReadFileMainIpc extends AsyncMainIpc<ReadFileParameters, FileRead | null> {
	readonly action = READ_FILE_ACTION;
	readonly parameters = z.tuple([z.string().min(1)]);
	async handler(filePath: string, dependencies: IpcHandlerDependencies): Promise<FileRead | null> {
		const authorized = await authorizePath(filePath, dependencies);

		return readFileSnapshot(authorized);
	}
}
