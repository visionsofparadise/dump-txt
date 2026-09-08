import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { executable } from "./tauriTestHost.mjs";

const execute = promisify(execFile);
let compiledSwift;
const source = (name) => fileURLToPath(new URL(name, import.meta.url));
const run = async (command, args) =>
	(await execute(command, args, { encoding: "utf8", timeout: 30000, windowsHide: true })).stdout.trim();

async function linuxWindow() {
	const candidates = (await run("pgrep", ["-x", "dump-txt"])).split("\n");
	const matching = [];
	for (const candidate of candidates)
		if ((await readlink(`/proc/${candidate}/exe`)) === executable) matching.push(candidate);
	assert.equal(matching.length, 1, "Expected one isolated Linux app with the exact executable path");
	const windows = (await run("xdotool", ["search", "--all", "--onlyvisible", "--pid", matching[0], "--name", "."]))
		.split("\n")
		.filter(Boolean);
	assert.equal(windows.length, 1, "Expected one visible Linux application window");
	return windows[0];
}

async function createLinuxDriver() {
	const window = await linuxWindow();
	return async (action, request = {}) => {
		const command = (...args) => run("xdotool", args);
		if (action === "state") {
			const geometry = Object.fromEntries(
				(await command("getwindowgeometry", "--shell", window)).split("\n").map((line) => line.split("=")),
			);
			const information = await run("xwininfo", ["-id", window]);
			const absoluteX = information.match(/Absolute upper-left X:\s*(-?\d+)/);
			const absoluteY = information.match(/Absolute upper-left Y:\s*(-?\d+)/);
			assert.ok(absoluteX && absoluteY, "X11 window must expose absolute client coordinates");
			const clientX = Number(absoluteX[1]);
			const clientY = Number(absoluteY[1]);
			const properties = await run("xprop", ["-id", window, "_NET_WM_STATE", "_NET_FRAME_EXTENTS"]);
			const extents = properties.match(/_NET_FRAME_EXTENTS[^=]*=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/);
			assert.ok(extents, "Window manager must expose native frame extents");
			const [, left, right, top, bottom] = extents.map(Number);
			return {
				x: clientX - left,
				y: clientY - top,
				width: Number(geometry.WIDTH) + left + right,
				height: Number(geometry.HEIGHT) + top + bottom,
				clientX,
				clientY,
				xdotoolX: Number(geometry.X),
				xdotoolY: Number(geometry.Y),
				minimized: properties.includes("_NET_WM_STATE_HIDDEN"),
				maximized:
					properties.includes("_NET_WM_STATE_MAXIMIZED_VERT") &&
					properties.includes("_NET_WM_STATE_MAXIMIZED_HORZ"),
				controls: [],
			};
		}
		if (action === "focus" || action === "restore") {
			await command("windowmap", window);
			return command("windowactivate", "--sync", window);
		}
		if (action === "pointer") {
			await command("windowactivate", "--sync", window);
			await command("mousemove", "--sync", String(request.x), String(request.y));
			await command("mousedown", "1");
			try {
				if (request.endX !== undefined)
					for (let step = 1; step <= 20; step++) {
						await command(
							"mousemove",
							String(Math.round(request.x + ((request.endX - request.x) * step) / 20)),
							String(Math.round(request.y + ((request.endY - request.y) * step) / 20)),
						);
						await delay(15);
					}
				else await delay(60);
			} finally {
				await command("mouseup", "1");
			}
			return;
		}
		if (action === "screenshot") {
			const bounds = request.bounds;
			return run("import", [
				"-window",
				"root",
				"-crop",
				`${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`,
				request.path,
			]);
		}
		const keys = { minimize: "alt+F9", maximize: "alt+F10", close: "alt+F4" };
		assert.ok(keys[action], `Unknown native action: ${action}`);
		await command("windowactivate", "--sync", window);
		return command("key", "--clearmodifiers", keys[action]);
	};
}

