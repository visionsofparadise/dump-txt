import { webcrypto } from "node:crypto";
import { createPlayback, type PlaybackOptions } from "@dump-txt/rig";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AppBox } from "./AppBox";
import type { ChromeContext } from "@dump-txt/ui";

vi.mock("@dump-txt/rig", async (importOriginal) => ({
	...(await importOriginal<typeof import("@dump-txt/rig")>()),
	createPlayback: vi.fn(),
	demonstrate: vi.fn(),
}));

interface StubPlayback {
	readonly options: PlaybackOptions;
	readonly finish: () => void;
	readonly fail: (error: Error) => void;
	readonly dispose: Mock<() => void>;
}

const nativeFocus = HTMLElement.prototype.focus;
const nativeSelect = HTMLInputElement.prototype.select;
const unmounts: Array<() => Promise<void>> = [];
let playbacks: Array<StubPlayback> = [];

async function settle(): Promise<void> {
	await act(async () => {
		if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
		else
			await new Promise((resolve) => {
				setTimeout(resolve, 10);
			});
	});
}

async function until<T>(read: () => T | null | undefined | false): Promise<T> {
	const deadline = Date.now() + 20_000;

	for (;;) {
		const value = read();

		if (value) return value;

		if (Date.now() > deadline) throw new Error("The condition was never met.");

		await settle();
	}
}

async function mount() {
	const container = document.createElement("div");
	const root = createRoot(container);

	document.body.append(container);
	await act(async () => {
		root.render(<AppBox platform="windows" />);
	});

	const content = await until(() => container.querySelector<HTMLElement>(".cm-content"));
	const unmount = async () => {
		const index = unmounts.indexOf(unmount);

		if (index >= 0) unmounts.splice(index, 1);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	};

	unmounts.push(unmount);

	const context = (): ChromeContext => {
		const current = playbacks[0]?.options.context();

		if (!current) throw new Error("The app context is not mounted.");

		return current;
	};
	const overlay = () => container.querySelector<HTMLButtonElement>(".appbox-takeover");

	return { container, content, context, overlay, unmount };
}

function pageTextOf(context: ChromeContext): string | undefined {
	return context.document.pages.find((page) => page.id === context.session.view.activePageId)?.text;
}

beforeEach(() => {
	playbacks = [];
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("crypto", webcrypto);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	);
	Object.defineProperties(Range.prototype, {
		getClientRects: { configurable: true, value: () => [] },
		getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
	});
	vi.mocked(createPlayback).mockImplementation((options) => {
		let finish!: () => void;
		let fail!: (error: Error) => void;
		const played = new Promise<void>((resolve, reject) => {
			finish = resolve;
			fail = reject;
		});
		const dispose = vi.fn<() => void>();

		playbacks.push({ options, finish, fail, dispose });

		return { ready: true, finished: false, error: null, play: () => played, stop: vi.fn(), dispose };
	});
});

