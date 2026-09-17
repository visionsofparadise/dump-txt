import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const [platform, packageArgument] = process.argv.slice(2);
assert(
	["android", "ios"].includes(platform) && packageArgument,
	"Usage: node testMobileBoot.mjs android|ios <apk|app-directory>",
);
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
	proof: "native renderer boot and app-private UTF-8 file retention across process restart",
	keyboardInputTested: false,
	editorAutosaveTested: false,
	success: false,
};

function command(executable, args, options = {}) {
	const result = spawnSync(executable, args, {
		encoding: "utf8",
		timeout: options.timeout ?? 30_000,
		maxBuffer: 8 * 1024 * 1024,
		windowsHide: true,
		input: options.input,
		env: options.env ? { ...process.env, ...options.env } : process.env,
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
	const runAs = (args, options) =>
		adb(
			[options?.input === undefined ? "exec-out" : "exec-in", ["run-as", app, ...args].map(shellQuote).join(" ")],
			options,
		);
	assert.equal(
		adb(["shell", "getprop", "ro.kernel.qemu"]).trim(),
		"1",
		"Only disposable emulator instances are supported.",
	);
	const existing = adb(["shell", "pm", "path", app], { allowFailure: true })?.trim();
	if (existing) {
		const allowedAvd = process.env.DUMP_TXT_MOBILE_ALLOW_EXISTING_AVD;
		const actualAvd = adb(["emu", "avd", "name"]).split(/\r?\n/u)[0].trim();
		assert(
			allowedAvd && /^dump-txt(?:[-_].*)?$/u.test(allowedAvd) && actualAvd === allowedAvd,
			"Existing app install requires explicit DUMP_TXT_MOBILE_ALLOW_EXISTING_AVD matching a dedicated dump-txt test AVD.",
		);
		const previous = runAs(["cat", document], { allowFailure: true });
		assert(
			previous === null ||
				previous === "" ||
				/^(?:Editor autosave [a-f0-9-]{36}\n)?dump\.txt mobile file persistence [a-f0-9-]{36}\nCafé · 中文 · 日本語 · 👩‍💻\n(?:Editor autosave [a-f0-9-]{36}\n)?$/u.test(
					previous,
				),
			"Existing test AVD contains non-probe document text; use a fresh AVD. The harness never clears application data.",
		);
		report.existingTestAvd = actualAvd;
	}

	report.device = serial;
	report.applicationId = app;
	report.document = document;
	report.install = adb(["install", "-r", report.package], { timeout: 180_000 }).trim();

	async function launch(label) {
		const nonce = `dump-txt-boot-${randomUUID()}`;
		adb(["shell", "log", "-t", "DumpTxtBoot", nonce]);
		adb(["shell", "am", "start", "-W", "-n", activity], { timeout: 45_000 });
		const processId = await until(
			() => adb(["shell", "pidof", app], { allowFailure: true })?.trim(),
			"Android process",
		);
		assert(/^\d+$/u.test(processId), "Expected exactly one app process.");
		let fresh = "";
		try {
			await until(() => {
				const logs = adb(["logcat", "-d", "-v", "threadtime", "-t", "4000"]);
				const boundary = logs.indexOf(nonce);
				if (boundary < 0) return false;
				fresh = logs.slice(boundary + nonce.length);
				return fresh.split(/\r?\n/u).some((line) => {
					const fields = line.trim().split(/\s+/u);
					return fields[2] === processId && line.includes(marker);
				});
			}, `${label} renderer readiness`);
		} finally {
			writeFileSync(join(evidence, `${label}.log`), fresh);
		}
		return { processId, logs: fresh };
	}

	const first = await launch("first-launch");
	await until(() => runAs(["cat", document], { allowFailure: true }) !== null, "App-private document creation");
	report.firstReady = true;
	report.browser = await androidBrowserEvidence(adb, first.processId, first.logs);
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
	assert.equal(runAs(["cat", document]), sentinel);
	const second = await launch("second-launch");
	await delay(1000);
	assert.equal(runAs(["cat", document]), sentinel, "UTF-8 content must survive app initialization and restart.");
	report.secondReady = true;
	report.fileRetained = true;
	const secondBrowser = await androidBrowserEvidence(
		adb,
		second.processId,
		second.logs,
		undefined,
		process.env.MOBILE_REQUIRE_RENDERER_TEXT === "1" ? sentinel.trim() : undefined,
	);
	report.rendererTextObserved = secondBrowser.editorText?.includes(sentinel.trim()) ?? false;
	if (process.env.MOBILE_REQUIRE_RENDERER_TEXT === "1") {
		assert(report.rendererTextObserved, "The relaunched editor must display the persisted text through CDP.");
	}
	if (process.env.MOBILE_REQUIRE_EDITOR_AUTOSAVE === "1") {
		await androidBrowserEvidence(adb, second.processId, second.logs, autosaveText);
		const expected = autosaveText + sentinel;
		await until(() => runAs(["cat", document]) === expected, "Editor input autosave");
		report.editorAutosaveTested = true;
		report.inputMethod = "Chrome DevTools Protocol Input.insertText into the CodeMirror contenteditable";
		adb(["shell", "am", "force-stop", app]);
		const third = await launch("autosave-relaunch");
		assert.equal(runAs(["cat", document]), expected, "Editor autosave must survive process restart.");
		const restored = await androidBrowserEvidence(adb, third.processId, third.logs, undefined, autosaveText.trim());
		assert(
			restored.editorText?.includes(autosaveText.trim()),
			"The relaunched editor must display its autosaved input.",
		);
		report.editorAutosaveRetained = true;
	}
	adb(["shell", "am", "force-stop", app]);
}

async function androidBrowserEvidence(adb, processId, logs, inputText, expectedText) {
	if (expectedText === undefined) return readAndroidBrowserEvidence(adb, processId, logs, inputText);
	const deadline = Date.now() + 30_000;
	let last;
	do {
		try {
			const result = await readAndroidBrowserEvidence(adb, processId, logs, inputText, expectedText, deadline);
			last = result;
			if (result.editorText?.includes(expectedText)) return result;
		} catch (error) {
			if (error.code === "ANDROID_USER_AGENT_MISMATCH") throw error;
			last = { error: error.message };
		}
		if (Date.now() < deadline) await delay(500);
	} while (Date.now() < deadline);
	report.lastRendererObservation = { processId, expectedText, ...last };
	throw new Error("Relaunched editor text was not observed within 30000ms; see lastRendererObservation.");
}

async function readAndroidBrowserEvidence(adb, processId, logs, inputText, expectedText, deadline) {
	let port;
	try {
		const sockets = adb(["shell", "cat", "/proc/net/unix"]);
		const socket = sockets
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
		const result = await evaluate(
			page.webSocketDebuggerUrl,
			"({userAgent:navigator.userAgent,editContextAvailable:typeof EditContext!=='undefined',editorText:document.querySelector('.cm-content')?.innerText??null})",
		);
		if (!/Android\b/u.test(result.userAgent)) {
			const error = new Error("The observed WebView user agent does not identify Android.");
			error.code = "ANDROID_USER_AGENT_MISMATCH";
			throw error;
		}
		if (expectedText !== undefined) {
			result.editorText = await evaluate(
				page.webSocketDebuggerUrl,
				`(async () => {
                    const deadline = Date.now() + ${Math.max(1, deadline - Date.now())};
                    let text;
                    do {
                        text = document.querySelector('.cm-content')?.innerText ?? null;
                        if (text?.includes(${JSON.stringify(expectedText)})) return text;
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } while (Date.now() < deadline);
                    return text;
                })()`,
				Math.max(1, deadline - Date.now()) + 5000,
			);
		}
		if (inputText !== undefined) {
			assert.equal(
				await evaluate(
					page.webSocketDebuggerUrl,
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
			await devtoolsCall(page.webSocketDebuggerUrl, "Input.insertText", { text: inputText });
		}
		return { source: "webview-cdp", ...result };
	} catch (error) {
		if (expectedText !== undefined) throw error;
		if (inputText !== undefined) throw error;
		if (error.code === "ANDROID_USER_AGENT_MISMATCH") throw error;
		const userAgent = logs.match(/dump\.txt user agent: (.+)/u)?.[1]?.trim();
		if (userAgent) {
			assert.match(userAgent, /Android\b/u);
			return { source: "startup-log", userAgent };
		}
		if (process.env.MOBILE_REQUIRE_ANDROID_USER_AGENT === "1") throw error;
		return { source: "unavailable", reason: error.message, userAgent: null };
	} finally {
		if (port) adb(["forward", "--remove", `tcp:${port}`], { allowFailure: true });
	}
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

function appBundleOf(path) {
	const found = [];
	function visit(directory, depth) {
		if (directory.endsWith(".app")) {
			found.push(directory);
			return;
		}
		if (depth > 6) return;
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory() && !entry.isSymbolicLink()) visit(join(directory, entry.name), depth + 1);
		}
	}
	visit(resolve(path), 0);
	assert.equal(found.length, 1, "Provide a .app or build directory containing exactly one simulator .app.");
	return found[0];
}

async function ios() {
	assert.equal(process.platform, "darwin", "iOS probe requires macOS with Xcode.");
	const simctl = (args, options) => command("xcrun", ["simctl", ...args], options);
	const launchHelp = spawnSync("xcrun", ["simctl", "help", "launch"], { encoding: "utf8", timeout: 30_000 });
	const launchUsage = `${launchHelp.stdout ?? ""}${launchHelp.stderr ?? ""}`;
	writeFileSync(join(evidence, "simctl-launch-help.txt"), launchUsage);
	assert(
		launchUsage.includes("--stdout") && launchUsage.includes("--stderr"),
		"Installed simctl must support file output capture.",
	);
	const bundle = appBundleOf(report.package);
	const plist = (key) =>
		command("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(bundle, "Info.plist")]).trim();
	const bundleId = plist("CFBundleIdentifier");
	assert.match(bundleId, /^com\.visionsofparadise\.dump[-_]txt(?:\..+)?$/u);
	const runtimes = JSON.parse(simctl(["list", "runtimes", "--json"]))
		.runtimes.filter((runtime) => runtime.isAvailable && runtime.identifier.includes(".iOS-"))
		.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
	assert(runtimes.length, "Install an iOS simulator runtime in Xcode.");
	const types = JSON.parse(simctl(["list", "devicetypes", "--json"])).devicetypes;
	const type =
		types.find((entry) => entry.name === "iPhone 16") ?? types.find((entry) => entry.name.startsWith("iPhone"));
	assert(type, "An iPhone simulator device type is required.");
	const device = simctl(["create", `dump-txt-boot-${randomUUID()}`, type.identifier, runtimes[0].identifier]).trim();
	report.device = device;
	report.applicationId = bundleId;
	report.package = bundle;
	let container;
	try {
		simctl(["boot", device]);
		simctl(["bootstatus", device, "-b"], { timeout: 300_000 });
		simctl(["install", device, bundle], { timeout: 120_000 });
		container = realpathSync(simctl(["get_app_container", device, bundleId, "data"]).trim());
		async function launch(label) {
			const nonce = randomUUID();
			const readyFile = join(container, "tmp/dump-txt-renderer-ready");
			const stdout = join(evidence, `${label}.stdout.log`);
			const stderr = join(evidence, `${label}.stderr.log`);
			const result = simctl(["launch", `--stdout=${stdout}`, `--stderr=${stderr}`, device, bundleId], {
				timeout: 45_000,
				env: { SIMCTL_CHILD_DUMP_TXT_BOOT_NONCE: nonce },
			});
			writeFileSync(join(evidence, `${label}.launch.log`), result);
			const processId = Number(result.trim().match(/: (\d+)$/u)?.[1]);
			assert(Number.isSafeInteger(processId) && processId > 0, "Simulator launch must report the app PID.");
			report[label] = { processId, nonce, status: "launched" };
			await until(() => {
				assert(
					command("/bin/ps", ["-p", String(processId), "-o", "pid="], { allowFailure: true })?.trim(),
					"Simulator app exited before readiness.",
				);
				return existsSync(readyFile) && readFileSync(readyFile, "utf8") === nonce;
			}, `${label} iOS renderer readiness`);
			report[label].status = "ready";
		}
		await launch("first-launch");
		report.firstReady = true;
		const document = join(container, "Library/Application Support/dump.txt/dump.txt");
		await until(() => existsSync(document), "iOS private document creation");
		const canonical = realpathSync(document);
		const within = relative(container, canonical);
		assert(
			within && !within.startsWith(`..${sep}`) && within !== "..",
			"Document must remain inside its simulator app container.",
		);
		report.document = within;
		simctl(["terminate", device, bundleId]);
		writeFileSync(canonical, sentinel, "utf8");
		await launch("second-launch");
		await delay(1000);
		assert.equal(readFileSync(canonical, "utf8"), sentinel);
		report.secondReady = true;
		report.fileRetained = true;
		report.rendererTextObserved = null;
		simctl(["io", device, "screenshot", join(evidence, "simulator.png")]);
		simctl(["terminate", device, bundleId]);
	} finally {
		try {
			simctl(["io", device, "screenshot", join(evidence, "simulator-final.png")], { allowFailure: true });
			writeFileSync(
				join(evidence, "app-info.log"),
				simctl(["appinfo", device, bundleId], { allowFailure: true }) ?? "unavailable",
			);
			writeFileSync(
				join(evidence, "system.log"),
				simctl(
					[
						"spawn",
						device,
						"log",
						"show",
						"--last",
						"5m",
						"--style",
						"compact",
						"--predicate",
						`process == "dump-txt"`,
					],
					{ allowFailure: true },
				) ?? "unavailable",
			);
			if (container) {
				const readyFile = join(container, "tmp/dump-txt-renderer-ready");
				if (existsSync(readyFile)) writeFileSync(join(evidence, "renderer-ready.txt"), readFileSync(readyFile));
				writeFileSync(
					join(evidence, "container-files.log"),
					command("/usr/bin/find", [container, "-type", "f"], { allowFailure: true }) ?? "unavailable",
				);
			}
		} catch (error) {
			report.diagnosticsError = error.message;
		} finally {
			simctl(["shutdown", device], { allowFailure: true });
			simctl(["delete", device], { allowFailure: true });
		}
	}
}

try {
	if (platform === "android") await android();
	else await ios();
	report.success = true;
} catch (error) {
	report.error = error.message;
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	writeFileSync(join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({ success: report.success, platform, evidence, error: report.error }));
}
