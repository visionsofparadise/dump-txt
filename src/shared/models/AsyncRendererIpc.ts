import { z } from "zod";
import { IpcError, ipcFailureSchema, type IpcResult } from "./IpcFailure";
import type { IpcRenderer } from "electron";

export abstract class AsyncRendererIpc<Action extends string, Parameters extends Array<unknown>, Result> {
	abstract readonly action: Action;
	abstract readonly response: z.ZodType<Result>;

	register(
		renderer: Pick<IpcRenderer, "invoke">,
	): readonly [Action, (...parameters: Parameters) => Promise<IpcResult<Result>>] {
		return [
			this.action,
			async (...parameters: Parameters) => {
				const response: unknown = await renderer.invoke(this.action, ...parameters);
				const result = z
					.discriminatedUnion("ok", [
						z.object({ ok: z.literal(true), value: this.response }),
						z.object({ ok: z.literal(false), error: ipcFailureSchema }),
					])
					.parse(response);

				return result;
			},
		];
	}

	connect(
		invoke: (...parameters: Parameters) => Promise<IpcResult<Result>>,
	): (...parameters: Parameters) => Promise<Result> {
		return async (...parameters: Parameters) => {
			const result = await invoke(...parameters);

			if (!result.ok) throw new IpcError(result.error);

			return result.value;
		};
	}
}
