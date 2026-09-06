import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { arch, homedir, release } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { cleanupWdioSession, createTauriCapabilities, startWdioSession } from "@wdio/tauri-service";
import { Key } from "webdriverio";
import { fixture, pendingObservations } from "./tauri-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder = path.join(root, ".scratch", "tauri-test", `${Date.now()}`);
const executable =
	process.env.TAURI_TEST_BINARY ??
	path.join(root, "src-tauri", "target", "release", process.platform === "win32" ? "dump-txt.exe" : "dump-txt");
const driverProvider = process.env.TAURI_TEST_DRIVER ?? (process.platform === "darwin" ? "embedded" : "external");
const installedDriver = path.join(
	homedir(),
	".cargo",
	"bin",
	process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver",
);
const tauriDriverPath = process.env.TAURI_DRIVER_PATH ?? (existsSync(installedDriver) ? installedDriver : undefined);
const observations = [];
const failures = [];
const report = {
	executable,
	driverProvider,
	platform: process.platform,
	architecture: arch(),
	osRelease: release(),
	commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
	harnessSourceDirty:
		execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0,
	fixture: { bytes: fixture.bytes, sha256: fixture.sha256 },
	method:
		driverProvider === "embedded"
			? "Actual system webview; embedded WebDriver synthesizes DOM input"
			: "Actual system webview; external native WebDriver, with explicitly labelled synthetic DOM tests",
	pendingObservations,
	observations,
	failures,
};
let browser;
await mkdir(folder, { recursive: true });

function check(name, actual, expected, tolerance = 0, method = "DOM observation in actual system webview") {
	const passed =
		typeof actual === "number" && typeof expected === "number"
			? Math.abs(actual - expected) <= tolerance
			: actual === expected;
	const observation = { name, actual, expected, tolerance, method, passed };
	observations.push(observation);
	if (!passed) failures.push(observation);
}

