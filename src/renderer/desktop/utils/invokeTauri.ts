import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { failureOf, IpcError, ipcFailureSchema } from "../../models/IpcFailure";

export async function invokeTauri<Value>(
	command: string,
	request: Readonly<Record<string, unknown>>,
	response: z.ZodType<Value>,
): Promise<Value> {
	try {
		const result = z
			.discriminatedUnion("ok", [
				z.object({ ok: z.literal(true), value: response }),
				z.object({ ok: z.literal(false), error: ipcFailureSchema }),
			])
			.parse(await invoke<unknown>(command, { request }));

		if (!result.ok) throw new IpcError(result.error);

		return result.value;
	} catch (error) {
		throw new IpcError(failureOf(error));
	}
}

export const nativeVoid = z.null().transform(() => undefined);
