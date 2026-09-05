import { createHash } from "node:crypto";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import { authorizePath } from "../../../../main/authorizePath";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { IpcError } from "../../../models/IpcFailure";
import { readFileSnapshot } from "../../../utils/readFileSnapshot";
import { WRITE_FILE_ACTION, type WriteFileParameters, type WriteRequest } from "./Renderer";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

export class WriteFileMainIpc extends AsyncMainIpc<WriteFileParameters, { hash: string }> {
	readonly action = WRITE_FILE_ACTION;
	readonly parameters = z.tuple([
		z
			.object({
				path: z.string().min(1),
				bytes: z.instanceof(Uint8Array),
				expectedHash: z
					.string()
					.regex(/^[a-f0-9]{64}$/u)
					.nullable(),
			})
			.strict(),
	]);
	async handler(request: WriteRequest, dependencies: IpcHandlerDependencies): Promise<{ hash: string }> {
		const filePath = await authorizePath(request.path, dependencies);
		const actualHash = (await readFileSnapshot(filePath))?.hash ?? null;

		if (actualHash !== request.expectedHash)
			throw new IpcError({
				code: actualHash === null ? "missing" : "conflict",
				message:
					actualHash === null
						? "The file is missing. Use Save As to choose a location."
						: "The file changed outside dump.txt. Use Save As to preserve this text.",
			});

		const bytes = Buffer.from(request.bytes);

		await writeFileAtomic(filePath, bytes);

		return { hash: createHash("sha256").update(bytes).digest("hex") };
	}
}
