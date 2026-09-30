import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const [platform, packageArgument] = process.argv.slice(2);
assert(platform === "android" && packageArgument, "Usage: node testMobileBoot.mjs android <apk>");
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspace = process.env.DUMP_TXT_APP_WORKSPACE
	? resolve(process.env.DUMP_TXT_APP_WORKSPACE)
	: [resolve(scriptDirectory, ".."), resolve(scriptDirectory, "../../apps/app")].find((directory) =>
			existsSync(join(directory, "tauri.conf.json")),
		);
assert(workspace, "Set DUMP_TXT_APP_WORKSPACE to the apps/app directory.");
const evidence = join(workspace, ".scratch/mobile-boot", platform, new Date().toISOString().replaceAll(":", "-"));
mkdirSync(evidence, { recursive: true });

const marker = "dump.txt renderer ready";
const sentinel = `dump.txt mobile file persistence ${randomUUID()}\nCafé · 中文 · 日本語 · 👩‍💻\n`;
const autosaveText = `Editor autosave ${randomUUID()}\n`;
const report = {
	platform,
	package: resolve(packageArgument),
	startedAt: new Date().toISOString(),
	proof: "native renderer boot, persisted text shown, typed text autosaved and restored across process restarts",
	editorAutosaveTested: false,
	success: false,
};

function command(executable, args, options = {}) {
	const timeout = options.timeout ?? 30_000;
	const result = spawnSync(executable, args, {
		encoding: "utf8",
		timeout,
		maxBuffer: 8 * 1024 * 1024,
		windowsHide: true,
	});
	if (result.error || result.status !== 0) {
		if (options.allowFailure) return null;
		throw new Error(
			`${executable} ${args.slice(0, 3).join(" ")} failed: ${result.error?.message ?? result.stderr?.slice(-2000) ?? result.status}`,
		);
	}
	return result.stdout;
}

async function until(read, label, timeout = 120_000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const result = await read();
		if (result) return result;
		await delay(500);
	}
	throw new Error(`${label} timed out after ${timeout}ms`);
}

function shellQuote(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

async function android() {
	const devices = command("adb", ["devices"])
		.split(/\r?\n/u)
		.map((line) => line.trim().split(/\s+/u))
		.filter(([serial, state]) => serial.startsWith("emulator-") && state === "device");
	const serial = process.env.ANDROID_SERIAL ?? (devices.length === 1 ? devices[0][0] : null);
	assert(
		serial?.startsWith("emulator-") && devices.some(([value]) => value === serial),
		"Select one booted emulator with ANDROID_SERIAL; physical devices are excluded.",
	);
	const adb = (args, options) => command("adb", ["-s", serial, ...args], options);
	const app = "com.visionsofparadise.dump_txt";
	const activity = `${app}/${app}.MainActivity`;
	const document = "dump.txt/dump.txt";
	const runAs = (args, options) => adb(["exec-out", ["run-as", app, ...args].map(shellQuote).join(" ")], options);
	assert.equal(
		adb(["shell", "getprop", "ro.kernel.qemu"]).trim(),
		"1",
		"Only disposable emulator instances are supported.",
	);

	report.device = serial;
	report.applicationId = app;
	report.document = document;
	report.install = adb(["install", "-r", report.package], { timeout: 180_000 }).trim();
	adb(["logcat", "-G", "16M"]);

	async function launch(label) {
		adb(["shell", "am", "start", "-W", "-n", activity], { timeout: 45_000 });
		const processId = await until(
			() => adb(["shell", "pidof", app], { allowFailure: true })?.trim(),
			"Android process",
		);
		assert(/^\d+$/u.test(processId), "Expected exactly one app process.");
		let fresh = "";
		try {
			await until(() => {
				fresh = adb(["logcat", "-d", "-v", "threadtime", `--pid=${processId}`]);
				return fresh.includes(marker);
			}, `${label} renderer readiness`);
		} finally {
			writeFileSync(join(evidence, `${label}.log`), fresh);
		}
		return processId;
	}

	await launch("first-launch");
	await until(() => runAs(["cat", document], { allowFailure: true }) !== null, "App-private document creation");
	adb(["shell", "am", "force-stop", app]);
	const encoded = Buffer.from(sentinel, "utf8").toString("base64");
	assert.equal(
		runAs([
			"sh",
			"-c",
			`printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(document)} && cat ${shellQuote(document)}`,
		]),
		sentinel,
		"Fixture write must finish and acknowledge the exact UTF-8 bytes before relaunch.",
	);
	const second = await launch("second-launch");
	await delay(1000);
	assert.equal(runAs(["cat", document]), sentinel, "UTF-8 content must survive app initialization and restart.");
	await awaitEditorText(adb, second, sentinel.trim());
	report.rendererTextObserved = true;
	await typeIntoEditor(adb, second, autosaveText);
	const expected = autosaveText + sentinel;
	await until(() => runAs(["cat", document]) === expected, "Editor input autosave");
	report.editorAutosaveTested = true;
	adb(["shell", "am", "force-stop", app]);
	const third = await launch("autosave-relaunch");
	assert.equal(runAs(["cat", document]), expected, "Editor autosave must survive process restart.");
	await awaitEditorText(adb, third, autosaveText.trim());
	report.editorAutosaveRetained = true;
	adb(["shell", "am", "force-stop", app]);
}

async function withEditorPage(adb, processId, action) {
	let port;
	try {
		const socket = adb(["shell", "cat", "/proc/net/unix"])
			.split(/\r?\n/u)
			.map((line) => line.trim().split(/\s+/u).at(-1))
			.find((name) => name === `@webview_devtools_remote_${processId}`);
		assert(socket, "App WebView remote-debugging socket is unavailable.");
		port = adb(["forward", "tcp:0", `localabstract:${socket.slice(1)}`]).trim();
		assert(/^\d+$/u.test(port));
		const pages = await (
			await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })
		).json();
		const page = pages.find((entry) => entry.type === "page" && /tauri|localhost/u.test(entry.url));
		assert(page?.webSocketDebuggerUrl, "App page CDP target is unavailable.");
		return await action(page.webSocketDebuggerUrl);
	} finally {
		if (port) adb(["forward", "--remove", `tcp:${port}`], { allowFailure: true });
	}
}

