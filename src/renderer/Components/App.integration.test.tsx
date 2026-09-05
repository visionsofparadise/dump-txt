import { createHash, webcrypto } from "node:crypto";
import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { AppState } from "../models/AppState";
import type { Main } from "../models/Main";

let main: Main;
vi.mock("../models/Main", () => ({ createMain: () => main }));

function hash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function fixture(text = "first\n\f\nsecond\n\f\nthird") {
	const files = new Map([["/app/dump.txt", new TextEncoder().encode(text)]]);
	const closed = vi.fn();
	main = {
		getPaths: async () => ({ userData: "/app", restoredFilePath: null }),
		readFile: async (path) => {
			const bytes = files.get(path);
			return bytes ? { bytes, hash: hash(bytes) } : null;
		},
		writeFile: async (request) => {
			const previous = files.get(request.path);
			if ((previous ? hash(previous) : null) !== request.expectedHash) throw new Error("Unexpected write hash.");
			files.set(request.path, new Uint8Array(request.bytes));
			return { hash: hash(request.bytes) };
		},
		showOpenDialog: vi.fn(async () => null),
		showSaveDialog: vi.fn(async () => null),
		minimize: vi.fn(async () => undefined),
		toggleMaximize: vi.fn(async () => undefined),
		finishClose: async () => {
			closed();
		},
		events: { on: () => () => undefined },
	};
	const rendered = render(<App />);
	await waitFor(() => expect(rendered.container.querySelector(".cm-editor")).not.toBeNull());
	const editor = () => EditorView.findFromDOM(rendered.container.querySelector<HTMLElement>(".cm-editor")!)!;
	const insert = async (value: string) => {
		await act(async () => {
			const view = editor();
			view.dispatch({
				changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: value },
				selection: EditorSelection.cursor(view.state.selection.main.from + value.length),
				annotations: Transaction.userEvent.of("input.type"),
			});
		});
	};
	return { ...rendered, editor, insert, files, closed, user: userEvent.setup() };
}

function press(key: string, options: KeyboardEventInit = {}) {
	fireEvent.keyDown(document.activeElement ?? document.body, { key, bubbles: true, ...options });
}

