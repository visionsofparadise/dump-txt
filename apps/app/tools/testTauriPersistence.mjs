import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cleanupWdioSession } from "@wdio/tauri-service";
import { driverProvider, executable, hostReport, root, startHostSession } from "./tauriTestHost.mjs";

const folder = path.join(root, ".scratch", "tauri-persistence", `${Date.now()}`);
const originalProfile = process.env.DUMP_TXT_PROFILE;
const observations = [];
const failures = [];
const report = {
	...hostReport(),
	method:
		"Actual production system webview and native filesystem; synthetic DOM selection and engine execCommand text input",
	pendingObservations: [
		"Physical input and native IME",
		"Native Open/Save As chooser interaction",
		"Operating-system initiated close during an edit",
	],
	observations,
	failures,
	sessions: [],
};
let browser;
let session;
await mkdir(folder, { recursive: true });

function hash(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function check(name, actual, expected, method = "Real native filesystem and fixture byte readback") {
	const passed = JSON.stringify(actual) === JSON.stringify(expected);
	const observation = { name, actual, expected, method, passed };
	observations.push(observation);
	if (!passed) failures.push(observation);
}

function samePath(left, right) {
	const normalize = (value) => {
		const normalized = path.resolve(value).replaceAll("\\", "/");
		return process.platform === "win32" ? normalized.toLowerCase() : normalized;
	};
	return normalize(left) === normalize(right);
}

async function until(predicate, description) {
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await delay(50);
	}
	throw new Error(`Timed out: ${description}`);
}

const evaluate = (script, ...arguments_) => browser.execute(script, ...arguments_);
const invoke = async (command, request = {}) =>
	JSON.parse(
		await evaluate(
			async (name, payload) => JSON.stringify(await window.__TAURI_INTERNALS__.invoke(name, { request: payload })),
			command,
			request,
		),
	);
const editorText = () =>
	evaluate(() =>
		[...document.querySelectorAll('[data-slot="page-current"] .cm-line')].map((line) => line.textContent).join("\n"),
	);

async function open(profile, name, expectedText) {
	assert.ok(
		path.isAbsolute(profile) && profile.startsWith(`${folder}${path.sep}`),
		"Every test profile must stay inside this run's scratch folder",
	);
	process.env.DUMP_TXT_PROFILE = profile;
	const logs = path.join(folder, name);
	await mkdir(logs, { recursive: true });
	browser = await startHostSession(logs, { sessionName: name, commandTimeout: 15000 });
	browser.options.connectionRetryCount = 0;
	browser.options.connectionRetryTimeout = 15000;
	session = { name, profile };
	report.sessions.push(session);
	await browser.waitUntil(
		async () => {
			session.url = await browser.getUrl();
			const url = new URL(session.url);
			const bundledOrigin =
				(url.protocol === "tauri:" && url.hostname === "localhost") ||
				(["http:", "https:"].includes(url.protocol) && url.hostname === "tauri.localhost");
			return bundledOrigin && !url.port && !url.search && ["", "/", "/index.html"].includes(url.pathname);
		},
		{ timeout: 15000, interval: 50, timeoutMsg: "Production entry did not load" },
	);
	await browser.waitUntil(
		() => evaluate(() => !!document.querySelector('[data-slot="page-current"] .cm-content[contenteditable="true"]')),
		{ timeout: 15000, interval: 50, timeoutMsg: "Production editor did not become ready" },
	);
	await until(async () => (await editorText()) === expectedText, `Restored editor text for ${name}`);
	session.engine = await evaluate(() => ({
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
		documentFocused: document.hasFocus(),
	}));
	const paths = await invoke("get_paths");
	assert.equal(paths.ok, true, JSON.stringify(paths));
	assert.ok(samePath(paths.value.userData, profile), "Native profile isolation must match the explicit fixture root");
	check(
		`${name}: startup snapshot consumed by renderer`,
		Object.hasOwn(paths.value, "startupSettings"),
		false,
		"Actual production get_paths command after renderer initialization",
	);
	check(`${name}: restored editor text`, await editorText(), expectedText, "Actual renderer DOM observation");
}

