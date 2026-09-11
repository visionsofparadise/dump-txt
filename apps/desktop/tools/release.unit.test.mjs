import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { artifactNamesOf, publishRelease, writeChecksums } from "./release.mjs";
import { normalizeTauriPackages } from "./normalizeTauriPackages.mjs";

const directories = [];
const sha = "a".repeat(40);
const other = "b".repeat(40);

test("normalizes all six Tauri packages to the existing release contract", () => {
	mkdirSync(resolve(".scratch"), { recursive: true });
	const directory = mkdtempSync(join(resolve(".scratch"), "tauri-packages-"));
	directories.push(directory);
	for (const [platform, architecture, type, source, expected] of [
		["win32", "x64", "nsis", "dump.txt_0.2.0_x64-setup.exe", "dump-txt-0.2.0-windows-x64.exe"],
		["win32", "arm64", "nsis", "dump.txt_0.2.0_arm64-setup.exe", "dump-txt-0.2.0-windows-arm64.exe"],
		["darwin", "arm64", "dmg", "dump.txt_0.2.0_aarch64.dmg", "dump-txt-0.2.0-mac-arm64.dmg"],
		["darwin", "x64", "dmg", "dump.txt_0.2.0_x64.dmg", "dump-txt-0.2.0-mac-x64.dmg"],
		["linux", "x64", "appimage", "dump.txt_0.2.0_amd64.AppImage", "dump-txt-0.2.0-linux-x86_64.AppImage"],
		["linux", "x64", "deb", "dump-txt_0.2.0_amd64.deb", "dump-txt-0.2.0-linux-amd64.deb"],
	]) {
		const bundle = join(directory, "target", "release", "bundle", type);
		mkdirSync(bundle, { recursive: true });
		writeFileSync(join(bundle, source), expected);
		if (type === "appimage") continue;
		normalizeTauriPackages(directory, "0.2.0", platform, architecture);
		assert.equal(readFileSync(join(directory, "out", "make", expected), "utf8"), expected);
		if (type === "dmg" || type === "nsis") rmSync(join(bundle, source));
	}
	writeChecksums(join(directory, "out", "make"), "0.2.0");
});

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function fixture({ release = null, target = null, failure = null, corrupt = false } = {}) {
	const scratch = resolve(".scratch");
	mkdirSync(scratch, { recursive: true });
	const directory = mkdtempSync(join(scratch, "release-test-"));
	directories.push(directory);
	const artifact = "dump-txt-0.1.0-windows-x64.exe";
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
	const publish = (draftOnly = false) =>
		publishRelease({ repository: "example/dump-txt", sha, version: "0.1.0", directory, draftOnly, run });
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

test("includes the version, platform, and architecture in every artifact name", () => {
	assert.deepEqual(artifactNamesOf("0.2.0"), [
		"dump-txt-0.2.0-linux-amd64.deb",
		"dump-txt-0.2.0-linux-x86_64.AppImage",
		"dump-txt-0.2.0-mac-arm64.dmg",
		"dump-txt-0.2.0-mac-x64.dmg",
		"dump-txt-0.2.0-windows-arm64.exe",
		"dump-txt-0.2.0-windows-x64.exe",
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

test("holds a verified draft for review and publishes it when the hold is removed", () => {
	const { publish, calls, directory } = fixture();
	assert.equal(publish(true), "draft ready for review");
	const upload = calls.find((call) => call[1] === "upload");
	const download = calls.find((call) => call[1] === "download");
	for (const name of [...artifactNamesOf("0.1.0"), "SHA256SUMS"]) {
		assert.ok(upload.includes(join(directory, name)));
		assert.ok(download.includes(name));
	}
	assert.ok(!calls.some((call) => call[1] === "edit"));
	assert.equal(publish(), "published");
	assert.equal(calls.filter((call) => call[1] === "create").length, 1);
});

test("rejects corrupted downloads while holding a release for review", () => {
	const { publish, calls } = fixture({ corrupt: true });
	assert.throws(() => publish(true), /checksum verification/u);
	assert.ok(!calls.some((call) => call[1] === "edit"));
});
