import { z } from "zod";

export const ipcFailureSchema = z.object({
	code: z.enum(["missing", "conflict", "permission", "invalid", "io"]),
	message: z.string(),
});

export type IpcFailure = z.infer<typeof ipcFailureSchema>;

export class IpcError extends Error {
	readonly code: IpcFailure["code"];
	constructor(failure: IpcFailure) {
		super(failure.message);
		this.name = "IpcError";
		this.code = failure.code;
	}
}

export function failureOf(error: unknown): IpcFailure {
	if (error instanceof IpcError) return { code: error.code, message: error.message };

	if (error instanceof z.ZodError)
		return { code: "invalid", message: "The requested action contains invalid values." };

	const native = z.object({ code: z.string(), message: z.string() }).safeParse(error);

	if (native.success) {
		const code =
			native.data.code === "ENOENT"
				? "missing"
				: ["EACCES", "EPERM"].includes(native.data.code)
					? "permission"
					: "io";

		return { code, message: native.data.message };
	}

	return { code: "io", message: error instanceof Error ? error.message : "The requested action failed." };
}