beforeEach(() => {
	vi.stubGlobal("crypto", webcrypto);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	);
	Object.defineProperties(Range.prototype, {
		getClientRects: { configurable: true, value: () => [] },
		getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("scratchpad interface", () => {
	it("substitutes insertion at ends and keeps middle-page controls reachable", async () => {
		const { user } = await fixture();
		expect(screen.getByRole("button", { name: "First page" }).hasAttribute("disabled")).toBe(true);
		expect(screen.queryByRole("button", { name: "Previous page" })).toBeNull();
		expect(screen.getAllByRole("button", { name: "Insert page above" })).toHaveLength(1);
		await user.click(screen.getByRole("button", { name: "Next page" }));
		expect(screen.getByRole("status", { name: "Page 2 of 3" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Previous page" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Insert page above" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Insert page below" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Last page" }));
		expect(screen.getByRole("button", { name: "Last page" }).hasAttribute("disabled")).toBe(true);
		expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
	});

	it("keeps one blank page after deletion and restores text with global undo", async () => {
		const { user, editor } = await fixture("keep me");
		await user.click(screen.getByRole("button", { name: "Delete page" }));
		expect(editor().state.doc.toString()).toBe("");
		expect(screen.getByRole("status", { name: "Page 1 of 1" })).toBeTruthy();
		press("z", { ctrlKey: true });
		await waitFor(() => expect(editor().state.doc.toString()).toBe("keep me"));
	});

	it("accepts immediate typing through rapid page navigation and restores each cursor", async () => {
		const { editor, insert } = await fixture();
		await insert("A");
		press("ArrowDown", { altKey: true });
		await insert("B");
		press("ArrowDown", { altKey: true });
		await insert("C");
		press("ArrowUp", { altKey: true });
		await waitFor(() => expect(editor().state.doc.toString()).toBe("Bsecond"));
		expect(editor().state.selection.main.head).toBe(1);
		press("Home", { altKey: true });
		await waitFor(() => expect(editor().state.doc.toString()).toBe("Afirst"));
		expect(editor().state.selection.main.head).toBe(1);
	});

	it("flushes accepted text before the native close action", async () => {
		const { insert, closed, files } = await fixture("");
		await insert("durable");
		press("w", { ctrlKey: true });
		await waitFor(() => expect(closed).toHaveBeenCalledOnce());
		expect(new TextDecoder().decode(files.get("/app/dump.txt"))).toBe("durable");
	});

	it("routes page shortcuts ahead of CodeMirror text key bindings", async () => {
		const { editor, insert } = await fixture("base");
		press("Enter", { ctrlKey: true, shiftKey: true });
		await waitFor(() => expect(screen.getByRole("status", { name: "Page 2 of 2" })).toBeTruthy());
		await insert("below");
		press("Enter", { ctrlKey: true, altKey: true });
		await waitFor(() => expect(screen.getByRole("status", { name: "Page 2 of 3" })).toBeTruthy());
		await insert("middle");
		press("Delete", { ctrlKey: true, shiftKey: true });
		await waitFor(() => expect(screen.getByRole("status", { name: "Page 2 of 2" })).toBeTruthy());
		expect(editor().state.doc.toString()).toBe("below");
	});

	it("locks an already-open menu while Open waits for candidate bytes", async () => {
		const { user, insert, editor, files } = await fixture("base");
		await insert("accepted");
		await user.click(screen.getByRole("button", { name: "App menu" }));
		const undo = await screen.findByRole("menuitem", { name: /Undo/u });
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		let readingCandidate = false;
		const read = main.readFile;
		main.showOpenDialog = async () => ({ path: "/app/other.txt", hash: null });
		main.readFile = async (path) => {
			if (path !== "/app/other.txt") return read(path);
			readingCandidate = true;
			await pending;
			const bytes = new TextEncoder().encode("candidate");
			return { bytes, hash: hash(bytes) };
		};
		press("o", { ctrlKey: true });
		await waitFor(() => expect(readingCandidate).toBe(true));
		fireEvent.click(undo);
		expect(editor().state.doc.toString()).toBe("acceptedbase");
		release();
		await waitFor(() => expect(editor().state.doc.toString()).toBe("candidate"));
		expect(new TextDecoder().decode(files.get("/app/dump.txt"))).toBe("acceptedbase");
	});

	it("returns editor focus after closing find and keeps its occurrence panel contextual", async () => {
		const { editor, user } = await fixture("cat cat");
		press("d", { ctrlKey: true });
		await screen.findByRole("dialog", { name: "Multiple selections" });
		press("f", { ctrlKey: true });
		const panel = await screen.findByRole("dialog", { name: "Find and replace" });
		expect(screen.queryByRole("dialog", { name: "Multiple selections" })).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Find text" }));
		await user.click(within(panel).getByRole("button", { name: "Close find" }));
		expect(document.activeElement).toBe(editor().contentDOM);
	});

	it("continues selecting after a pointer changes occurrence scope", async () => {
		const { user } = await fixture("cat\n\f\ncat");
		press("d", { ctrlKey: true });
		const panel = await screen.findByRole("dialog", { name: "Multiple selections" });
		await user.click(within(panel).getByRole("checkbox", { name: "All pages" }));
		press("d", { ctrlKey: true });
		await waitFor(() => expect(within(panel).getByText("2 selections · 2 pages")).toBeTruthy());
	});

	it("keeps file actions in the menu and persists appearance from its radio items", async () => {
		const { user, files } = await fixture();
		expect(screen.queryByRole("menuitem", { name: /Open/u })).toBeNull();
		await user.click(screen.getByRole("button", { name: "App menu" }));
		expect(await screen.findByRole("menuitem", { name: /Open…/u })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: /Save As…/u })).toBeTruthy();
		await user.click(screen.getByRole("menuitem", { name: /Appearance/u }));
		const dark = await screen.findByRole("menuitemradio", { name: "Dark" });
		dark.focus();
		await user.keyboard("{Enter}");
		await waitFor(() => {
			const settings = JSON.parse(new TextDecoder().decode(files.get("/app/app-state.json"))) as AppState;
			expect(settings.appearance.theme).toBe("dark");
		});
	});
});
