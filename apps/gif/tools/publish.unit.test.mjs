import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { publishDemo } from "./publish.mjs";

const directories = [];
const releaseSha = "a".repeat(40);

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function fixture({ existing = true, stale = false, changes = false, conflict = false, annotated = false } = {}) {
	const scratch = resolve(".scratch");

	mkdirSync(scratch, { recursive: true });

	const directory = mkdtempSync(join(scratch, "demo-publish-"));
	const image = Buffer.from("GIF89a demo test fixture");
	const manifest = {
		releaseSha,
		sourceDirty: false,
		sha256: createHash("sha256").update(image).digest("hex"),
		frames: 20,
		fps: 20,
		width: 960,
		height: 720,
	};
	const calls = [];
	let latestReads = 0;
	let tagReads = 0;

	directories.push(directory);
	writeFileSync(join(directory, "demo.gif"), image);
	writeFileSync(join(directory, "demo.json"), JSON.stringify(manifest));

	const request = async (method, endpoint, body) => {
		calls.push({ method, endpoint, body });

		if (endpoint.endsWith("releases/latest")) {
			latestReads++;

			return {
				id: stale || (changes && latestReads > 1) ? 2 : 1,
				tag_name: stale || (changes && latestReads > 1) ? "v0.5.0" : "v0.4.0",
				draft: false,
				prerelease: false,
			};
		}
		if (endpoint.includes("git/ref/tags")) {
			tagReads++;

			return { object: { type: annotated ? "tag" : "commit", sha: releaseSha } };
		}
		if (endpoint.includes("git/tags")) return { object: { type: "commit", sha: releaseSha } };
		if (endpoint.endsWith("git/ref/heads/media")) return existing ? { object: { sha: "old-media" } } : null;
		if (method === "PATCH" && conflict) throw new Error("Reference is not a fast forward");

		return { sha: endpoint.endsWith("git/commits") ? "new-media" : "blob-or-tree" };
	};

	return { directory, manifest, calls, request, tagReads: () => tagReads };
}

function publish(fixture_) {
	return publishDemo({
		repository: "example/dump-txt",
		tag: "v0.4.0",
		directory: fixture_.directory,
		request: fixture_.request,
	});
}

test("atomically replaces GIF and manifest through a non-forced media ref update", async () => {
	const fixture_ = fixture();

	assert.equal(await publish(fixture_), "published");
	assert.deepEqual(
		fixture_.calls.find(({ endpoint }) => endpoint.endsWith("git/trees")).body.tree.map(({ path }) => path),
		["demo.gif", "demo.json"],
	);
	assert.deepEqual(fixture_.calls.find(({ endpoint }) => endpoint.endsWith("git/commits")).body.parents, [
		"old-media",
	]);
	assert.deepEqual(fixture_.calls.at(-1), {
		method: "PATCH",
		endpoint: "repos/example/dump-txt/git/refs/heads/media",
		body: { sha: "new-media", force: false },
	});
	assert.equal(fixture_.tagReads(), 2);
});

test("creates an isolated media branch for the first successful render", async () => {
	const fixture_ = fixture({ existing: false });

	assert.equal(await publish(fixture_), "published");
	assert.deepEqual(fixture_.calls.find(({ endpoint }) => endpoint.endsWith("git/commits")).body.parents, []);
	assert.deepEqual(fixture_.calls.at(-1).body, { ref: "refs/heads/media", sha: "new-media" });
});

test("skips old release runs without writing any objects", async () => {
	const fixture_ = fixture({ stale: true });

	assert.equal(await publish(fixture_), "superseded");
	assert.equal(fixture_.calls.length, 1);
});

test("retains the previous GIF when a newer release appears during publication", async () => {
	const fixture_ = fixture({ changes: true });

	assert.equal(await publish(fixture_), "superseded");
	assert.equal(
		fixture_.calls.some(({ method }) => method === "PATCH"),
		false,
	);
	assert.equal(
		fixture_.calls.some(({ endpoint }) => endpoint.endsWith("git/refs")),
		false,
	);
});

test("refuses a GIF from a different source commit", async () => {
	const fixture_ = fixture();

	writeFileSync(
		join(fixture_.directory, "demo.json"),
		JSON.stringify({ ...fixture_.manifest, releaseSha: "b".repeat(40) }),
	);
	await assert.rejects(publish(fixture_), /does not match/u);
	assert.equal(
		fixture_.calls.every(({ method }) => method === "GET"),
		true,
	);
});

test("refuses an altered GIF before publishing", async () => {
	const fixture_ = fixture();

	writeFileSync(join(fixture_.directory, "demo.gif"), "GIF89a changed");
	await assert.rejects(publish(fixture_), /does not match/u);
	assert.equal(
		fixture_.calls.every(({ method }) => method === "GET"),
		true,
	);
});

test("refuses previews rendered from modified source even at a release commit", async () => {
	const fixture_ = fixture();

	writeFileSync(join(fixture_.directory, "demo.json"), JSON.stringify({ ...fixture_.manifest, sourceDirty: true }));
	await assert.rejects(publish(fixture_), /does not match/u);
	assert.equal(
		fixture_.calls.every(({ method }) => method === "GET"),
		true,
	);
});

test("does not force overwrite a concurrently changed branch", async () => {
	const fixture_ = fixture({ conflict: true });

	await assert.rejects(publish(fixture_), /not a fast forward/u);
	assert.equal(fixture_.calls.at(-1).body.force, false);
});

test("resolves annotated release tags to their source commit", async () => {
	const fixture_ = fixture({ annotated: true });

	assert.equal(await publish(fixture_), "published");
	assert.equal(fixture_.calls.filter(({ endpoint }) => endpoint.includes("/git/tags/")).length, 2);
});
