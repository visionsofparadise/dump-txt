import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function runGh(arguments_) {
	return execFileSync("gh", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function api(endpoint, run) {
	try {
		return JSON.parse(run(["api", endpoint]));
	} catch (error) {
		if (error && typeof error === "object" && "stdout" in error) {
			let response;

			try {
				response = JSON.parse(String(error.stdout));
			} catch {
				throw error;
			}

			if (response.status === "404" && response.message === "Not Found") return null;
		}

		throw error;
	}
}

export function artifactNamesOf(version) {
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version))
		throw new Error("Release version must be a stable major.minor.patch version");

	return [
		`dump-txt-${version}-windows-x64.exe`,
		`dump-txt-${version}-mac-arm64.dmg`,
		`dump-txt-${version}-mac-x64.dmg`,
		`dump-txt-${version}-linux-x86_64.AppImage`,
		`dump-txt-${version}-linux-amd64.deb`,
	].sort();
}

function checksumOf(directory, version) {
	return artifactNamesOf(version)
		.map((artifact) => {
			const digest = createHash("sha256")
				.update(readFileSync(join(directory, artifact)))
				.digest("hex");

			return `${digest}  ${artifact}\n`;
		})
		.join("");
}

export function writeChecksums(directory, version) {
	writeFileSync(join(directory, "SHA256SUMS"), checksumOf(directory, version));
}

function tagTargetOf(repository, tag, run) {
	const reference = api(`repos/${repository}/git/ref/tags/${tag}`, run);

	if (!reference) return null;

	let object = reference.object;

	for (let depth = 0; object?.type === "tag" && depth < 10; depth++)
		object = api(`repos/${repository}/git/tags/${object.sha}`, run)?.object;

	if (object?.type !== "commit" || !/^[a-f0-9]{40}$/u.test(object.sha))
		throw new Error("Release tag does not resolve to a commit");

	return object.sha;
}

export function publishRelease({ repository, sha, version, directory, run = runGh }) {
	const artifacts = artifactNamesOf(version);

	if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(repository) || !/^[a-f0-9]{40}$/u.test(sha))
		throw new Error("A repository and exact triggering commit are required");

	const expected = checksumOf(directory, version);

	if (readFileSync(join(directory, "SHA256SUMS"), "utf8") !== expected)
		throw new Error("Installer checksum does not match SHA256SUMS");

	const tag = `v${version}`;
	const release = api(`repos/${repository}/releases/tags/${tag}`, run);

	if (release && !release.draft) return "already published";

	const target = tagTargetOf(repository, tag, run);

	if (target && target !== sha) throw new Error("Release tag targets another commit");

	if (release && !target && release.target_commitish !== sha) throw new Error("Draft release targets another commit");

	if (!release)
		run([
			"release",
			"create",
			tag,
			"--repo",
			repository,
			"--target",
			sha,
			"--draft",
			"--title",
			`dump.txt ${version}`,
			"--notes",
			"Windows x64 installer, macOS Apple Silicon and Intel DMGs, and Linux x64 AppImage and Debian package. SHA256SUMS covers every download. macOS builds are not Developer ID signed or notarized.",
		]);

	run([
		"release",
		"upload",
		tag,
		...artifacts.map((artifact) => join(directory, artifact)),
		join(directory, "SHA256SUMS"),
		"--repo",
		repository,
		"--clobber",
	]);
	const scratch = resolve(".scratch");

	mkdirSync(scratch, { recursive: true });

	const verification = mkdtempSync(join(scratch, "release-verify-"));

	try {
		run([
			"release",
			"download",
			tag,
			"--repo",
			repository,
			"--dir",
			verification,
			...artifacts.flatMap((artifact) => ["--pattern", artifact]),
			"--pattern",
			"SHA256SUMS",
		]);

		if (
			checksumOf(verification, version) !== expected ||
			readFileSync(join(verification, "SHA256SUMS"), "utf8") !== expected
		)
			throw new Error("Uploaded release assets failed checksum verification");
	} finally {
		rmSync(verification, { recursive: true });
	}

	const currentTarget = tagTargetOf(repository, tag, run);

	if (currentTarget && currentTarget !== sha) throw new Error("Release tag changed during upload");

	run(["release", "edit", tag, "--repo", repository, "--draft=false", "--latest"]);

	if (tagTargetOf(repository, tag, run) !== sha) throw new Error("Published release tag has an unexpected target");

	return "published";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const version = JSON.parse(readFileSync("package.json", "utf8")).version;
	const [command, directory = "out/make"] = process.argv.slice(2);

	if (command === "checksums") writeChecksums(directory, version);
	else if (command === "publish")
		console.log(
			publishRelease({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA, version, directory }),
		);
	else throw new Error("Usage: node tools/release.mjs checksums|publish [artifact-directory]");
}