afterEach(async () => {
	vi.useRealTimers();

	for (const unmount of [...unmounts]) await unmount();

	HTMLElement.prototype.focus = nativeFocus;
	HTMLInputElement.prototype.select = nativeSelect;
	document.body.replaceChildren();
	vi.mocked(createPlayback).mockReset();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("AppBox", { timeout: 30_000 }, () => {
	it("skips a focus call inside the stage while the visitor's focus is elsewhere on the page", async () => {
		const { content, context, overlay } = await mount();
		const download = document.createElement("a");
		const takeover = overlay();

		download.href = "#download";
		document.body.prepend(download);

		expect(document.activeElement).toBe(content);

		await act(async () => {
			download.focus();
			content.focus();
			context().editor.focus();
		});

		expect(document.activeElement).toBe(download);

		await act(async () => {
			takeover?.focus();
			context().editor.focus();
		});

		expect(document.activeElement).toBe(takeover);

		await act(async () => {
			takeover?.blur();
		});

		expect(document.activeElement).toBe(document.body);

		await act(async () => {
			context().editor.focus();
		});

		expect(document.activeElement).toBe(content);

		await act(async () => {
			download.focus();
		});

		expect(document.activeElement).toBe(download);
	});

	it("skips selecting an input inside the stage while the visitor's focus is elsewhere on the page", async () => {
		const { content } = await mount();
		const download = document.createElement("a");
		const field = document.createElement("input");

		download.href = "#download";
		document.body.prepend(download);
		field.value = "Friday";
		content.closest(".demo-stage")?.append(field);

		expect(field.selectionStart).toBe(6);

		download.focus();
		field.select();

		expect(field.selectionStart).toBe(6);
		expect(document.activeElement).toBe(download);

		download.blur();
		field.select();

		expect([field.selectionStart, field.selectionEnd]).toEqual([0, 6]);
	});

	it("restores the original focus method after a takeover and after unmount", async () => {
		const first = await mount();

		expect(HTMLElement.prototype.focus).not.toBe(nativeFocus);

		await act(async () => {
			first.overlay()?.click();
		});

		expect(HTMLElement.prototype.focus).toBe(nativeFocus);
		expect(HTMLInputElement.prototype.select).toBe(nativeSelect);
		expect(first.overlay()).toBeNull();

		const editor = await until(() => document.activeElement?.closest(".cm-editor"));

		expect(pageTextOf(first.context())).toBe("");
		expect(editor.closest(".demo-stage")).toBeNull();

		await first.unmount();

		expect(HTMLElement.prototype.focus).toBe(nativeFocus);

		const second = await mount();

		expect(HTMLElement.prototype.focus).not.toBe(nativeFocus);
		expect(HTMLInputElement.prototype.select).not.toBe(nativeSelect);

		await second.unmount();

		expect(HTMLElement.prototype.focus).toBe(nativeFocus);
		expect(HTMLInputElement.prototype.select).toBe(nativeSelect);
	});

	it("remounts a fresh host when a playback resolves", async () => {
		const { container, context } = await mount();
		const [first] = playbacks;
		const guard = HTMLElement.prototype.focus;
		const editor = container.querySelector(".cm-editor");
		const demonstrated = context();

		await act(async () => {
			demonstrated.editor.apply({ type: "insert", text: "demonstrated" });
		});
		await until(() => pageTextOf(demonstrated) === "demonstrated");
		await act(async () => {
			first?.finish();
		});

		const second = await until(() => playbacks[1]);
		const fresh = await until(() => {
			const current = second.options.context();

			return current !== demonstrated && current;
		});

		await until(() => {
			const current = container.querySelector(".cm-editor");

			return current !== editor && current;
		});

		expect(first?.dispose).toHaveBeenCalled();
		expect(pageTextOf(fresh)).toBe("");
		expect(HTMLElement.prototype.focus).toBe(guard);
		expect(createPlayback).toHaveBeenCalledTimes(2);
	});

	it.each<[string, (playback: StubPlayback) => void]>([
		["resolved", (playback) => playback.finish()],
		["failed", (playback) => playback.fail(new Error("Demo target is missing: .page-tab"))],
	])("keeps a takeover made while the restart after a %s playback is pending", async (outcome, settlePlayback) => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { container, context, overlay } = await mount();
		const [playback] = playbacks;

		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

		const pending = vi.getTimerCount();

		await act(async () => {
			if (playback) settlePlayback(playback);
		});

		expect(vi.getTimerCount()).toBeGreaterThan(pending);
		expect(error).toHaveBeenCalledTimes(outcome === "failed" ? 1 : 0);

		await act(async () => {
			overlay()?.click();
		});

		const editor = await until(() => document.activeElement?.closest(".cm-editor"));

		await act(async () => {
			context().editor.apply({ type: "insert", text: "kept" });
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		vi.useRealTimers();
		await settle();

		expect(container.querySelector(".cm-editor")).toBe(editor);
		expect(pageTextOf(context())).toBe("kept");
		expect(overlay()).toBeNull();
		expect(createPlayback).toHaveBeenCalledOnce();
	});
});