try {
	assert.deepEqual(
		process.argv.slice(2),
		["--probe"],
		"Phase 2 harness requires --probe; production persistence tests are not implemented",
	);
	assert.ok(["external", "embedded"].includes(driverProvider), "Unsupported TAURI_TEST_DRIVER");
	await access(executable);
	const binary = await readFile(executable);
	report.binary = { bytes: binary.length, sha256: createHash("sha256").update(binary).digest("hex") };
	const manifestPath = path.join(root, ".scratch", "tauri-build.json");
	assert.ok(existsSync(manifestPath), "Build an automation probe before testing");
	report.build = JSON.parse(await readFile(manifestPath, "utf8"));
	assert.equal(report.build.probe, true, "Testing requires the isolated probe build");
	assert.equal(report.build.automation, true, "Testing requires the automation feature");
	assert.equal(
		report.binary.sha256,
		report.build.sha256,
		"Binary differs from build manifest; rebuild before testing",
	);
	assert.equal(report.binary.bytes, report.build.bytes, "Binary size differs from build manifest");
	const capabilities = createTauriCapabilities(executable, {
		driverProvider,
		logLevel: "warn",
		startTimeout: 120000,
		commandTimeout: 30000,
	});
	Object.assign(capabilities["wdio:tauriServiceOptions"], {
		logDir: folder,
		captureBackendLogs: true,
		autoDownloadEdgeDriver: !process.env.MS_EDGE_DRIVER,
		...(tauriDriverPath ? { tauriDriverPath } : {}),
	});
	browser = await startWdioSession(capabilities, {
		rootDir: root,
		...(process.env.MS_EDGE_DRIVER ? { nativeDriverPath: process.env.MS_EDGE_DRIVER } : {}),
	});
	assert.equal(
		new URL(await browser.getUrl()).pathname,
		"/probe.html",
		"Harness must target the isolated probe entry",
	);
	const evaluate = (script, ...args) => browser.execute(script, ...args);
	const waitFor = (script) =>
		browser.waitUntil(() => evaluate(script), { timeout: 15000, interval: 50, timeoutMsg: `Timed out: ${script}` });
	const screenshot = (name) => browser.saveScreenshot(path.join(folder, `${name}.png`));
	const modifier = process.platform === "darwin" ? Key.Command : Key.Control;
	const chord = (...keys) => browser.keys(keys);
	const count = () => evaluate(() => document.querySelector(".page-count").textContent.trim().replace("Pages ", ""));
	const settled = async () => {
		await delay(80);
		await waitFor(
			() =>
				document.querySelectorAll(".page-snapshot").length === 0 &&
				!document.querySelector(".page-current .page-editor-covered"),
		);
		await delay(180);
	};
	const navigate = async (direction) => {
		await chord(Key.Alt, direction > 0 ? Key.ArrowDown : Key.ArrowUp);
		await settled();
	};
	const scroll = async (top) => {
		await evaluate((value) => {
			document.querySelector(".page-current .cm-scroller").scrollTop = value;
		}, top);
		await delay(200);
		return evaluate(() => document.querySelector(".page-current .cm-scroller").scrollTop);
	};
	const wheel = (deltaY, options = {}) =>
		evaluate(
			(delta, attributes) => {
				const element = document.querySelector(attributes.bar ? ".page-bar" : ".page-current .cm-scroller");
				const rectangle = element.getBoundingClientRect();
				element.dispatchEvent(
					new WheelEvent("wheel", {
						bubbles: true,
						cancelable: true,
						deltaY: delta,
						clientX: rectangle.left + 80,
						clientY: rectangle.top + 80,
						...attributes,
					}),
				);
			},
			deltaY,
			options,
		);
	const selectText = async (text) => {
		await evaluate((needle) => {
			const content = document.querySelector(".page-current .cm-content");
			content.focus();
			const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const offset = node.textContent.indexOf(needle);
				if (offset < 0) continue;
				window.getSelection().setBaseAndExtent(node, offset, node, offset + needle.length);
				document.dispatchEvent(new Event("selectionchange"));
				return;
			}
			throw new Error(`Selection text missing: ${needle}`);
		}, text);
		await delay(200);
	};
	await waitFor(
		() =>
			document.querySelector(".cm-content") && document.querySelector(".page-count")?.textContent.includes("1 / 3"),
	);
	await settled();
	report.engine = await evaluate(() => ({
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		vendor: navigator.vendor,
		devicePixelRatio,
		reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
	}));
	report.capabilities = browser.capabilities;
	await evaluate(() => {
		window.tauriTestEvents = [];
		window.tauriTestErrors = [];
		for (const type of [
			"keydown",
			"beforeinput",
			"input",
			"wheel",
			"pointerdown",
			"compositionstart",
			"compositionend",
		])
			document.addEventListener(
				type,
				(event) =>
					window.tauriTestEvents.push({ type, trusted: event.isTrusted, inputType: event.inputType ?? null }),
				true,
			);
		window.addEventListener("error", (event) => window.tauriTestErrors.push(String(event.error ?? event.message)));
		window.addEventListener("unhandledrejection", (event) => window.tauriTestErrors.push(String(event.reason)));
	});
	check("fixture title", await evaluate(() => document.querySelector(".app-name").textContent), "dump.txt");
	check(
		"40px chrome",
		await evaluate(() =>
			[...document.querySelectorAll(".title-bar,.page-bar")].every(
				(bar) => bar.getBoundingClientRect().height === 40,
			),
		),
		true,
	);
	await screenshot("initial");
	await browser.$('[aria-label="App menu"]').click();
	await waitFor(() => !!document.querySelector(".menu-content"));
	check(
		"menu flush left",
		await evaluate(() => document.querySelector(".menu-content").getBoundingClientRect().left),
		0,
		1,
	);
	await browser.$(".app-name").click();
	await waitFor(() => !document.querySelector(".menu-content"));
	await browser.$(".cm-content").click();
	await navigate(1);
	check("long page entry", await count(), "2 / 3");
	const leading = await evaluate(() => {
		const scroller = document.querySelector(".page-current .cm-scroller");
		const line = scroller.querySelector(".cm-line");
		const rectangle = line.getBoundingClientRect();
		const viewport = scroller.getBoundingClientRect();
		return {
			text: line.textContent,
			visible: rectangle.top >= viewport.top && rectangle.top < viewport.bottom && rectangle.height > 0,
		};
	});
	check("leading line content", leading.text.startsWith("Line 1:"), true);
	check("leading line geometry", leading.visible, true);
	const remembered = await scroll(1500);
	await evaluate(() => {
		window.tauriTestFrames = [];
		const until = performance.now() + 750;
		requestAnimationFrame(function capture() {
			const live = document.querySelector(".page-current .cm-editor");
			const current = live.closest(".page-current");
			window.tauriTestFrames.push({
				top: live.getBoundingClientRect().top,
				viewportTop: document.querySelector(".page-viewport").getBoundingClientRect().top,
				opacity: [live, live.parentElement, current].reduce(
					(opacity, node) => opacity * Number(getComputedStyle(node).opacity),
					1,
				),
				snapshots: [...document.querySelectorAll(".page-snapshot")].map((node) => ({
					top: node.getBoundingClientRect().top,
					fills: node.getAnimations().map((animation) => animation.effect.getTiming().fill),
				})),
			});
			if (performance.now() < until) requestAnimationFrame(capture);
		});
	});
	await navigate(1);
	await delay(750);
	const frames = await evaluate(() => window.tauriTestFrames);
	await writeFile(path.join(folder, "transition-frames.json"), JSON.stringify(frames, null, 2));
	check(
		"live editor stationary",
		frames.every((frame) => Math.abs(frame.top - frame.viewportTop) < 2),
		true,
	);
	const covered = frames.filter((frame) => frame.snapshots.length);
	if (!report.engine.reducedMotion) check("animation frames observed", covered.length > 0, true);
	check(
		"live editor covered during animation",
		covered.every((frame) => frame.opacity === 0),
		true,
	);
	check(
		"animation endpoint fill",
		covered.every((frame) => frame.snapshots.every((snapshot) => snapshot.fills.every((fill) => fill === "both"))),
		true,
	);
	check(
		"outgoing snapshot never flashes back",
		covered.every((frame, index) => index === 0 || frame.snapshots[0].top <= covered[index - 1].snapshots[0].top + 2),
		true,
	);
	await navigate(-1);
	check(
		"scroll restoration",
		await evaluate(() => document.querySelector(".page-current .cm-scroller").scrollTop),
		remembered,
		2,
	);
	await scroll(0);
	const lineHeight = await evaluate(() =>
		parseFloat(getComputedStyle(document.querySelector(".cm-content")).lineHeight),
	);
	report.syntheticWheel = await evaluate(() => {
		const event = new WheelEvent("wheel", { deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true });
		const constructorValues = {
			deltaY: event.deltaY,
			deltaMode: event.deltaMode,
			wheelDeltaY: event.wheelDeltaY ?? null,
		};
		Object.defineProperty(event, "wheelDeltaY", { value: -120 });
		document.querySelector(".page-current .cm-scroller").dispatchEvent(event);
		return { constructorValues, suppliedWheelDeltaY: -120 };
	});
	await delay(350);
	check(
		"one normalized notch moves three rendered lines",
		await evaluate(() => document.querySelector(".page-current .cm-scroller").scrollTop),
		lineHeight * 3,
		2,
		"Synthetic DOM notch with deltaMode=LINE, deltaY=3, wheelDeltaY=-120; physical notch remains pending",
	);
	await scroll(0);
	const boundaryPage = await evaluate(() => {
		const scroller = document.querySelector(".page-current .cm-scroller");
		const send = (deltaY) =>
			scroller.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
		send(-399);
		const page = document.querySelector(".page-count").textContent.trim().replace("Pages ", "");
		send(-1);
		return page;
	});
	check("399px boundary intent stays", boundaryPage, "2 / 3", 0, "Synthetic DOM wheel");
	await settled();
	check("400px boundary intent navigates", await count(), "1 / 3", 0, "Synthetic DOM wheel");
	await delay(350);
	await wheel(100, { bar: true });
	await settled();
	check("bar wheel navigates", await count(), "2 / 3", 0, "Synthetic DOM wheel");
	await navigate(1);
	await selectText("cat");
	check("occurrence seed", await evaluate(() => window.getSelection().toString()), "cat", 0, "DOM range selection");
	check(
		"faint occurrence preview",
		await evaluate(() => document.querySelectorAll(".page-current .cm-occurrence-preview").length),
		1,
	);
	await chord(modifier, "d");
	await delay(200);
	check(
		"first Ctrl/Command+D adds occurrence",
		await evaluate(() => document.querySelector(".status-counts").textContent.includes("2 selections")),
		true,
	);
	check(
		"active matches removed from previews",
		await evaluate(() => document.querySelectorAll(".page-current .cm-occurrence-preview").length),
		0,
	);
	for (const theme of ["dark", "light"]) {
		await evaluate((value) => {
			document.documentElement.dataset.theme = value;
		}, theme);
		const colors = await evaluate(() => ({
			foreground: getComputedStyle(document.querySelector(".cm-active-selection")).color,
			background: getComputedStyle(document.querySelector(".cm-selectionBackground")).backgroundColor,
		}));
		check(`${theme} selection foreground`, colors.foreground, "rgb(255, 255, 255)");
		check(`${theme} selection background`, colors.background, "rgb(0, 120, 215)");
		await screenshot(`selection-${theme}`);
	}
	await browser.keys("dog");
	await delay(200);
	check(
		"multi-selection editing",
		await evaluate(() => document.querySelector(".cm-content").textContent.includes("dog dog")),
		true,
	);
	await chord(modifier, "z");
	await delay(200);
	check(
		"multi-selection undo",
		await evaluate(() => document.querySelector(".cm-content").textContent.includes("cat cat")),
		true,
	);
	await browser.keys(Key.Escape);
	await selectText("Final");
	await browser.keys("Updated");
	await delay(150);
	check(
		"ordinary typing",
		await evaluate(() => document.querySelector(".cm-content").textContent.startsWith("Updated page")),
		true,
	);
	await chord(modifier, "z");
	await delay(150);
	check(
		"ordinary typing undo",
		await evaluate(() => document.querySelector(".cm-content").textContent.startsWith("Final page")),
		true,
	);
	await navigate(-1);
	await scroll(500);
	const sizeBefore = await evaluate(() =>
		parseFloat(getComputedStyle(document.querySelector(".cm-content")).fontSize),
	);
	await wheel(-100, { ctrlKey: true });
	await delay(250);
	check(
		"Ctrl wheel increases editor font",
		(await evaluate(() => parseFloat(getComputedStyle(document.querySelector(".cm-content")).fontSize))) > sizeBefore,
		true,
		0,
		"Synthetic DOM wheel",
	);
	const zoomed = await evaluate(() => document.querySelector(".page-current .cm-scroller").scrollTop);
	await navigate(1);
	await navigate(-1);
	check(
		"zoomed scroll restoration",
		await evaluate(() => document.querySelector(".page-current .cm-scroller").scrollTop),
		zoomed,
		2,
	);
	const nativeServices = await evaluate(async () => {
		const invoke = (command, request = {}) => window.__TAURI_INTERNALS__.invoke(command, { request });
		const fonts = await invoke("get_system_fonts");
		if (!fonts.ok) throw new Error(`Font enumeration failed: ${fonts.error.code}`);
		const original = await invoke("read_clipboard");
		if (!original.ok) throw new Error(`Clipboard snapshot failed: ${original.error.code}`);
		const result = { fontCount: fonts.value.length, roundtrip: false, restored: false };
		let operationError = null;
		try {
			const written = await invoke("write_clipboard", { text: "dump.txt fixture 中文 👩‍💻\nclipboard" });
			if (!written.ok) throw new Error(`Clipboard write failed: ${written.error.code}`);
			const read = await invoke("read_clipboard");
			result.roundtrip = read.ok && read.value === "dump.txt fixture 中文 👩‍💻\nclipboard";
		} catch (error) {
			operationError = error;
		} finally {
			const restored = await invoke("write_clipboard", { text: original.value });
			const current = await invoke("read_clipboard");
			result.restored = restored.ok && current.ok && current.value === original.value;
		}
		if (!result.restored) throw new Error("Original clipboard text restoration failed");
		if (operationError) throw operationError;
		return result;
	});
	check("native font enumeration", nativeServices.fontCount > 0, true, 0, "Real native font command");
	check(
		"native Unicode clipboard roundtrip",
		nativeServices.roundtrip,
		true,
		0,
		"Real native clipboard commands; original text stays inside webview",
	);
	check(
		"original clipboard text restored",
		nativeServices.restored,
		true,
		0,
		"Real native clipboard command readback",
	);
	const originalFont = await evaluate(() => getComputedStyle(document.querySelector(".cm-content")).fontFamily);
	await browser.$('[aria-label="App menu"]').click();
	await waitFor(() => !!document.querySelector(".menu-content"));
	await browser.$('//*[contains(@role,"menuitem")][span[text()="Font…"]]').click();
	await waitFor(() => !!document.querySelector(".font-option"));
	const chosenFont = await evaluate(() => {
		const content = document.querySelector(".cm-content");
		const style = getComputedStyle(content);
		const canvas = document.createElement("canvas").getContext("2d");
		const sample = "WWWW iiiii 0123456789";
		canvas.font = `20px ${style.fontFamily}`;
		const originalWidth = canvas.measureText(sample).width;
		for (const option of document.querySelectorAll(".font-option")) {
			canvas.font = `20px ${JSON.stringify(option.textContent)}`;
			if (Math.abs(canvas.measureText(sample).width - originalWidth) <= 1) continue;
			option.dataset.tauriTestFont = "true";
			return option.textContent;
		}
		throw new Error("No installed font with distinct metrics available for live font test");
	});
	await browser.$('[data-tauri-test-font="true"]').click();
	await delay(250);
	check(
		"native family previews in editor",
		await evaluate(
			(family) => getComputedStyle(document.querySelector(".cm-content")).fontFamily.includes(family),
			chosenFont,
		),
		true,
		0,
		"Native font list and WebDriver font-picker selection",
	);
	await browser.$(".font-picker-actions button").click();
	await waitFor(() => !document.querySelector(".font-picker"));
	check(
		"font cancel restores original",
		await evaluate(() => getComputedStyle(document.querySelector(".cm-content")).fontFamily),
		originalFont,
	);
	report.events = await evaluate(() => window.tauriTestEvents);
	check("renderer errors", (await evaluate(() => window.tauriTestErrors)).join("\n"), "");
	await screenshot("final");
} catch (error) {
	failures.push({ name: "harness execution", error: error.stack ?? String(error) });
	if (browser) await browser.saveScreenshot(path.join(folder, "failure.png")).catch(() => undefined);
} finally {
	if (browser) {
		try {
			await cleanupWdioSession(browser);
		} catch (error) {
			failures.push({ name: "session cleanup", error: String(error) });
		}
	}
	report.result = failures.length ? "fail" : "pass";
	await writeFile(path.join(folder, "report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ folder, result: report.result, observations: observations.length, failures }, null, 2));
}
process.exit(failures.length ? 1 : 0);