async function click(selector) {
	const element = await browser.$(selector);
	if (driverProvider !== "embedded") return element.click();
	return evaluate((target) => {
		target.scrollIntoView({ block: "center", inline: "center" });
		const rectangle = target.getBoundingClientRect();
		const options = {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX: rectangle.left + rectangle.width / 2,
			clientY: rectangle.top + rectangle.height / 2,
			button: 0,
			pointerId: 1,
			pointerType: "mouse",
			isPrimary: true,
		};
		const down = target.dispatchEvent(new PointerEvent("pointerdown", { ...options, buttons: 1 }));
		if (down && target.dispatchEvent(new MouseEvent("mousedown", { ...options, buttons: 1 }))) target.focus();
		target.dispatchEvent(new PointerEvent("pointerup", { ...options, buttons: 0 }));
		if (down) target.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
		target.dispatchEvent(new MouseEvent("click", { ...options, buttons: 0 }));
	}, element);
}

const editorFont = () => evaluate(() => getComputedStyle(document.querySelector(".cm-content")).fontFamily);

async function cleanup() {
	if (!browser) return;
	const current = browser;
	browser = undefined;
	await cleanupWdioSession(current);
}

async function editAndMinimize(text) {
	await evaluate(() => document.querySelector('[data-slot="page-current"] .cm-content').focus());
	await delay(250);
	await evaluate(() => {
		const content = document.querySelector('[data-slot="page-current"] .cm-content');
		const range = document.createRange();
		range.selectNodeContents(content);
		const selection = getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	});
	await delay(100);
	const edited = await evaluate(async (value) => {
		const content = document.querySelector('[data-slot="page-current"] .cm-content');
		if (document.activeElement !== content) throw new Error("Editor must be focused before insertion");
		const before = performance.now();
		if (!document.execCommand("insertText", false, value)) throw new Error("Engine text insertion failed");
		const insertedAt = performance.now();
		const minimized = await window.__TAURI_INTERNALS__.invoke("minimize", { request: {} });
		return { insertedInMs: insertedAt - before, minimizeCompletedAfterMs: performance.now() - insertedAt, minimized };
	}, text);
	assert.equal(edited.minimized.ok, true, JSON.stringify(edited));
	session.edit = edited;
}

async function closeAndVerify(documentPath, expectedBytes, name) {
	await evaluate(() => {
		setTimeout(() => void window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }), 0);
	});
	await until(async () => {
		try {
			return (await readFile(documentPath)).equals(expectedBytes);
		} catch {
			return false;
		}
	}, `${name}: newest bytes saved while minimized and closing`);
	check(`${name}: exact bytes after close request`, hash(await readFile(documentPath)), hash(expectedBytes));
	await until(async () => {
		try {
			return (await browser.getWindowHandles()).length === 0;
		} catch (error) {
			const message = String(error);
			if (
				!/invalid session|no such window|disconnected|ECONNREFUSED|ECONNRESET|socket hang up|fetch failed|Failed to fetch|Session terminated without a reply/iu.test(
					message,
				)
			)
				throw error;
			session.closedTransport = message;
			return true;
		}
	}, `${name}: app window closed after save acknowledgement`);
	check(
		`${name}: application window unavailable after saved bytes`,
		true,
		true,
		"WebDriver reports no application window or terminated application transport after renderer close; transport termination alone does not distinguish normal exit from crash",
	);
	await cleanup();
}

function settings(document, bytes) {
	return {
		version: 1,
		activePath: document,
		appearance: { theme: "dark", font: "Consolas", textSize: 14, showStatusBar: true },
		findPreferences: { matchCase: false, allPages: false },
		occurrencePreferences: { matchCase: false, allPages: false },
		windowBounds: null,
		savedContentHash: hash(bytes),
		activePageIndex: 0,
		selections: [{ ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 }],
	};
}

