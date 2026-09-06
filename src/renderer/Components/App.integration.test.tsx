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
		setTitle: vi.fn(async () => undefined),
		showTextContextMenu: vi.fn(async () => null),
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
	it("updates status counts and positions for typing, selections, and page navigation", async () => {
		const { container, editor, insert, user } = await fixture("one two\nthree\n\f\nnext");
		const counts = () => container.querySelector(".status-counts")?.textContent;
		const position = () => container.querySelector(".status-position")?.textContent;

		expect(counts()).toBe("13 chars · 3 words · 2 lines");
		expect(position()).toBe("Ln 1, Col 1");
		await act(async () => {
			editor().dispatch({
				selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(8, 13)]),
			});
		});
		await waitFor(() => expect(counts()).toBe("8 chars · 2 words · 2 lines"));
		expect(position()).toBe("Ln 1, Col 1 – Ln 2, Col 6");
		await act(async () => {
			editor().dispatch({ selection: EditorSelection.cursor(0) });
		});
		await insert("a ");
		await waitFor(() => expect(counts()).toBe("15 chars · 4 words · 2 lines"));
		expect(position()).toBe("Ln 1, Col 3");
		await user.click(screen.getByRole("button", { name: "Next page" }));
		await waitFor(() => expect(counts()).toBe("4 chars · 1 words · 1 lines"));
		expect(within(screen.getByLabelText("Editor status")).getByLabelText("Page 2 of 2")).toBeTruthy();
		expect(container.querySelector(".page-bar-bottom .page-count")).toBeNull();
	});

	it("keeps insertion slots fixed and hides boundary navigation", async () => {
		const { user } = await fixture();
		const above = screen.getByRole("button", { name: "Insert page above" });
		const below = screen.getByRole("button", { name: "Insert page below" });
		expect(above.parentElement?.className).toBe("page-bar-leading");
		expect(below.parentElement?.className).toBe("page-bar-leading");
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
		expect(screen.getByRole("button", { name: "Insert page above" })).toBe(above);
		expect(screen.getByRole("button", { name: "Insert page below" })).toBe(below);
	});

	it("dismisses the app menu from the title and closes through autosave", async () => {
		const { user, insert, files, closed, container } = await fixture("");
		await insert("saved from menu");
		await user.click(screen.getByRole("button", { name: "App menu" }));
		expect(await screen.findByRole("menuitem", { name: /^Close/u })).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: /Delete page/u })).toBeNull();
		expect(container.querySelector(".title-bar-menu-open")).not.toBeNull();
		fireEvent.pointerDown(container.querySelector(".app-name")!);
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		expect(container.querySelector(".title-bar-menu-open")).toBeNull();
		await user.click(screen.getByRole("button", { name: "App menu" }));
		await user.click(await screen.findByRole("menuitem", { name: /^Close/u }));
		await waitFor(() => expect(closed).toHaveBeenCalledOnce());
		expect(new TextDecoder().decode(files.get("/app/dump.txt"))).toBe("saved from menu");
	});

	it("follows successful filenames while cancelled Save As retains the title", async () => {
		const { container, editor, files } = await fixture("original");
		await waitFor(() => expect(main.setTitle).toHaveBeenLastCalledWith("dump.txt"));
		press("s", { ctrlKey: true, shiftKey: true });
		await waitFor(() => expect(main.showSaveDialog).toHaveBeenCalledOnce());
		expect(container.querySelector(".app-name")?.textContent).toBe("dump.txt");
		main.showSaveDialog = async () => ({ path: "C:/notes/renamed.txt", hash: null });
		press("s", { ctrlKey: true, shiftKey: true });
		await waitFor(() => expect(main.setTitle).toHaveBeenLastCalledWith("renamed.txt"));
		expect(container.querySelector(".app-name")?.textContent).toBe("renamed.txt");
		files.set("C:/notes/opened.txt", new TextEncoder().encode("replacement"));
		main.showOpenDialog = async () => ({ path: "C:/notes/opened.txt", hash: null });
		press("o", { ctrlKey: true });
		await waitFor(() => expect(editor().state.doc.toString()).toBe("replacement"));
		expect(container.querySelector(".app-name")?.textContent).toBe("opened.txt");
		await waitFor(() => expect(main.setTitle).toHaveBeenLastCalledWith("opened.txt"));
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

	it("updates font and text size through the extracted submenus", async () => {
		const { user, container } = await fixture();
		await user.click(screen.getByRole("button", { name: "App menu" }));
		await user.click(await screen.findByRole("menuitem", { name: /Font/u }));
		const font = await screen.findByRole("menuitemradio", { name: "Arial" });
		font.focus();
		await user.keyboard("{Enter}");
		await waitFor(() =>
			expect(container.querySelector<HTMLElement>(".dump-app")?.style.getPropertyValue("--editor-font")).toBe(
				'"Arial", sans-serif',
			),
		);
		await user.click(screen.getByRole("button", { name: "App menu" }));
		await user.click(await screen.findByRole("menuitem", { name: /Text size/u }));
		const size = await screen.findByRole("menuitemradio", { name: "14 pt" });
		size.focus();
		await user.keyboard("{Enter}");
		await waitFor(() =>
			expect(container.querySelector<HTMLElement>(".dump-app")?.style.getPropertyValue("--editor-size")).toBe(
				"14pt",
			),
		);
	});
});
