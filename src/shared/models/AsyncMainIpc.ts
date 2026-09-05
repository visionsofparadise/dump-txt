import { failureOf, type IpcResult } from "./IpcFailure";
import type { IpcHandlerDependencies } from "./IpcHandlerDependencies";
import type { z } from "zod";

export abstract class AsyncMainIpc<Parameters extends Array<unknown>, Result> {
	abstract readonly action: string;
	abstract readonly parameters: z.ZodType<Parameters>;
	abstract handler(...parameters: [...Parameters, IpcHandlerDependencies]): Promise<Result>;

	async execute(parameters: Array<unknown>, dependencies: IpcHandlerDependencies): Promise<IpcResult<Result>> {
		try {
			return { ok: true, value: await this.handler(...this.parameters.parse(parameters), dependencies) };
		} catch (error) {
			return { ok: false, error: failureOf(error) };
		}
	}

	register(dependencies: IpcHandlerDependencies): () => void {
		const { browserWindow } = dependencies;
		const ipc = browserWindow.webContents.ipc;

		ipc.handle(this.action, (event, ...parameters: Array<unknown>) => {
			if (event.senderFrame !== browserWindow.webContents.mainFrame)
				return { ok: false, error: { code: "permission", message: "This frame cannot use desktop capabilities." } };

			return this.execute(parameters, dependencies);
		});

		return () => ipc.removeHandler(this.action);
	}
}
