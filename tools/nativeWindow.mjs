import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readlink } from "node:fs/promises";
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
			const properties = await run("xprop", ["-id", window, "_NET_WM_STATE", "_NET_FRAME_EXTENTS"]);
			const extents = properties.match(/_NET_FRAME_EXTENTS[^=]*=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/);
			assert.ok(extents, "Window manager must expose native frame extents");
			const [, left, right, top, bottom] = extents.map(Number);
			return {
				x: Number(geometry.X) - left,
				y: Number(geometry.Y) - top,
				width: Number(geometry.WIDTH) + left + right,
				height: Number(geometry.HEIGHT) + top + bottom,
				clientX: Number(geometry.X),
				clientY: Number(geometry.Y),
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
		native = async (action, request = {}) => {
			const input = JSON.stringify({ action, executable: path.resolve(executable), ...request });
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
			return action === "state" ? JSON.parse(output) : undefined;
		};
	}
	const state = () => native("state");
	const point = async (selector) => {
		const bounds = await state();
		if (selector === null) {
			assert.equal(process.platform, "linux", "Native frame drag is only used on Linux");
			return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round((bounds.y + bounds.clientY) / 2) };
		}
		const geometry = await browser.execute((query) => {
			const element = document.querySelector(query);
			if (!element) throw new Error(`Missing native pointer target: ${query}`);
			element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
			const rect = element.getBoundingClientRect();
			if (!rect.width || !rect.height) throw new Error(`Native pointer target has no area: ${query}`);
			return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, scale: devicePixelRatio };
		}, selector);
		const scale = process.platform === "darwin" ? 1 : geometry.scale;
		return { x: Math.round(bounds.clientX + geometry.x * scale), y: Math.round(bounds.clientY + geometry.y * scale) };
	};
	const click = async (selector) => native("pointer", await point(selector));
	const control = (action, selector) => (process.platform === "win32" ? click(selector) : native(action));
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