async function fixture(name, text, encoding = "utf8") {
	const profile = path.join(folder, name);
	await mkdir(profile, { recursive: true });
	const document = path.join(profile, "dump.txt");
	const encode = (value) =>
		encoding === "utf16be"
			? Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(value.replaceAll("\n", "\r\n"), "utf16le").swap16()])
			: Buffer.from(value, "utf8");
	const bytes = encode(text);
	await writeFile(document, bytes);
	await writeFile(path.join(profile, "app-state.json"), JSON.stringify(settings(document, bytes)));
	return { profile, document, bytes, encode };
}

async function scenario(name, action) {
	try {
		await action();
	} catch (error) {
		failures.push({ name, error: error.stack ?? String(error) });
		if (browser) await browser.saveScreenshot(path.join(folder, `${name}-failure.png`)).catch(() => undefined);
	} finally {
		try {
			await cleanup();
		} catch (error) {
			failures.push({ name: `${name}: session cleanup`, error: String(error) });
		}
	}
}

try {
	assert.deepEqual(process.argv.slice(2), [], "Production persistence harness accepts no arguments");
	assert.ok(["external", "embedded"].includes(driverProvider), "Unsupported TAURI_TEST_DRIVER");
	await access(executable);
	const binary = await readFile(executable);
	report.binary = { bytes: binary.length, sha256: hash(binary) };
	report.build = JSON.parse(await readFile(path.join(root, ".scratch", "tauri-build.json"), "utf8"));
	assert.equal(report.build.automation, true, "The application must have the automation feature");
	assert.equal(report.binary.sha256, report.build.sha256, "Binary differs from build manifest");
	assert.equal(report.binary.bytes, report.build.bytes, "Binary size differs from build manifest");
	await scenario("utf16-close-reopen", async () => {
		const initial = "Original β text\nSecond line";
		const revised = "Newest café 日本語 📝\nDurable after minimize";
		const current = await fixture("utf16-profile", initial, "utf16be");
		await open(current.profile, "utf16-before", initial);
		const outside = path.join(folder, "outside-profile.txt");
		await writeFile(outside, "untouched external fixture");
		const denied = await invoke("read_file", { path: outside });
		check("unselected external path denied", denied.error?.code, "permission", "Actual native read_file command");
		const scratch = path.join(current.profile, "native-contract.txt");
		const created = await invoke("write_file", { path: scratch, bytes: [0, 255, 13, 10, 65], expectedHash: null });
		assert.equal(created.ok, true, JSON.stringify(created));
		check(
			"native exact byte snapshot",
			(await invoke("read_file", { path: scratch })).value?.bytes,
			[0, 255, 13, 10, 65],
		);
		const conflict = await invoke("write_file", { path: scratch, bytes: [66], expectedHash: null });
		check("native stale hash conflict", conflict.error?.code, "conflict");
		check("conflict preserves existing bytes", [...(await readFile(scratch))], [0, 255, 13, 10, 65]);
		check(
			"native missing snapshot",
			(await invoke("read_file", { path: path.join(current.profile, "absent.txt") })).value,
			null,
		);
		await editAndMinimize(revised);
		await closeAndVerify(current.document, current.encode(revised), "utf16 edit");
		const state = JSON.parse(await readFile(path.join(current.profile, "app-state.json"), "utf8"));
		check("settings hash matches latest UTF16 BOM bytes", state.savedContentHash, hash(current.encode(revised)));
		await open(current.profile, "utf16-reopened", revised);
		check(
			"UTF16BE BOM and CRLF survive reopen",
			hash(await readFile(current.document)),
			hash(current.encode(revised)),
		);
	});
	await scenario("released-recovery", async () => {
		const current = await fixture("recovery-profile", "Saved before interruption");
		const recovered = "Unsaved recovery β\nLatest revision";
		const record = {
			version: 1,
			path: current.document,
			baseHash: hash(current.bytes),
			revision: 1,
			text: recovered,
			format: { encoding: "utf8", bom: false, newline: "\n" },
			pageIds: ["fixture-page"],
			view: {
				activePageId: "fixture-page",
				selections: { "fixture-page": { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 } },
				occurrence: null,
			},
		};
		await writeFile(path.join(current.profile, "recovery.json"), JSON.stringify(record));
		await open(current.profile, "recovery-restored", recovered);
		await closeAndVerify(current.document, current.encode(recovered), "recovered revision");
	});
	await scenario("corrupt-profile", async () => {
		const current = await fixture("corrupt-profile", "Existing document stays intact");
		const corruptSettings = Buffer.from("{ invalid app settings");
		const corruptRecovery = Buffer.from("{ invalid recovery bytes");
		await writeFile(path.join(current.profile, "app-state.json"), corruptSettings);
		await writeFile(path.join(current.profile, "recovery.json"), corruptRecovery);
		await open(current.profile, "corrupt-restored", "Existing document stays intact");
		const names = await readdir(current.profile);
		for (const [prefix, expected] of [
			["app-state-", corruptSettings],
			["recovery-", corruptRecovery],
		]) {
			const preserved = names.filter((name) => name.startsWith(prefix));
			assert.equal(preserved.length, 1, `One preserved ${prefix} file required`);
			check(
				`${prefix}corrupt bytes preserved exactly`,
				hash(await readFile(path.join(current.profile, preserved[0]))),
				hash(expected),
			);
		}
		check("corrupt metadata leaves document intact", hash(await readFile(current.document)), hash(current.bytes));
	});
	await scenario("native-services", async () => {
		const current = await fixture("native-services-profile", "Native services");
		await open(current.profile, "native-services", "Native services");
		const clipboard = await evaluate(async () => {
			const text = "dump.txt fixture 中文 👩‍💻\nclipboard";
			const invoke = (command, request = {}) => window.__TAURI_INTERNALS__.invoke(command, { request });
			const original = await invoke("read_clipboard");
			if (!original.ok) return { error: `Clipboard snapshot failed: ${original.error.message}` };
			try {
				await invoke("write_clipboard", { text });
				const read = await invoke("read_clipboard");
				return { roundtrip: read.ok && read.value === text };
			} finally {
				await invoke("write_clipboard", { text: original.value });
			}
		});
		check("native Unicode clipboard roundtrip", clipboard, { roundtrip: true }, "Real native clipboard commands");
		const originalFont = await editorFont();
		await click('[aria-label="App menu"]');
		await until(() => evaluate(() => !!document.querySelector('[role="menuitem"]')), "app menu");
		await click('//*[@role="menuitem"][span[text()="Font…"]]');
		await until(() => evaluate(() => !!document.querySelector('[role="option"]')), "native font list");
		const chosenFont = await evaluate(() => {
			const canvas = document.createElement("canvas").getContext("2d");
			const sample = "WWWW iiiii 0123456789";
			canvas.font = `20px ${getComputedStyle(document.querySelector(".cm-content")).fontFamily}`;
			const originalWidth = canvas.measureText(sample).width;
			for (const option of document.querySelectorAll('[role="option"]')) {
				canvas.font = `20px ${JSON.stringify(option.textContent)}`;
				if (Math.abs(canvas.measureText(sample).width - originalWidth) <= 1) continue;
				option.dataset.tauriTestFont = "true";
				return option.textContent;
			}
			throw new Error("No installed font with distinct metrics available");
		});
		await click('[data-tauri-test-font="true"]');
		await until(async () => (await editorFont()).includes(chosenFont), "native font previews in the editor");
		await click('[data-slot="dialog-footer"] button');
		await until(() => evaluate(() => !document.querySelector('[role="option"]')), "font picker closes");
		check("font cancel restores the original font", await editorFont(), originalFont, "Actual renderer style");
	});
} catch (error) {
	failures.push({ name: "harness setup", error: error.stack ?? String(error) });
} finally {
	if (originalProfile === undefined) delete process.env.DUMP_TXT_PROFILE;
	else process.env.DUMP_TXT_PROFILE = originalProfile;
	report.result = failures.length ? "fail" : "pass";
	await writeFile(path.join(folder, "report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ folder, result: report.result, observations: observations.length, failures }, null, 2));
}
process.exit(failures.length ? 1 : 0);
