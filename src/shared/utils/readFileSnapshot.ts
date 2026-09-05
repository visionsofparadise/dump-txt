import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FileRead } from "../ipc/FileSystem/readFile/Renderer";

export async function readFileSnapshot(filePath: string): Promise<FileRead | null> {
	try {
		const bytes = await readFile(filePath);

		return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;

		throw error;
	}
}
