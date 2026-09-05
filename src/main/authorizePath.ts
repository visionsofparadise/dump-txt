import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { IpcError } from "../shared/models/IpcFailure";
import type { IpcHandlerDependencies } from "../shared/models/IpcHandlerDependencies";

function comparisonPath(filePath: string): string {
	return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

export async function canonicalPath(filePath: string): Promise<string> {
	if (!path.isAbsolute(filePath) || filePath.includes("\0"))
		throw new IpcError({ code: "invalid", message: "A full file path is required." });

	const resolved = path.resolve(filePath);

	try {
		return await realpath(resolved);
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;

		try {
			const information = await lstat(resolved);

			if (information.isSymbolicLink())
				throw new IpcError({
					code: "permission",
					message: "The file points to an unavailable symbolic-link destination.",
				});
		} catch (statError) {
			if (!(statError instanceof Error) || !("code" in statError) || statError.code !== "ENOENT") throw statError;
		}

		const parent = path.dirname(resolved);

		if (parent === resolved) throw error;

		return path.join(await canonicalPath(parent), path.basename(resolved));
	}
}

export async function grantPath(
	filePath: string,
	dependencies: Pick<IpcHandlerDependencies, "grants">,
	allowUnavailable = false,
): Promise<string> {
	if (!path.isAbsolute(filePath) || filePath.includes("\0"))
		throw new IpcError({ code: "invalid", message: "A full file path is required." });

	let canonical: string;

	try {
		canonical = await canonicalPath(filePath);
	} catch (error) {
		if (!allowUnavailable) throw error;

		canonical = path.resolve(filePath);
	}

	dependencies.grants.add(comparisonPath(canonical));

	return canonical;
}

export async function authorizePath(
	filePath: string,
	dependencies: Pick<IpcHandlerDependencies, "userData" | "grants">,
): Promise<string> {
	const canonical = await canonicalPath(filePath);
	const base = await canonicalPath(dependencies.userData);
	const relative = path.relative(comparisonPath(base), comparisonPath(canonical));

	if (
		(!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)) ||
		dependencies.grants.has(comparisonPath(canonical))
	)
		return canonical;

	throw new IpcError({
		code: "permission",
		message: "Open or choose this file with the file menu before accessing it.",
	});
}