async function awaitEditorText(adb, processId, expectedText) {
	const deadline = Date.now() + 30_000;
	let last;
	do {
		try {
			last = await withEditorPage(adb, processId, (url) =>
				evaluate(url, "document.querySelector('.cm-content')?.innerText ?? null"),
			);
			if (last?.includes(expectedText)) return;
		} catch (error) {
			last = error.message;
		}
		await delay(500);
	} while (Date.now() < deadline);
	report.lastRendererObservation = { processId, expectedText, last };
	throw new Error("Editor text was not observed within 30000ms; see lastRendererObservation.");
}

async function typeIntoEditor(adb, processId, text) {
	await withEditorPage(adb, processId, async (url) => {
		assert.equal(
			await evaluate(
				url,
				`(() => {
					const content = document.querySelector('.cm-content');
					if (!content?.isContentEditable) return false;
					content.focus();
					const range = document.createRange();
					range.selectNodeContents(content);
					range.collapse(true);
					const selection = getSelection();
					selection.removeAllRanges();
					selection.addRange(range);
					return document.activeElement === content;
				})()`,
			),
			true,
			"The editable CodeMirror surface must be focused.",
		);
		await devtoolsCall(url, "Input.insertText", { text });
	});
}

async function evaluate(url, expression, timeout) {
	const result = await devtoolsCall(
		url,
		"Runtime.evaluate",
		{ expression, returnByValue: true, awaitPromise: true },
		timeout,
	);
	assert(!result.exceptionDetails, "CDP evaluation failed.");
	return result.result.value;
}

async function devtoolsCall(url, method, params, timeout = 5000) {
	return new Promise((resolveValue, reject) => {
		const socket = new WebSocket(url);
		const timer = setTimeout(() => finish(new Error("CDP evaluation timed out")), timeout);
		function finish(error, value) {
			clearTimeout(timer);
			socket.close();
			if (error) reject(error);
			else resolveValue(value);
		}
		socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
		socket.addEventListener("error", () => finish(new Error("CDP connection failed")), { once: true });
		socket.addEventListener("message", (event) => {
			const response = JSON.parse(event.data);
			if (response.id !== 1) return;
			if (response.error) finish(new Error(`CDP ${method} failed: ${response.error.message}`));
			else finish(null, response.result);
		});
	});
}

try {
	await android();
	report.success = true;
} catch (error) {
	report.error = error.message;
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	writeFileSync(join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({ success: report.success, platform, evidence, error: report.error }));
}