export async function createNativeWindow(browser, folder) {
	await mkdir(folder, { recursive: true });
	let native;
	if (process.platform === "linux") native = await createLinuxDriver();
	else {
		if (process.platform === "darwin" && !compiledSwift) {
			const target = path.join(folder, "nativeWindow");
			await execute("swiftc", [source("nativeWindow.swift"), "-o", target], { timeout: 120000 });
			compiledSwift = target;
		}
		assert.ok(["darwin", "win32"].includes(process.platform), "Native checks support Windows, macOS, and Linux");
		let windowHandle;
		native = async (action, request = {}) => {
			const input = JSON.stringify({ action, executable: path.resolve(executable), windowHandle, ...request });
			const output =
				process.platform === "win32"
					? await run("powershell.exe", [
							"-NoProfile",
							"-NonInteractive",
							"-ExecutionPolicy",
							"Bypass",
							"-File",
							source("nativeWindow.ps1"),
							"-Request",
							input,
						])
					: await run(compiledSwift, [input]);
			if (action !== "state") return;
			const result = JSON.parse(output);
			windowHandle ??= result.windowHandle;
			return result;
		};
		await native("state");
	}
	const state = () => native("state");
	let clickNumber = 0;
	const trace = (entry) =>
		appendFile(path.join(folder, "native-pointer.jsonl"), `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
	const point = async (selector) => {
		let bounds;
		let previousBounds;
		await browser.waitUntil(
			async () => {
				bounds = await state();
				const geometry = JSON.stringify([
					bounds.x,
					bounds.y,
					bounds.width,
					bounds.height,
					bounds.clientX,
					bounds.clientY,
				]);
				const stable = !bounds.minimized && geometry === previousBounds;
				previousBounds = geometry;
				return stable;
			},
			{ timeout: 10000, interval: 150, timeoutMsg: "Native window geometry must settle before pointer input" },
		);
		if (selector === null) {
			assert.equal(process.platform, "linux", "Native frame drag is only used on Linux");
			return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round((bounds.y + bounds.clientY) / 2) };
		}
		await browser.execute((query) => {
			const element = document.querySelector(query);
			if (!element) throw new Error(`Missing native pointer target: ${query}`);
			element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
		}, selector);
		let geometry;
		let previous;
		await browser.waitUntil(
			async () => {
				geometry = await browser.execute((query) => {
					const element = document.querySelector(query);
					if (!element) return null;
					const rect = element.getBoundingClientRect();
					const x = rect.x + rect.width / 2;
					const y = rect.y + rect.height / 2;
					const hit = document.elementFromPoint(x, y);
					return {
						x,
						y,
						width: rect.width,
						height: rect.height,
						scale: devicePixelRatio,
						hit: !!hit && element.contains(hit),
						hitTag: hit?.tagName,
						hitText: hit?.textContent?.slice(0, 100),
					};
				}, selector);
				const stable =
					geometry?.hit && geometry.width > 0 && geometry.height > 0 && JSON.stringify(geometry) === previous;
				previous = JSON.stringify(geometry);
				return stable;
			},
			{ timeout: 5000, interval: 100, timeoutMsg: `Native target must settle and pass hit testing: ${selector}` },
		);
		const scale = process.platform === "darwin" ? 1 : geometry.scale;
		return { x: Math.round(bounds.clientX + geometry.x * scale), y: Math.round(bounds.clientY + geometry.y * scale) };
	};
	const click = async (selector, observeRenderer = true) => {
		const number = ++clickNumber;
		await browser.execute(() => {
			if (!window.nativePointerEvents) {
				window.nativePointerEvents = [];
				for (const type of ["pointerdown", "pointerup", "click"])
					document.addEventListener(
						type,
						(event) => {
							const element = event.target.closest?.("[role], button");
							window.nativePointerEvents.push({
								type,
								trusted: event.isTrusted,
								x: event.clientX,
								y: event.clientY,
								role: element?.getAttribute("role"),
								label: element?.getAttribute("aria-label"),
								text: element?.textContent?.slice(0, 100),
								theme: document.documentElement.dataset.theme,
							});
						},
						true,
					);
			}
			window.nativePointerEvents.length = 0;
		});
		const position = await point(selector);
		const viewport = await browser.execute(
			(query) => ({
				target: document.querySelector(query)?.getBoundingClientRect().toJSON(),
				screenX,
				screenY,
				innerWidth,
				innerHeight,
				outerWidth,
				outerHeight,
				scale: devicePixelRatio,
			}),
			selector,
		);
		await trace({ number, phase: "before", selector, position, viewport, bounds: await state() });
		if (selector.includes("data-chrome-test"))
			await native("screenshot", { path: path.join(folder, `pointer-${number}-before.png`), bounds: await state() });
		await native("pointer", position);
		if (!observeRenderer) {
			const bounds = await state().catch((error) => ({ unavailable: String(error) }));
			await trace({ number, phase: "after", selector, bounds });
			return;
		}
		await delay(150);
		const events = await browser
			.execute(() => ({ events: window.nativePointerEvents, theme: document.documentElement.dataset.theme }))
			.catch((error) => ({ disconnected: String(error) }));
		await trace({ number, phase: "after", selector, ...events });
	};
	const control = (action, selector) =>
		process.platform === "win32" ? click(selector, !["minimize", "close"].includes(action)) : native(action);
	await native("focus");
	return {
		method:
			process.platform === "linux"
				? "X11 mouse input; Openbox Alt+F9/F10/F4 window controls; native frame screenshot"
				: process.platform === "darwin"
					? "CoreGraphics mouse input; AX native button geometry; Option-click zoom; native window screenshot"
					: "Win32 mouse input at DPI-scaled client coordinates; native window screenshot",
		state,
		click,
		drag: async (selector, deltaX, deltaY) => {
			const start = await point(selector);
			return native("pointer", { ...start, endX: start.x + deltaX, endY: start.y + deltaY });
		},
		minimize: () => control("minimize", '[aria-label="Minimize"]'),
		maximize: () => control("maximize", '[aria-label="Maximize"], [aria-label="Restore window"]'),
		restore: async () => {
			await native("restore");
			if (process.platform !== "win32" && (await state()).maximized) await native("maximize");
		},
		close: () => control("close", '[aria-label="Close window"]'),
		screenshot: async (name) => {
			assert.match(name, /^[a-z\d-]+$/iu, "Screenshot names must be simple labels");
			const target = path.join(folder, `${name}.png`);
			await native("focus");
			await delay(150);
			await native("screenshot", { path: target, bounds: await state() });
			return target;
		},
	};
}
