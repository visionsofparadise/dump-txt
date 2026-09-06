import { IpcError } from "../../shared/models/IpcFailure";
import { contentHashOf } from "../utils/contentHashOf";
import { probeText } from "./probeText";
import type { Main } from "../models/Main";

function checkPath(path: string): void {
	if (
		!path.startsWith("/fixture/") ||
		path.includes("\\") ||
		path.includes("\0") ||
		path
			.split("/")
			.slice(2)
			.some((part) => part === ".." || part === "." || part === "")
	)
		throw new IpcError({ code: "permission", message: "Probe files must stay inside /fixture." });
}

export function createProbeMain(native: Main): Main {
	const files = new Map([["/fixture/dump.txt", new TextEncoder().encode(probeText)]]);
	let writes = Promise.resolve();

	return {
		...native,
		getPaths: () => Promise.resolve({ userData: "/fixture", restoredFilePath: null, startupSettings: null }),
		readFile: async (path) => {
			checkPath(path);
			await writes;

			const stored = files.get(path);
			const bytes = stored ? new Uint8Array(stored) : null;

			return bytes ? { bytes, hash: await contentHashOf(bytes) } : null;
		},
		writeFile: (request) => {
			const bytes = new Uint8Array(request.bytes);
			const { path, expectedHash } = request;
			const result = writes.then(async () => {
				checkPath(path);

				const previous = files.get(path);
				const previousHash = previous ? await contentHashOf(previous) : null;

				if (previousHash !== expectedHash)
					throw new IpcError({ code: previous ? "conflict" : "missing", message: "The probe file has changed." });

				const hash = await contentHashOf(bytes);

				files.set(path, bytes);

				return { hash };
			});

			writes = result.then(
				() => undefined,
				() => undefined,
			);

			return result;
		},
		showOpenDialog: () => Promise.resolve(null),
		showSaveDialog: () => Promise.resolve(null),
	};
}
