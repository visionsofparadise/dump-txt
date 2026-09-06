import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = process.argv.includes("--baseline");
const executable =
	process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
	path.join(root, "out/dump.txt-win32-x64/dump-txt.exe");
const folder = path.join(root, ".scratch/electron-tests", `${Date.now()}`);
await mkdir(folder, { recursive: true });
const pages = [
	Array.from(
		{ length: 320 },
		(_, index) =>
			`First ${String(index + 1).padStart(4, "0")}\talpha beta alpha — wrapped text ${"visible words ".repeat(9)}`,
	).join("\n"),
	"Second page\nalpha beta alpha\n\nshort page",
	Array.from(
		{ length: 1200 },
		(_, index) => `Large ${String(index + 1).padStart(4, "0")} ${"numbered content ".repeat(60)}`,
	).join("\n") + "\nalpha",
	"",
];
const fixturePath = path.join(folder, "session-notes.txt");
const fixtureText = pages.join("\n\f\n");
await writeFile(fixturePath, fixtureText);
await writeFile(
	path.join(folder, "app-state.json"),
	JSON.stringify({
		version: 1,
		activePath: fixturePath,
		appearance: { theme: "system", font: "Consolas", textSize: 11 },
		findPreferences: { matchCase: false, allPages: false },
		occurrencePreferences: { matchCase: false, allPages: false },
		windowBounds: null,
		savedContentHash: createHash("sha256").update(fixtureText).digest("hex"),
		activePageIndex: 0,
		selections: pages.map(() => ({ ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 })),
	}),
);
const server = createServer();
await new Promise((resolve, reject) => {
	server.once("error", reject);
	server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const child = spawn(
	executable,
	[
		`--remote-debugging-port=${port}`,
		"--remote-debugging-address=127.0.0.1",
		"--disable-backgrounding-occluded-windows",
		"--disable-background-timer-throttling",
		`--user-data-dir=${folder}`,
	],
	{ windowsHide: !process.argv.includes("--interactive"), stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
child.stdout.on("data", (data) => {
	output += data;
});
child.stderr.on("data", (data) => {
	output += data;
});
const startupError = new Promise((_, reject) => child.once("error", reject));
let socket;
const failures = [];
const observations = [];
const errors = [];
try {
	const target = await Promise.race([
		startupError,
		(async () => {
			for (let attempt = 0; attempt < 100; attempt++) {
				try {
					const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
					const page = targets.find((item) => item.type === "page");
					if (page) return page;
				} catch {
					if (child.exitCode !== null) throw new Error(`App exited: ${output}`);
				}
				if (child.exitCode !== null) throw new Error(`App exited: ${output}`);
				await delay(100);
			}
			throw new Error(`Renderer did not start: ${output}`);
		})(),
	]);
	socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let identifier = 0;
	const pending = new Map();
	socket.addEventListener("message", ({ data }) => {
		const message = JSON.parse(data);
		if (message.id) {
			const entry = pending.get(message.id);
			if (!entry) return;
			clearTimeout(entry.timeout);
			pending.delete(message.id);
			if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
			else entry.resolve(message.result);
		} else if (message.method === "Runtime.exceptionThrown") errors.push(message.params);
	});
	socket.addEventListener("close", () => {
		for (const entry of pending.values()) {
			clearTimeout(entry.timeout);
			entry.reject(new Error("Renderer closed"));
		}
		pending.clear();
	});
	const send = (method, parameters = {}) =>
		new Promise((resolve, reject) => {
			const id = ++identifier;
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`CDP timed out: ${method} ${JSON.stringify(parameters)}`));
			}, 15000);
			pending.set(id, { resolve, reject, timeout });
			socket.send(JSON.stringify({ id, method, params: parameters }));
		});
	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
		return result.result.value;
	};
	const waitFor = async (expression) => {
		for (let attempt = 0; attempt < 100; attempt++) {
			if (await evaluate(expression)) return;
			await delay(50);
		}
		throw new Error(`Timed out: ${expression}`);
	};
	const key = async (key, code, modifiers = 0) => {
		await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
		await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
	};
	const clickAt = async (point) => {
		await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
		await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
	};
	const click = async (label) => {
		const point = await evaluate(
			`(()=>{const element=[...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')===${JSON.stringify(label)});if(!element)throw new Error('Missing button');const rect=element.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`,
		);
		await clickAt(point);
	};
	const check = (name, actual, expected, tolerance = 0) => {
		observations.push({ name, actual, expected });
		if (
			typeof actual === "number" && typeof expected === "number"
				? Math.abs(actual - expected) > tolerance
				: actual !== expected
		)
			failures.push({ name, actual, expected });
	};
	const screenshot = async (name) => {
		const result = await send("Page.captureScreenshot", { format: "png" });
		await writeFile(path.join(folder, `${name}.png`), Buffer.from(result.data, "base64"));
	};
	const scroll = async (position) => {
		await evaluate(`document.querySelector('.cm-scroller').scrollTop = ${position}`);
		await delay(150);
		return evaluate("document.querySelector('.cm-scroller').scrollTop");
	};
	const navigate = async (direction) => {
		await key(direction > 0 ? "ArrowDown" : "ArrowUp", direction > 0 ? "ArrowDown" : "ArrowUp", 1);
		await delay(50);
		await waitFor(
			"document.querySelectorAll('.page-snapshot').length === 0 && !document.querySelector('.page-current .page-editor-covered')",
		);
		await delay(100);
	};
	const liveScroller = "document.querySelector('.page-current .cm-scroller')";
	const pageCount = () => evaluate("document.querySelector('.page-count').textContent.trim()");
	const wheel = async (deltaY, source = liveScroller) => {
		const point = await evaluate(
			`(()=>{const r=${source}.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,
		);
		await send("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY });
	};
	const inspectLeadingLine = async (name, prefix) => {
		const line = await evaluate(
			`(()=>{const scroller=${liveScroller};const line=scroller.querySelector('.cm-line');const rect=line?.getBoundingClientRect();const viewport=scroller.getBoundingClientRect();return {text:line?.textContent,top:rect?.top,bottom:rect?.bottom,viewportTop:viewport.top,viewportBottom:viewport.bottom};})()`,
		);
		check(`${name} text`, line.text?.startsWith(prefix), true);
		check(
			`${name} geometry`,
			line.top >= line.viewportTop && line.top < line.viewportBottom && line.bottom > line.top,
			true,
		);
	};
	await send("Runtime.enable");
	await waitFor(
		"!!document.querySelector('.cm-content') && document.querySelector('.page-count')?.textContent.includes('1 / 4')",
	);
	await delay(250);
	if (!baseline) {
		check(
			"title follows current filename",
			await evaluate("document.querySelector('.app-name').textContent"),
			"session-notes.txt",
		);
		check(
			"all bars are40px",
			await evaluate(
				"[...document.querySelectorAll('.title-bar,.page-bar')].every(bar=>bar.getBoundingClientRect().height===40)",
			),
			true,
		);
		check(
			"filename and page count use Arial",
			await evaluate(
				"['.app-name','.page-count'].every(selector=>getComputedStyle(document.querySelector(selector)).fontFamily.includes('Arial'))",
			),
			true,
		);
		check(
			"plus remains in top left slot",
			await evaluate("!!document.querySelector('.page-bar-leading [aria-label=\"Insert page above\"]')"),
			true,
		);
		check(
			"previous arrow hidden on first page",
			await evaluate("getComputedStyle(document.querySelector('.page-bar .page-nav-main')).visibility"),
			"hidden",
		);
		const scrollbar = await evaluate(
			"(()=>{const scroller=document.querySelector('.page-current .cm-scroller');const bar=getComputedStyle(document.querySelector('.page-bar')).backgroundColor;return {matches:getComputedStyle(scroller,'::-webkit-scrollbar-track').backgroundColor===bar||getComputedStyle(scroller).scrollbarColor.includes(bar),arrows:getComputedStyle(scroller,'::-webkit-scrollbar-button').display};})()",
		);
		check("scroll track matches page bars", scrollbar.matches, true);
		check("scrollbar arrows removed", scrollbar.arrows, "none");
		await click("App menu");
		await waitFor("!!document.querySelector('.menu-content')");
		const menu = await evaluate(
			"(()=>{const element=document.querySelector('.menu-content');return {left:element.getBoundingClientRect().left,radius:getComputedStyle(element).borderRadius,text:element.textContent};})()",
		);
		check("app menu meets left window edge", menu.left, 0, 1);
		check("app menu is square", menu.radius, "0px");
		check("app menu has Close", menu.text.includes("Close"), true);
		check("app menu omits Delete page", menu.text.includes("Delete page"), false);
		await screenshot("app-menu");
		await clickAt({ x: 300, y: 20 });
		await waitFor("!document.querySelector('.menu-content')");
		check("title click closes menu", await evaluate("!!document.querySelector('.menu-content')"), false);
	}
	await screenshot("initial");
	const remembered = await scroll(1700);
	await evaluate(
		`window.transitionFrames = []; window.captureUntil = performance.now() + 750; requestAnimationFrame(function capture() { const live = document.querySelector('.page-current .cm-editor'); const viewport = document.querySelector('.page-viewport'); const rect = live.getBoundingClientRect(); const parent = live.closest('.page-current'); const opacity = [live,live.parentElement,parent].reduce((value,node)=>value*Number(getComputedStyle(node).opacity),1); window.transitionFrames.push({at:performance.now(), top: rect.top, viewportTop: viewport.getBoundingClientRect().top, transform: getComputedStyle(parent).transform, liveOpacity: opacity, snapshots: [...document.querySelectorAll('.page-snapshot')].map(node=>({top:node.getBoundingClientRect().top,transform:getComputedStyle(node).transform,animations:node.getAnimations().map(animation=>({time:animation.currentTime,fill:animation.effect.getTiming().fill}))})) }); if (performance.now() < window.captureUntil) requestAnimationFrame(capture); });`,
	);
	await key("ArrowDown", "ArrowDown", 1);
	await screenshot("slide-start");
	await delay(65);
	await screenshot("slide-middle");
	await delay(180);
	await screenshot("slide-finish");
	await delay(550);
	const transitionFrames = await evaluate("window.transitionFrames");
	await writeFile(path.join(folder, "transition-frames.json"), JSON.stringify(transitionFrames, null, 2));
	check(
		"live editor stays stationary during slide",
		transitionFrames.every((frame) => Math.abs(frame.top - frame.viewportTop) < 2),
		true,
	);
	if (!baseline) {
		const coveredFrames = transitionFrames.filter((frame) => frame.snapshots.length);
		check("slide frames observed", coveredFrames.length > 0, true);
		check(
			"live text covered throughout slide",
			coveredFrames.every((frame) => frame.liveOpacity === 0),
			true,
		);
		check(
			"snapshots retain animation endpoints",
			coveredFrames.every((frame) =>
				frame.snapshots.every((snapshot) => snapshot.animations.every((animation) => animation.fill === "both")),
			),
			true,
		);
		const departing = coveredFrames.map((frame) => frame.snapshots[0].top);
		check(
			"outgoing snapshot never flashes back",
			departing.every((top, index) => index === 0 || top <= departing[index - 1] + 2),
			true,
		);
		check("slide cleans up", await evaluate("document.querySelectorAll('.page-snapshot').length"), 0);
	}
	await navigate(-1);
	check(
		"remembered first page position",
		await evaluate("document.querySelector('.cm-scroller').scrollTop"),
		remembered,
		2,
	);
	await navigate(1);
	await navigate(1);
	await inspectLeadingLine("large page leading line on entry", "Large 0001");
	await screenshot("large-top");
	const largeRemembered = await scroll(4600);
	await navigate(-1);
	await navigate(1);
	check(
		"remembered large page position",
		await evaluate("document.querySelector('.cm-scroller').scrollTop"),
		largeRemembered,
		2,
	);
	if (!baseline) {
		await key("ArrowUp", "ArrowUp", 1);
		await key("ArrowDown", "ArrowDown", 1);
		await key("ArrowUp", "ArrowUp", 1);
		await delay(450);
		check("rapid navigation reaches final destination", await pageCount(), "2 / 4");
		check(
			"rapid navigation removes stale snapshots",
			await evaluate("document.querySelectorAll('.page-snapshot').length"),
			0,
		);
		await key("ArrowDown", "ArrowDown", 1);
		await send("Emulation.setDeviceMetricsOverride", {
			width: 680,
			height: 460,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await delay(450);
		check("resize during slide destination", await pageCount(), "3 / 4");
		check("resize cleans up snapshots", await evaluate("document.querySelectorAll('.page-snapshot').length"), 0);
		check(
			"resize exposes live editor",
			await evaluate(
				"[document.querySelector('.page-current .cm-editor'),document.querySelector('.page-current .page-editor'),document.querySelector('.page-current')].reduce((opacity,node)=>opacity*Number(getComputedStyle(node).opacity),1)",
			),
			1,
		);
		await send("Emulation.clearDeviceMetricsOverride");
		await delay(200);
		await key("ArrowUp", "ArrowUp", 1);
		await key("Home", "Home", 2);
		await send("Input.insertText", { text: "Transition input " });
		await delay(300);
		check("input during slide targets destination", await pageCount(), "2 / 4");
		check(
			"input during slide appears immediately",
			await evaluate(
				"document.querySelector('.page-current .cm-content').textContent.startsWith('Transition input Second page')",
			),
			true,
		);
		check("input cancels slide", await evaluate("document.querySelectorAll('.page-snapshot').length"), 0);
		await key("z", "KeyZ", 2);
		await delay(150);
		check(
			"slide input undo",
			await evaluate("document.querySelector('.page-current .cm-content').textContent.startsWith('Second page')"),
			true,
		);
		await navigate(1);
		await scroll(0);
		await wheel(-100);
		await delay(450);
		check(
			"upward overscroll previous page",
			await evaluate("document.querySelector('.page-count').textContent.trim()"),
			"2 / 4",
		);
		await wheel(-100);
		await delay(450);
		check("upward overscroll enters previous long page", await pageCount(), "1 / 4");
		check(
			"upward overscroll enters bottom",
			await evaluate(`${liveScroller}.scrollHeight-${liveScroller}.clientHeight-${liveScroller}.scrollTop`),
			0,
			2,
		);
		await wheel(100);
		await delay(450);
		check("downward overscroll enters next page", await pageCount(), "2 / 4");
		check("downward overscroll enters top", await evaluate(`${liveScroller}.scrollTop`), 0, 2);
		await evaluate(
			"document.querySelector('.page-bar').dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}))",
		);
		await delay(450);
		check("bar wheel next page", await evaluate("document.querySelector('.page-count').textContent.trim()"), "3 / 4");
		const beforeSize = await evaluate("parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize)");
		await scroll(2000);
		const anchorBefore = await evaluate(
			`(()=>{const range=document.caretRangeFromPoint(160,200);const line=range.startContainer.parentElement.closest('.cm-line');const prefix=range.cloneRange();prefix.selectNodeContents(line);prefix.setEnd(range.startContainer,range.startOffset);window.zoomAnchor={text:line.textContent,offset:prefix.toString().length};return range.getBoundingClientRect().top;})()`,
		);
		await evaluate(
			"document.querySelector('.cm-scroller').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,ctrlKey:true,bubbles:true,cancelable:true,clientX:160,clientY:200}))",
		);
		await delay(200);
		check(
			"control wheel increases text size",
			(await evaluate("parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize)")) > beforeSize,
			true,
		);
		const anchorAfter = await evaluate(
			`(()=>{const line=[...document.querySelectorAll('.page-current .cm-line')].find(line=>line.textContent===window.zoomAnchor.text);if(!line)return null;const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let offset=window.zoomAnchor.offset;let node;while(node=walker.nextNode()){if(offset<=node.textContent.length){const range=document.createRange();range.setStart(node,offset);range.collapse(true);return range.getBoundingClientRect().top;}offset-=node.textContent.length;}return null;})()`,
		);
		check("control wheel keeps pointer text position", anchorAfter, anchorBefore, 2);
		const zoomScroll = await evaluate(`${liveScroller}.scrollTop`);
		await navigate(-1);
		await navigate(1);
		check("zoomed page remembered position", await evaluate(`${liveScroller}.scrollTop`), zoomScroll, 2);
		await key("Home", "Home", 2);
		const typingAt = performance.now();
		for (const text of "typing") await send("Input.insertText", { text });
		observations.push({
			name: "ordinary typing on large page",
			bytes: Buffer.byteLength(pages[2]),
			durationMilliseconds: performance.now() - typingAt,
		});
		await key("z", "KeyZ", 2);
		await navigate(-1);
		await key("Home", "Home", 2);
		await key("ArrowDown", "ArrowDown");
		await key("Home", "Home");
		for (let index = 0; index < 5; index++) await key("ArrowRight", "ArrowRight", 8);
		await delay(150);
		check("selected text seed", await evaluate("window.getSelection().toString()"), "alpha");
		check(
			"passive occurrence preview",
			await evaluate("document.querySelectorAll('.page-current .cm-occurrence-preview').length"),
			1,
		);
		await screenshot("occurrence-preview-dark");
		await key("d", "KeyD", 2);
		await delay(150);
		check(
			"first selected-text control D adds next",
			await evaluate("document.querySelector('.occurrence-panel .panel-count').textContent"),
			"2 selections · 1 page",
		);
		check(
			"selected targets removed from previews",
			await evaluate("document.querySelectorAll('.page-current .cm-occurrence-preview').length"),
			0,
		);
		for (const theme of ["dark", "light"]) {
			await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
			const selectionStyle = await evaluate(
				"(()=>{const glyph=document.querySelector('.page-current .cm-active-selection');const background=document.querySelector('.page-current .cm-selectionBackground');return {foreground:getComputedStyle(glyph).color,background:getComputedStyle(background).backgroundColor};})()",
			);
			check(`${theme} selected glyphs white`, selectionStyle.foreground, "rgb(255, 255, 255)");
			check(`${theme} active selection blue`, selectionStyle.background, "rgb(0, 120, 215)");
			observations.push({ name: `${theme} selection palette`, ...selectionStyle });
			await screenshot(`active-selection-${theme}`);
		}
		await send("Input.insertText", { text: "gamma" });
		await delay(100);
		check(
			"selected occurrences edit together",
			await evaluate("document.querySelector('.page-current .cm-content').textContent.includes('gamma beta gamma')"),
			true,
		);
		await key("z", "KeyZ", 2);
		await delay(100);
		check(
			"occurrence edit undo",
			await evaluate("document.querySelector('.page-current .cm-content').textContent.includes('alpha beta alpha')"),
			true,
		);
		await evaluate("document.querySelectorAll('.occurrence-panel input')[1].click()");
		await key("d", "KeyD", 2);
		await delay(300);
		check("next occurrence crosses to large page", await pageCount(), "3 / 4");
		const distantMatch = await evaluate(
			`(()=>{const mark=document.querySelector('.page-current .cm-active-selection');const rect=mark?.getBoundingClientRect();const viewport=${liveScroller}.getBoundingClientRect();return {text:mark?.textContent,visible:!!rect&&rect.top>=viewport.top&&rect.bottom<=viewport.bottom};})()`,
		);
		check("distant next occurrence selected", distantMatch.text, "alpha");
		check("distant next occurrence remains visible", distantMatch.visible, true);
		await screenshot("cross-page-occurrence");
		await key("Escape", "Escape");
		await key("Home", "Home", 2);
		await key("ArrowRight", "ArrowRight", 8);
		await delay(100);
		check(
			"one character clears previews",
			await evaluate("document.querySelectorAll('.page-current .cm-occurrence-preview').length"),
			0,
		);
		await navigate(1);
		check(
			"last page plus remains in left slot",
			await evaluate(
				"!!document.querySelector('.page-bar-bottom .page-bar-leading [aria-label=\"Insert page below\"]')",
			),
			true,
		);
		check(
			"next arrow hidden on last page",
			await evaluate("getComputedStyle(document.querySelector('.page-bar-bottom .page-nav-main')).visibility"),
			"hidden",
		);
	}
	await screenshot("final");
	check("renderer exceptions", errors.length, 0);
	if (process.argv.includes("--interactive")) {
		console.log(`Native verification ready: ${folder}`);
		await new Promise((resolve) => child.once("exit", resolve));
	} else await evaluate("setTimeout(()=>window.close(),0)");
	for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) await delay(50);
	check("normal close", child.exitCode, 0);
} finally {
	socket?.close();
	if (child.exitCode === null) child.kill();
	await writeFile(path.join(folder, "launch.log"), output);
	await writeFile(
		path.join(folder, "evidence.json"),
		JSON.stringify({ executable, baseline, observations, failures, errors }, null, 2),
	);
}
console.log(JSON.stringify({ folder, baseline, observations, failures }, null, 2));
if (!baseline) assert.equal(failures.length, 0, JSON.stringify(failures));
