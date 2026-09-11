import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoRig, DemoStopped } from "./DemoRig";
import type { ChromeContext } from "@dump-txt/ui";

function createRig(options: { readonly origin?: { readonly x: number; readonly y: number } } = {}) {
	const typed: Array<string> = [];
	const stage = document.createElement("div");
	const pointer = document.createElement("div");
	const editor = {
		focus: vi.fn(),
		revealSelection: vi.fn(),
		apply: vi.fn((command: { readonly text: string }) => {
			typed.push(command.text);
		}),
	};
	const context = { editor } as unknown as ChromeContext;

	stage.append(pointer);
	document.body.append(stage);

	return { rig: new DemoRig({ ...options, stage, pointer, context: () => context }), typed };
}

describe("DemoRig", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		document.body.replaceChildren();
	});

	it("reports its origin and whether it has stopped", () => {
		const { rig } = createRig({ origin: { x: 820, y: 650 } });

		expect(rig.origin).toEqual({ x: 820, y: 650 });
		expect(createRig().rig.origin).toEqual({ x: 0, y: 0 });
		expect(rig.stopped).toBe(false);

		rig.stop();

		expect(rig.stopped).toBe(true);
	});

	it("rejects a pending wait when stopped", async () => {
		const { rig } = createRig();
		const waiting = expect(rig.wait(10_000)).rejects.toBeInstanceOf(DemoStopped);

		await vi.advanceTimersByTimeAsync(100);
		rig.stop();

		await waiting;
	});

	it("rejects a pending move when stopped while no animation frame fires", async () => {
		const requestAnimationFrame = vi.fn(() => 0);

		vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);

		const { rig } = createRig();
		const moving = expect(rig.move({ x: 100, y: 100 }, 10_000)).rejects.toBeInstanceOf(DemoStopped);

		await vi.advanceTimersByTimeAsync(100);
		rig.stop();

		await moving;
		expect(requestAnimationFrame).toHaveBeenCalledOnce();
	});

	it.each<[string, (rig: DemoRig) => Promise<void>]>([
		["wait", (rig) => rig.wait(1)],
		["move", (rig) => rig.move({ x: 1, y: 1 })],
		["click", (rig) => rig.click(".cm-content")],
		["type", (rig) => rig.type("a")],
		["paste", (rig) => rig.paste("a")],
		["key", (rig) => rig.key("Enter")],
		["wheel", (rig) => rig.wheel(100)],
		["select", (rig) => rig.select("a")],
	])("fails %s after a stop", async (_name, call) => {
		const { rig } = createRig();

		rig.stop();

		await expect(call(rig)).rejects.toBeInstanceOf(DemoStopped);
	});

	it("types no further characters once stopped mid-string", async () => {
		const { rig, typed } = createRig();
		const typing = expect(rig.type("abcdef", 45)).rejects.toBeInstanceOf(DemoStopped);

		await vi.advanceTimersByTimeAsync(90);

		expect(typed).toEqual(["a", "b", "c"]);

		rig.stop();

		await typing;
		await vi.advanceTimersByTimeAsync(1000);

		expect(typed).toEqual(["a", "b", "c"]);
	});
});
