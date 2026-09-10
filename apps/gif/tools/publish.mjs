import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { purgeDemoCache } from "./purgeDemoCache.mjs";

async function requestGithub(method, endpoint, body) {
	const response = await fetch(`https://api.github.com/${endpoint}`, {
		method,
		headers: {
			Authorization: `Bearer ${process.env.GH_TOKEN}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	if (response.status === 404 && method === "GET") return null;
	if (!response.ok) throw new Error(`GitHub ${method} ${endpoint} failed: ${response.status}`);

	return response.json();
}

async function targetOf(repository, tag, request) {
	const reference = await request("GET", `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`);
	let object = reference?.object;

	for (let depth = 0; object?.type === "tag" && depth < 10; depth++)
		object = (await request("GET", `repos/${repository}/git/tags/${object.sha}`))?.object;

	if (object?.type !== "commit" || !/^[a-f0-9]{40}$/u.test(object.sha))
		throw new Error("Release tag does not resolve to a commit");

	return object.sha;
}

export async function publishDemo({ repository, tag, directory, request = requestGithub }) {
	if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(repository) || !/^v\d+\.\d+\.\d+$/u.test(tag))
		throw new Error("A repository and stable release tag are required");

	const base = `repos/${repository}`;
	const latest = await request("GET", `${base}/releases/latest`);

	if (!latest || latest.draft || latest.prerelease || latest.tag_name !== tag) return "superseded";

	const image = readFileSync(join(directory, "demo.gif"));
	const manifest = JSON.parse(readFileSync(join(directory, "demo.json"), "utf8"));
	const releaseSha = await targetOf(repository, tag, request);

	if (
		manifest.releaseSha !== releaseSha ||
		manifest.sourceDirty !== false ||
		manifest.sha256 !== createHash("sha256").update(image).digest("hex") ||
		!/^GIF8[79]a$/u.test(image.subarray(0, 6).toString("ascii")) ||
		!Number.isInteger(manifest.frames) ||
		manifest.frames < 2 ||
		![manifest.width, manifest.height, manifest.fps].every((value) => Number.isFinite(value) && value > 0)
	)
		throw new Error("Demo output does not match the released commit or validated GIF manifest");

	const reference = await request("GET", `${base}/git/ref/heads/media`);
	const tree = [];

	for (const [path, content] of [
		["demo.gif", image],
		["demo.json", Buffer.from(`${JSON.stringify({ ...manifest, releaseTag: tag }, null, 2)}\n`)],
	]) {
		const blob = await request("POST", `${base}/git/blobs`, {
			encoding: "base64",
			content: content.toString("base64"),
		});

		tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
	}

	const createdTree = await request("POST", `${base}/git/trees`, { tree });
	const commit = await request("POST", `${base}/git/commits`, {
		message: `docs(demo): render ${tag}`,
		tree: createdTree.sha,
		parents: reference ? [reference.object.sha] : [],
	});
	const current = await request("GET", `${base}/releases/latest`);

	if (current?.id !== latest.id || current.tag_name !== tag || current.draft || current.prerelease)
		return "superseded";
	if ((await targetOf(repository, tag, request)) !== releaseSha)
		throw new Error("Release tag changed during publication");

	if (reference) await request("PATCH", `${base}/git/refs/heads/media`, { sha: commit.sha, force: false });
	else await request("POST", `${base}/git/refs`, { ref: "refs/heads/media", sha: commit.sha });

	return "published";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [command, directory = fileURLToPath(new URL("../out", import.meta.url))] = process.argv.slice(2);

	if (command === "publish") {
		const result = await publishDemo({
			repository: process.env.GITHUB_REPOSITORY,
			tag: process.env.DEMO_RELEASE_TAG,
			directory,
		});

		console.log(result);

		if (result === "published") await purgeDemoCache({ repository: process.env.GITHUB_REPOSITORY });
	} else if (command === "verify") {
		if (execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim())
			throw new Error("Release rendering requires a clean checkout");

		const actual = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		const expected = await targetOf(process.env.GITHUB_REPOSITORY, process.env.DEMO_RELEASE_TAG, requestGithub);

		if (actual !== expected) throw new Error("Checkout does not match the exact released commit");
		console.log(`Rendering ${process.env.DEMO_RELEASE_TAG} at ${actual}`);
	} else throw new Error("Usage: node tools/publish.mjs verify|publish [output-directory]");
}
