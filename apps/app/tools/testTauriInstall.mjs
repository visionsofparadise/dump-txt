import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted")
	throw new Error("Install tests require a disposable GitHub-hosted runner.");

const app = fileURLToPath(new URL("../", import.meta.url));
const version = JSON.parse(readFileSync(join(app, "package.json"), "utf8")).version;
const output = join(app, "out", "make");
const evidence = join(app, ".scratch", "tauri-install");
const report = { platform: process.platform, architecture: process.arch, version, observations: [], result: "fail" };

function observe(name, actual, expected) {
	const passed = actual === expected;
	report.observations.push({ name, actual, expected, passed });
	assert.ok(passed, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function run(command, arguments_, options = {}) {
	const result = spawnSync(command, arguments_, { cwd: app, encoding: "utf8", timeout: 300000, ...options });
	if (result.error) throw result.error;
	return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function runOrThrow(command, arguments_, options) {
	const result = run(command, arguments_, options);
	if (result.status !== 0) throw new Error(`${command} ${arguments_.join(" ")} failed: ${result.stderr}`);
	return result.stdout;
}

function launch(executable, arguments_ = [], environment = process.env) {
	const child = spawn(executable, arguments_, { cwd: app, env: environment, detached: true, stdio: "ignore" });
	child.on("error", (error) => {
		child.launchError = error;
		report.observations.push({
			name: `launch ${executable}`,
			actual: error.message,
			expected: "spawned",
			passed: false,
		});
	});
	return child;
}

function alive(child) {
	return child.launchError === undefined && child.exitCode === null && child.signalCode === null;
}

function exitOf(child, milliseconds) {
	return Promise.race([
		new Promise((resolve) => child.once("exit", (code) => resolve(code))),
		new Promise((resolve) => child.once("error", (error) => resolve(error.message))),
		delay(milliseconds).then(() => "timeout"),
	]);
}

function terminate(child) {
	if (!alive(child)) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

async function secondLaunchHandsOff(executable, isFirstAlive) {
	const second = launch(executable);
	const exit = await exitOf(second, 20000);
	terminate(second);
	observe("second launch exits within 20 s", exit, 0);
	observe("first instance alive after second launch", isFirstAlive(), true);
}

async function testLinux() {
	const deb = join(output, `dump-txt-${version}-linux-amd64.deb`);
	const packageName = runOrThrow("dpkg-deb", ["-f", deb, "Package"]);
	runOrThrow("sudo", ["dpkg", "-i", deb]);

	const installed = runOrThrow("dpkg", ["-L", packageName]).split("\n");
	const executables = installed.filter((path) => /^\/usr\/bin\/[^/]+$/u.test(path));
	observe("installed executables", executables.length, 1);
	const [executable] = executables;

	const first = launch(executable);
	try {
		await delay(5000);
		observe("installed app alive after 5 s", alive(first), true);
		await secondLaunchHandsOff(executable, () => alive(first));
	} finally {
		terminate(first);
	}

	runOrThrow("sudo", ["dpkg", "-r", packageName]);
	observe("package removed", run("dpkg", ["-s", packageName]).status !== 0, true);
	observe("executable removed", existsSync(executable), false);

	const appImage = join(output, `dump-txt-${version}-linux-x86_64.AppImage`);
	chmodSync(appImage, 0o755);
	const portable = launch(appImage, [], { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" });
	try {
		await delay(5000);
		observe("AppImage alive after 5 s", alive(portable), true);
	} finally {
		terminate(portable);
	}
}

function processesOf(executable) {
	return runOrThrow("ps", ["-axo", "pid=,command="])
		.split("\n")
		.map((line) => /^\s*(\d+)\s+(.*)$/u.exec(line))
		.filter((match) => match && (match[2] === executable || match[2].startsWith(`${executable} `)))
		.map((match) => match[1]);
}

async function testMac() {
	const mountpoint = mkdtempSync(join(tmpdir(), "dump-txt-dmg-"));
	runOrThrow("hdiutil", [
		"attach",
		"-nobrowse",
		"-readonly",
		"-mountpoint",
		mountpoint,
		join(output, `dump-txt-${version}-mac-${process.arch}.dmg`),
	]);
	let bundle;
	try {
		const bundles = readdirSync(mountpoint).filter((entry) => entry.endsWith(".app"));
		observe("DMG app bundles", bundles.length, 1);
		bundle = bundles[0];
		runOrThrow("sudo", ["ditto", join(mountpoint, bundle), join("/Applications", bundle)]);
	} finally {
		runOrThrow("hdiutil", ["detach", mountpoint]);
		rmSync(mountpoint, { recursive: true, force: true });
	}

	const installed = join("/Applications", bundle);
	const name = runOrThrow("plutil", [
		"-extract",
		"CFBundleExecutable",
		"raw",
		join(installed, "Contents", "Info.plist"),
	]);
	const executable = join(installed, "Contents", "MacOS", name);
	observe("installed app executable exists", existsSync(executable), true);

	observe("app processes before launch", processesOf(executable).length, 0);
	runOrThrow("open", ["-n", installed]);
	await delay(5000);
	const [first] = processesOf(executable);
	observe("installed app alive after 5 s", first !== undefined, true);
	try {
		await secondLaunchHandsOff(executable, () => processesOf(executable).includes(first));
	} finally {
		try {
			run("osascript", ["-e", `quit app "${basename(bundle, ".app")}"`], { timeout: 20000 });
		} catch {
			// A hung or failed quit falls through to the kill below.
		}
		const deadline = Date.now() + 15000;
		while (processesOf(executable).includes(first) && Date.now() < deadline) await delay(500);
		const quit = !processesOf(executable).includes(first);
		report.observations.push({ name: "app quits through AppleScript", actual: quit, expected: true, passed: quit });
		if (!quit) {
			try {
				process.kill(Number(first), "SIGKILL");
			} catch {
				// The process exited between the lookup and the kill.
			}
		}
	}

	runOrThrow("sudo", ["rm", "-rf", installed]);
	observe("app removed", existsSync(installed), false);
}

try {
	if (process.platform === "linux") await testLinux();
	else if (process.platform === "darwin") await testMac();
	else throw new Error(`Install tests cover Linux and macOS only, not ${process.platform}`);
	report.result = "pass";
} catch (error) {
	report.error = error instanceof Error ? error.message : String(error);
	process.exitCode = 1;
} finally {
	mkdirSync(evidence, { recursive: true });
	writeFileSync(join(evidence, "report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ result: report.result }));
}
