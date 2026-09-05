import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizePath, canonicalPath, grantPath } from "./authorizePath";

let directory: string;
let userData: string;
let external: string;
const scratch = path.resolve(".scratch");

beforeEach(async () => {
	await mkdir(scratch, { recursive: true });
	directory = await mkdtemp(path.join(scratch, "dump-native-"));
	userData = path.join(directory, "owned");
	external = path.join(directory, "external");
	await Promise.all([mkdir(userData), mkdir(external)]);
});

afterEach(async () => {
	if (directory.startsWith(scratch + path.sep)) await rm(directory, { recursive: true, force: true });
});

describe("canonical file authorization", () => {
	it("allows existing and new app-owned files", async () => {
		const filePath = path.join(userData, "dump.txt");
		await writeFile(filePath, "text");
		const dependencies = { userData, grants: new Set<string>() };
		expect(await authorizePath(filePath, dependencies)).toBe(await canonicalPath(filePath));
		expect(await authorizePath(path.join(userData, "new.json"), dependencies)).toBe(
			path.join(await canonicalPath(userData), "new.json"),
		);
	});

	it("rejects parent traversal, prefix collisions and ungranted external files", async () => {
		const dependencies = { userData, grants: new Set<string>() };
		for (const filePath of [
			path.join(userData, "..", "external", "secret.txt"),
			`${userData}-other/secret.txt`,
			path.join(external, "secret.txt"),
		])
			await expect(authorizePath(filePath, dependencies)).rejects.toMatchObject({ code: "permission" });
		await expect(authorizePath("relative.txt", dependencies)).rejects.toMatchObject({ code: "invalid" });
	});

	it("admits only the exact canonical native-dialog grant", async () => {
		const dependencies = { userData, grants: new Set<string>() };
		const chosen = path.join(external, "chosen.txt");
		await grantPath(chosen, dependencies);
		expect(await authorizePath(chosen, dependencies)).toBe(await canonicalPath(chosen));
		await expect(authorizePath(path.join(external, "another.txt"), dependencies)).rejects.toMatchObject({
			code: "permission",
		});
	});

	it("rejects app-owned directory links escaping to external data", async () => {
		await writeFile(path.join(external, "secret.txt"), "external");
		await symlink(external, path.join(userData, "link"), process.platform === "win32" ? "junction" : "dir");
		await expect(
			authorizePath(path.join(userData, "link", "secret.txt"), { userData, grants: new Set<string>() }),
		).rejects.toMatchObject({ code: "permission" });
		await expect(
			authorizePath(path.join(userData, "link", "new.txt"), { userData, grants: new Set<string>() }),
		).rejects.toMatchObject({ code: "permission" });
		expect(await readFile(path.join(external, "secret.txt"), "utf8")).toBe("external");
	});

	it("retains a trusted restored path when a parent is temporarily unavailable", async () => {
		const unavailableParent = path.join(external, "was-a-directory");
		await symlink(
			path.join(external, "offline-drive"),
			unavailableParent,
			process.platform === "win32" ? "junction" : "dir",
		);
		const recordedPath = path.join(unavailableParent, "dump.txt");
		const dependencies = { userData, grants: new Set<string>() };
		expect(await grantPath(recordedPath, dependencies, true)).toBe(recordedPath);
		expect(dependencies.grants.size).toBe(1);
		await expect(grantPath(recordedPath, { grants: new Set<string>() })).rejects.toBeInstanceOf(Error);
		await unlink(unavailableParent);
		await mkdir(unavailableParent);
		expect(await authorizePath(recordedPath, dependencies)).toBe(recordedPath);
	});
});
