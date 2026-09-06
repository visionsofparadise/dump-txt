import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { artifactNamesOf, publishRelease, writeChecksums } from "./release.mjs";
import { buildTarget } from "./buildTarget.mjs";

const directories = [];
const sha = "a".repeat(40);
const other = "b".repeat(40);

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function fixture({ release = null, target = null, failure = null, corrupt = false } = {}) {
	const scratch = resolve(".scratch");
	mkdirSync(scratch, { recursive: true });
	const directory = mkdtempSync(join(scratch, "release-test-"));
	directories.push(directory);
	const artifact = "dump-txt-Setup-0.1.0.exe";
	for (const name of artifactNamesOf("0.1.0")) writeFileSync(join(directory, name), `test installer bytes: ${name}`);
	writeChecksums(directory, "0.1.0");
	const calls = [];
	const run = (arguments_) => {
		calls.push(arguments_);
		const [command, action] = arguments_;
		if (command === "api") {
			if (failure) throw failure;
			const result = action.includes("releases/tags")
				? release
				: target
					? { object: { type: "commit", sha: target } }
					: null;
			if (!result)
				throw Object.assign(new Error("HTTP 404"), {
					stdout: JSON.stringify({ status: "404", message: "Not Found" }),
				});
			return JSON.stringify(result);
		}
		if (action === "create") release = { draft: true, target_commitish: sha };
		if (action === "download") {
			const destination = arguments_[arguments_.indexOf("--dir") + 1];
			for (const name of artifactNamesOf("0.1.0")) copyFileSync(join(directory, name), join(destination, name));
			copyFileSync(join(directory, "SHA256SUMS"), join(destination, "SHA256SUMS"));
			if (corrupt) writeFileSync(join(destination, artifact), "corrupted");
		}
		if (action === "edit") target = sha;
		return "";
	};
	const publish = () => publishRelease({ repository: "example/dump-txt", sha, version: "0.1.0", directory, run });
	return { calls, publish, directory };
}

test("publishes an absent version at the README triggering commit, independent of preceding version commits", () => {
	const { publish, calls } = fixture();
	assert.equal(publish(), "published");
	const create = calls.find((call) => call[1] === "create");
	assert.equal(create[create.indexOf("--target") + 1], sha);
	assert.ok(calls.findIndex((call) => call[1] === "download") < calls.findIndex((call) => call[1] === "edit"));
});

test("skips an already published version on a later main commit", () => {
	const { publish, calls } = fixture({ release: { draft: false }, target: other });
	assert.equal(publish(), "already published");
	assert.equal(calls.length, 1);
});

test("recovers a matching incomplete draft by replacing and verifying both assets", () => {
	const { publish, calls } = fixture({ release: { draft: true, target_commitish: sha } });
	assert.equal(publish(), "published");
	assert.ok(!calls.some((call) => call[1] === "create"));
	assert.ok(calls.find((call) => call[1] === "upload").includes("--clobber"));
});

test("accepts an existing matching tag without a release", () => {
	const { publish } = fixture({ target: sha });
	assert.equal(publish(), "published");
});

test("rejects a conflicting tag before remote writes", () => {
	const { publish, calls } = fixture({ target: other });
	assert.throws(publish, /another commit/u);
	assert.ok(calls.every((call) => call[0] === "api"));
});

test("rejects a draft for another commit when no tag exists", () => {
	const { publish, calls } = fixture({ release: { draft: true, target_commitish: other } });
	assert.throws(publish, /another commit/u);
	assert.ok(calls.every((call) => call[0] === "api"));
});

test("propagates API and network errors instead of interpreting them as missing releases", () => {
	for (const failure of [
		new Error("network unavailable"),
		Object.assign(new Error("HTTP 403"), { stdout: '{"status":"403","message":"Forbidden"}' }),
	]) {
		const { publish, calls } = fixture({ failure });
		assert.throws(publish, (error) => error === failure);
		assert.equal(calls.length, 1);
	}
});

test("rejects invalid local checksums before API access", () => {
	const { publish, directory, calls } = fixture();
	writeFileSync(join(directory, "SHA256SUMS"), "wrong");
	assert.throws(publish, /checksum/u);
	assert.equal(calls.length, 0);
});

test("leaves a draft unpublished when downloaded release bytes fail verification", () => {
	const { publish, calls } = fixture({ corrupt: true });
	assert.throws(publish, /checksum verification/u);
	assert.ok(!calls.some((call) => call[1] === "edit"));
});

test("rejects malformed versions without accessing files or running commands", () => {
	assert.throws(() => publishRelease({ version: "../bad" }), /version/u);
});

test("matches the platform artifact names emitted by electron-builder", () => {
	assert.deepEqual(artifactNamesOf("0.2.0"), [
		"dump-txt-0.2.0-linux-amd64.deb",
		"dump-txt-0.2.0-linux-x86_64.AppImage",
		"dump-txt-0.2.0-mac-arm64.dmg",
		"dump-txt-0.2.0-mac-x64.dmg",
		"dump-txt-Setup-0.2.0.exe",
	]);
});

test("requires every platform artifact before publishing", () => {
	const { publish, directory, calls } = fixture();
	rmSync(join(directory, "dump-txt-0.1.0-mac-arm64.dmg"));
	assert.throws(publish, /ENOENT/u);
	assert.equal(calls.length, 0);
});

test("uploads and verifies every platform artifact", () => {
	const { publish, calls, directory } = fixture();
	publish();
	const upload = calls.find((call) => call[1] === "upload");
	const download = calls.find((call) => call[1] === "download");
	for (const name of artifactNamesOf("0.1.0")) {
		assert.ok(upload.includes(join(directory, name)));
		assert.ok(download.includes(name));
	}
});

test("resolves executable paths for every supported build", () => {
	assert.equal(buildTarget("win32", "x64").executable, join("out", "dump.txt-win32-x64", "dump-txt.exe"));
	assert.equal(buildTarget("linux", "x64").executable, join("out", "dump.txt-linux-x64", "dump-txt"));
	for (const arch of ["arm64", "x64"])
		assert.equal(
			buildTarget("darwin", arch).executable,
			join("out", `dump.txt-darwin-${arch}`, "dump.txt.app", "Contents", "MacOS", "dump-txt"),
		);
	assert.throws(() => buildTarget("linux", "arm64"), /Unsupported/u);
});
