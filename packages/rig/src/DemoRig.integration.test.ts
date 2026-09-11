import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoRig, DemoStopped, type DemoSurface } from "./DemoRig";
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

	return { rig: new DemoRig({ ...options, stage, pointer, context: () => context }), stage, typed };
}

function recordKeys(...elements: Array<HTMLElement>) {
	const received: Array<{ readonly target: EventTarget | null; readonly key: string; readonly ctrlKey: boolean }> = [];

	for (const element of elements)
		element.addEventListener("keydown", (event) => {
			if (event.target === element) received.push({ target: event.target, key: event.key, ctrlKey: event.ctrlKey });
		});

	return received;
}

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
	return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) };
}

function place(element: HTMLElement, bounds: DOMRect): HTMLElement {
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue(bounds);

	return element;
}

function createSurfaces(isTilesKeyTarget = true) {
	const stage = document.createElement("div");
	const pointer = document.createElement("div");
	const frame = document.createElement("iframe");
	const tiles = document.createElement("div");

	stage.append(pointer);
	document.body.append(stage, frame, tiles);
	place(stage, rectOf(100, 50, 800, 600));

	const frameDocument = frame.contentDocument;
	const frameView = frameDocument?.defaultView;

	if (!frameDocument || !frameView) throw new Error("The frame document is missing.");

	const surfaces: ReadonlyArray<DemoSurface> = [
		{ root: frameDocument, pointOf: ({ x, y }) => ({ x: 300 + x / 2, y: 200 + y / 2 }) },
		{ root: tiles, pointOf: (point) => point, isKeyTarget: isTilesKeyTarget },
	];
	const selections: Array<string> = [];
	const editor = {
		focus: vi.fn(),
		select: vi.fn(() => {
			selections.push(pointer.style.transform);
		}),
	};
	const context = {
		editor,
		document: { pages: [{ id: "page", text: "Dump text, think less." }] },
		session: { view: { activePageId: "page" } },
	} as unknown as ChromeContext;

	return {
		rig: new DemoRig({ stage, pointer, context: () => context, surfaces }),
		pointer,
		frameDocument,
		frameView,
		tiles,
		editor,
		selections,
	};
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

	it("sends a key to the focused element inside the stage", async () => {
		const { rig, stage } = createRig();
		const content = document.createElement("div");
		const field = document.createElement("input");

		content.className = "cm-content";
		stage.append(content, field);
		field.focus();

		const received = recordKeys(content, field);
		const keying = rig.key("d", { ctrlKey: true });

		await vi.advanceTimersByTimeAsync(350);
		await keying;

		expect(received).toEqual([{ target: field, key: "d", ctrlKey: true }]);
	});

	it.each<[string, () => void]>([
		[
			"an element outside the stage",
			() => {
				const download = document.createElement("a");

				download.href = "#download";
				document.body.prepend(download);
				download.focus();
			},
		],
		["nothing", () => undefined],
	])("sends a key to the editor content while focus is on %s", async (_focus, focusOutside) => {
		const { rig, stage } = createRig();
		const content = document.createElement("div");

		content.className = "cm-content";
		stage.append(content);
		focusOutside();

		const outside = document.activeElement;
		const received = recordKeys(content, document.body);
		const keying = rig.key("z", { ctrlKey: true });

		await vi.advanceTimersByTimeAsync(350);
		await keying;

		expect(outside && stage.contains(outside)).toBe(false);
		expect(received).toEqual([{ target: content, key: "z", ctrlKey: true }]);
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

	it("resolves a selector in the first surface that holds it", () => {
		const { rig, frameDocument, tiles } = createSurfaces();
		const framed = frameDocument.createElement("div");
		const paged = document.createElement("div");
		const tile = document.createElement("button");

		framed.className = "target";
		paged.className = "target";
		tile.className = "tile";
		frameDocument.body.append(framed);
		tiles.append(paged, tile);

		expect(rig.element(".target")).toBe(framed);
		expect(rig.element(".tile")).toBe(tile);
		expect(() => rig.element(".demo-stage")).toThrow("Demo target is missing: .demo-stage");
	});

	it("moves and clicks at the mapped centre of a target in each surface", async () => {
		const { rig, pointer, frameDocument, tiles } = createSurfaces();
		const close = frameDocument.createElement("button");
		const tile = document.createElement("button");
		const clicked = vi.fn();

		close.setAttribute("aria-label", "Close window");
		tile.setAttribute("aria-label", "Open dump.txt");
		tile.addEventListener("click", clicked);
		frameDocument.body.append(place(close, rectOf(40, 20, 40, 20)));
		tiles.append(place(tile, rectOf(500, 600, 52, 52)));

		const moving = rig.move('[aria-label="Close window"]');

		await vi.advanceTimersByTimeAsync(500);
		await moving;

		expect(pointer.style.transform).toBe("translate(230px, 165px)");

		const clicking = rig.click('[aria-label="Open dump.txt"]');

		await vi.advanceTimersByTimeAsync(1000);
		await clicking;

		expect(pointer.style.transform).toBe("translate(426px, 576px)");
		expect(clicked).toHaveBeenCalledOnce();
	});

	it("wheels a target in its own document at its mapped centre", async () => {
		const { rig, pointer, frameDocument, frameView } = createSurfaces();
		const scroller = frameDocument.createElement("div");
		const received: Array<{ readonly deltaY: number; readonly framed: boolean }> = [];

		scroller.className = "cm-scroller";
		scroller.addEventListener("wheel", (event) => {
			received.push({ deltaY: event.deltaY, framed: event instanceof frameView.WheelEvent });
		});
		frameDocument.body.append(place(scroller, rectOf(0, 100, 400, 200)));

		const wheeling = rig.wheel(360);

		await vi.advanceTimersByTimeAsync(1100);
		await wheeling;

		expect(pointer.style.transform).toBe("translate(300px, 250px)");
		expect(received).toEqual([{ deltaY: 360, framed: true }]);
	});

	it("selects text between the mapped edges of its range", async () => {
		const { rig, pointer, frameDocument, frameView, editor, selections } = createSurfaces();
		const content = frameDocument.createElement("div");

		content.className = "cm-content";
		content.textContent = "Dump text, think less.";
		frameDocument.body.append(content);
		Object.defineProperty(frameView.Range.prototype, "getBoundingClientRect", {
			configurable: true,
			value: () => rectOf(80, 40, 60, 20),
		});

		const selecting = rig.select("think");

		await vi.advanceTimersByTimeAsync(2000);
		await selecting;

		expect(selections).toEqual(["translate(240px, 175px)"]);
		expect(editor.select).toHaveBeenCalledWith([{ anchor: 11, head: 16 }]);
		expect(pointer.style.transform).toBe("translate(270px, 175px)");
	});

	it("sends a key to the focused element of the first surface that holds one", async () => {
		const { rig, frameDocument, tiles } = createSurfaces();
		const content = frameDocument.createElement("div");
		const field = frameDocument.createElement("input");
		const tile = document.createElement("button");

		content.className = "cm-content";
		frameDocument.body.append(content, field);
		tiles.append(tile);

		const received = recordKeys(content, field, tile);

		tile.focus();

		const keyingTile = rig.key("a");

		await vi.advanceTimersByTimeAsync(350);
		await keyingTile;
		field.focus();
		tile.focus();

		const keyingField = rig.key("b");

		await vi.advanceTimersByTimeAsync(350);
		await keyingField;

		expect(received).toEqual([
			{ target: tile, key: "a", ctrlKey: false },
			{ target: field, key: "b", ctrlKey: false },
		]);
	});

	it("sends a key to the editor content in its own document while no surface holds focus", async () => {
		const { rig, frameDocument, frameView } = createSurfaces();
		const content = frameDocument.createElement("div");
		const download = document.createElement("a");
		const received: Array<{ readonly key: string; readonly framed: boolean }> = [];

		content.className = "cm-content";
		content.addEventListener("keydown", (event) => {
			received.push({ key: event.key, framed: event instanceof frameView.KeyboardEvent });
		});
		frameDocument.body.append(content);
		download.href = "#download";
		document.body.prepend(download);
		download.focus();

		const keying = rig.key("z", { ctrlKey: true });

		await vi.advanceTimersByTimeAsync(350);
		await keying;

		expect(frameDocument.activeElement).toBe(frameDocument.body);
		expect(received).toEqual([{ key: "z", framed: true }]);
	});

	it("sends a key to the editor content while focus rests in a surface that takes no keys", async () => {
		const { rig, frameDocument, tiles } = createSurfaces(false);
		const content = frameDocument.createElement("div");
		const tile = document.createElement("button");

		content.className = "cm-content";
		frameDocument.body.append(content);
		tiles.append(tile);

		const received = recordKeys(content, tile);

		tile.focus();

		const keying = rig.key("f", { ctrlKey: true });

		await vi.advanceTimersByTimeAsync(350);
		await keying;

		expect(document.activeElement).toBe(tile);
		expect(received).toEqual([{ target: content, key: "f", ctrlKey: true }]);
	});

	it("holds a pending wait while paused and finishes it with its remaining time after resume", async () => {
		const { rig } = createRig();
		const finished = vi.fn();

		void rig.wait(1000).then(finished);
		await vi.advanceTimersByTimeAsync(400);
		rig.pause();
		await vi.advanceTimersByTimeAsync(5000);

		expect(finished).not.toHaveBeenCalled();

		rig.resume();
		await vi.advanceTimersByTimeAsync(599);

		expect(finished).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);

		expect(finished).toHaveBeenCalledOnce();
	});

	it("starts a wait requested while paused only once resumed", async () => {
		const { rig } = createRig();
		const finished = vi.fn();

		rig.pause();
		void rig.wait(300).then(finished);
		await vi.advanceTimersByTimeAsync(1000);

		expect(finished).not.toHaveBeenCalled();

		rig.resume();
		await vi.advanceTimersByTimeAsync(300);

		expect(finished).toHaveBeenCalledOnce();
	});

	it("holds the pointer while paused and finishes its move with the remaining time after resume", async () => {
		const { rig, stage } = createRig();
		const pointer = stage.firstElementChild;

		if (!(pointer instanceof HTMLElement)) throw new Error("The pointer is missing.");

		const moving = rig.move({ x: 100, y: 0 }, 1000);

		await vi.advanceTimersByTimeAsync(500);
		rig.pause();

		const held = pointer.style.transform;

		await vi.advanceTimersByTimeAsync(3000);

		expect(pointer.style.transform).toBe(held);
		expect(held).not.toBe("translate(0px, 0px)");

		rig.resume();
		await vi.advanceTimersByTimeAsync(400);

		expect(pointer.style.transform).not.toBe("translate(100px, 0px)");

		await vi.advanceTimersByTimeAsync(200);
		await moving;

		expect(pointer.style.transform).toBe("translate(100px, 0px)");
	});

	it("rejects a paused wait and a paused move when stopped", async () => {
		const { rig } = createRig();

		rig.pause();

		const waiting = expect(rig.wait(100)).rejects.toBeInstanceOf(DemoStopped);
		const moving = expect(rig.move({ x: 10, y: 10 })).rejects.toBeInstanceOf(DemoStopped);

		await vi.advanceTimersByTimeAsync(100);
		rig.stop();

		await waiting;
		await moving;
	});
});
