import { createHash, webcrypto } from "node:crypto";
import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullCapabilities } from "../models/MainCapabilities";
import { App } from "./App";
import type { AppState } from "../models/AppState";
import type { ChromeContext } from "../models/ChromeContext";
import type { Main } from "../models/Main";
import type { MainCapabilities } from "../models/MainCapabilities";
import type { MainEventMap } from "../models/MainEventMap";

let main: Main;

function hash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function fixture(
	text = "first\n\f\nsecond\n\f\nthird",
	platform: Main["platform"] = "windows",
	capabilities?: MainCapabilities,
	decorations?: Main["decorations"],
) {
	const files = new Map([["/app/dump.txt", new TextEncoder().encode(text)]]);
	const closed = vi.fn();
	const listeners: { [Channel in keyof MainEventMap]: Set<(...parameters: MainEventMap[Channel]) => void> } = {
		closeRequested: new Set(),
		windowBoundsChanged: new Set(),
		maximizedChanged: new Set(),
	};
	main = {
		platform,
		decorations,
		capabilities,
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
		setTheme: vi.fn(async () => undefined),
		showTextContextMenu: vi.fn(async () => null),
		getSystemFonts: vi.fn(async () => ["Arial", "Consolas"]),
		readClipboard: vi.fn(async () => ""),
		writeClipboard: vi.fn(async () => undefined),
		minimize: vi.fn(async () => undefined),
		toggleMaximize: vi.fn(async () => undefined),
		finishClose: async () => {
			closed();
		},
		events: {
			on: (channel, listener) => {
				listeners[channel].add(listener);

				return () => {
					listeners[channel].delete(listener);
				};
			},
		},
	};
	const adapter = main;
	const api = createRef<ChromeContext>();
	const rendered = render(<App main={adapter} ref={api} />);
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
	return { ...rendered, adapter, api, editor, insert, files, closed, listeners, user: userEvent.setup() };
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
	it("exposes editing, selection, navigation and menu actions through the mounted API", async () => {
		const { api, editor, container } = await fixture("one two\n\f\nnext");
		const context = api.current!;

		await act(async () => {
			context.editor.select([{ anchor: 0, head: 3 }]);
		});
		expect(editor().state.selection.main.from).toBe(0);
		expect(editor().state.selection.main.to).toBe(3);
		await act(async () => {
			context.editor.apply({ type: "insert", text: "changed" });
		});
		await waitFor(() => expect(editor().state.doc.toString()).toBe("changed two"));
		const nextPage = context.document.pages[1]!;

		await act(async () => {
			context.editor.showPage(nextPage.id);
		});
		await waitFor(() => expect(editor().state.doc.toString()).toBe("next"));
		expect(context.session.view.activePageId).toBe(nextPage.id);
		await act(async () => {
			context.chrome.menuOpen = true;
		});
		expect(await within(container).findByRole("menu")).toBeTruthy();
	});

	it("replaces the API with the opened document and clears it on unmount", async () => {
		const { api, adapter, editor, files, unmount } = await fixture("original");
		const previous = api.current!;
		files.set("/app/replacement.txt", new TextEncoder().encode("replacement"));
		adapter.showOpenDialog = async () => ({ path: "/app/replacement.txt", hash: null });

		await act(async () => {
			await previous.persistence.open();
		});
		await waitFor(() => expect(editor().state.doc.toString()).toBe("replacement"));
		expect(api.current).not.toBe(previous);
		expect(api.current?.document.pages[0]?.text).toBe("replacement");
		await act(async () => {
			api.current!.editor.apply({ type: "insert", text: "new " });
		});
		await waitFor(() => expect(editor().state.doc.toString()).toBe("new replacement"));
		expect(previous.document.pages[0]?.text).toBe("original");
		unmount();
		expect(api.current).toBeNull();
	});

	it("isolates embedded themes, shortcuts and dialog portals from the host and each other", async () => {
		const title = document.title;
		const theme = document.documentElement.dataset.theme;
		const first = await fixture("first");
		const second = await fixture("second");

		await act(async () => {
			first.api.current!.session.appearance = { ...first.api.current!.session.appearance, theme: "dark" };
			second.api.current!.session.appearance = { ...second.api.current!.session.appearance, theme: "light" };
		});
		await waitFor(() => expect(first.container.querySelector(".dump-ui")?.getAttribute("data-theme")).toBe("dark"));
		expect(second.container.querySelector(".dump-ui")?.getAttribute("data-theme")).toBe("light");
		fireEvent.keyDown(first.editor().contentDOM, { key: "n", ctrlKey: true });
		await waitFor(() => expect(first.api.current?.document.pages).toHaveLength(2));
		expect(second.api.current?.document.pages).toHaveLength(1);
		fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
		expect(first.api.current?.document.pages).toHaveLength(2);
		expect(second.api.current?.document.pages).toHaveLength(1);
		await act(async () => {
			first.api.current!.chrome.keybindsOpen = true;
		});
		const firstDialog = await within(first.container).findByRole("dialog", { name: "Keybinds" });

		expect(firstDialog.closest(".dump-ui")).toBe(first.container.querySelector(".dump-ui"));
		expect(within(second.container).queryByRole("dialog", { name: "Keybinds" })).toBeNull();
		await act(async () => {
			first.api.current!.chrome.keybindsOpen = false;
		});
		await waitFor(() => expect(within(first.container).queryByRole("dialog", { name: "Keybinds" })).toBeNull());
		await act(async () => {
			second.api.current!.chrome.keybindsOpen = true;
		});
		const secondDialog = await within(second.container).findByRole("dialog", { name: "Keybinds" });

		expect(secondDialog.closest(".dump-ui")).toBe(second.container.querySelector(".dump-ui"));
		expect(within(first.container).queryByRole("dialog", { name: "Keybinds" })).toBeNull();
		expect(document.title).toBe(title);
		expect(document.documentElement.dataset.theme).toBe(theme);
	});

	it.each(["windows", "macos", "linux"] as const)("places the menu and window controls for %s", async (platform) => {
		const { container, user } = await fixture(undefined, platform);
		const menu = screen.getByRole("button", { name: "App menu" });

		if (platform === "windows") {
			expect(screen.getByRole("button", { name: "Close window" })).toBeTruthy();
			expect(screen.getByRole("button", { name: "Minimize" })).toBeTruthy();
		} else {
			expect(screen.queryByRole("button", { name: "Close window" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
		}
		if (platform === "linux") {
			expect(container.querySelector(".title-bar")).toBeNull();
			expect(menu.previousElementSibling).toBe(screen.getByRole("button", { name: "Insert page above" }));
		} else {
			expect(menu.closest(".title-bar")?.getAttribute("data-platform")).toBe(platform);
			expect(container.querySelector(".app-name")?.textContent).toBe("dump.txt");
		}
		await waitFor(() => expect(main.setTitle).toHaveBeenLastCalledWith("dump.txt"));
		await user.click(menu);
		expect(await screen.findByRole("menuitem", { name: /^Close/u })).toBeTruthy();
	});

	it.each([
		["windows", ".window-controls", ["Minimize", "Maximize", "Close window"]],
		["macos", ".traffic-lights", ["Close window", "Minimize", "Maximize"]],
		["linux", ".header-bar-controls", ["Minimize", "Maximize", "Close window"]],
	] as const)(
		"draws window chrome for %s when the host has no native decorations",
		async (platform, selector, labels) => {
			const { container, insert, closed, files, listeners, user } = await fixture("", platform, undefined, "drawn");
			const titleBar = container.querySelector<HTMLElement>(".title-bar")!;
			const controls = titleBar.querySelector<HTMLElement>(selector)!;
			const menu = screen.getByRole("button", { name: "App menu" });
			const emitMaximized = async (maximized: boolean) => {
				await act(async () => {
					for (const listener of listeners.maximizedChanged) listener(maximized);
				});
			};

			expect(titleBar.getAttribute("data-platform")).toBe(platform);
			expect(container.querySelector(".dump-app")?.getAttribute("data-decorations")).toBe("drawn");
			expect(within(titleBar).getByText("dump.txt").className).toBe("app-name");
			expect(
				within(controls)
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label")),
			).toEqual(labels);
			if (platform === "linux")
				expect(menu.previousElementSibling).toBe(screen.getByRole("button", { name: "Insert page above" }));
			else expect(menu.closest(".title-menu")?.parentElement).toBe(titleBar);
			if (platform === "macos") expect(titleBar.firstElementChild).toBe(controls);
			await user.click(within(controls).getByRole("button", { name: "Minimize" }));
			expect(main.minimize).toHaveBeenCalledOnce();
			await user.click(within(controls).getByRole("button", { name: "Maximize" }));
			expect(main.toggleMaximize).toHaveBeenCalledOnce();
			await emitMaximized(true);
			expect(within(controls).getByRole("button", { name: "Restore window" }).title).toBe("Restore window");
			await emitMaximized(false);
			expect(within(controls).getByRole("button", { name: "Maximize" })).toBeTruthy();
			await insert("drawn close");
			await user.click(within(controls).getByRole("button", { name: "Close window" }));
			await waitFor(() => expect(closed).toHaveBeenCalledOnce());
			expect(new TextDecoder().decode(files.get("/app/dump.txt"))).toBe("drawn close");
		},
	);

	it.each(["macos", "linux"] as const)(
		"keeps %s chrome native when the host declares native decorations",
		async (platform) => {
			const { container } = await fixture(undefined, platform, undefined, "native");

			expect(container.querySelector(".dump-app")?.getAttribute("data-decorations")).toBe("native");
			expect(container.querySelector(".traffic-lights")).toBeNull();
			expect(container.querySelector(".header-bar-controls")).toBeNull();
			expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
			expect(container.querySelector(".title-bar") === null).toBe(platform === "linux");
		},
	);

	it.each([
		["macos", "minimize", "Minimize"],
		["macos", "maximize", "Maximize"],
		["macos", "close", "Close window"],
		["linux", "minimize", "Minimize"],
		["linux", "maximize", "Maximize"],
		["linux", "close", "Close window"],
	] as const)("disables only the drawn %s button whose %s capability is false", async (platform, capability, name) => {
		await fixture(undefined, platform, { ...fullCapabilities, [capability]: false }, "drawn");

		for (const label of ["Minimize", "Maximize", "Close window"])
			expect(screen.getByRole("button", { name: label }).hasAttribute("disabled")).toBe(label === name);
	});

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
		await waitFor(() => expect(counts()).toBe("2 selections · 8 chars · 2 words · 2 lines"));
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

	it("keeps menu dismissal out of the title drag gesture while retaining window controls", async () => {
		const { user, container } = await fixture();
		const title = container.querySelector<HTMLElement>(".app-name")!;
		const pointerDown = vi.fn<(event: Event) => void>();
		const mouseDown = vi.fn();

		title.addEventListener("pointerdown", pointerDown);
		title.addEventListener("mousedown", mouseDown);
		await user.click(screen.getByRole("button", { name: "App menu" }));
		expect(title.hasAttribute("data-tauri-drag-region")).toBe(false);
		await user.click(title);
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		expect(pointerDown.mock.calls[0]![0].defaultPrevented).toBe(true);
		expect(mouseDown).not.toHaveBeenCalled();
		expect(title.getAttribute("data-tauri-drag-region")).toBe("");
		await user.click(title);
		expect(pointerDown.mock.calls[1]![0].defaultPrevented).toBe(false);
		expect(mouseDown).toHaveBeenCalledOnce();
		await user.click(screen.getByRole("button", { name: "App menu" }));
		await user.click(screen.getByRole("button", { name: "Minimize" }));
		expect(main.minimize).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
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
		press("Home", { ctrlKey: true });
		await waitFor(() => expect(editor().state.doc.toString()).toBe("Afirst"));
		expect(editor().state.selection.main.head).toBe(1);
	});

	it("flushes accepted text before the native close action", async () => {
		const { insert, closed, files, user } = await fixture("");
		await insert("durable");
		await user.click(screen.getByRole("button", { name: "Close window" }));
		await waitFor(() => expect(closed).toHaveBeenCalledOnce());
		expect(new TextDecoder().decode(files.get("/app/dump.txt"))).toBe("durable");
	});

	it("routes page shortcuts ahead of CodeMirror text key bindings", async () => {
		const { editor, insert } = await fixture("base");
		press("n", { ctrlKey: true });
		await waitFor(() => expect(screen.getByRole("status", { name: "Page 2 of 2" })).toBeTruthy());
		await insert("below");
		press("n", { ctrlKey: true, shiftKey: true });
		await waitFor(() => expect(screen.getByRole("status", { name: "Page 2 of 3" })).toBeTruthy());
		await insert("middle");
		press("Delete", { ctrlKey: true });
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
		await waitFor(() => expect(screen.getByLabelText("Editor status").textContent).toContain("2 selections"));
		expect(screen.getByLabelText("Editor status").textContent).toContain("Pg 1");
		expect(screen.getByLabelText("Editor status").textContent).toContain("Pg 2");
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

	it("opens lazy keybinds and blocks editor shortcuts until dismissed", async () => {
		const { user, editor } = await fixture("base");
		await user.click(screen.getByRole("button", { name: "App menu" }));
		await user.click(await screen.findByRole("menuitem", { name: "Keybinds" }));
		await screen.findByRole("dialog", { name: "Keybinds" });
		press("n", { ctrlKey: true });
		expect(document.querySelector(".page-count")?.getAttribute("aria-label")).toBe("Page 1 of 1");
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keybinds" })).toBeNull());
		expect(document.activeElement).toBe(editor().contentDOM);
	});

	it.each([
		["macos", "Command"],
		["windows", "Ctrl"],
		["linux", "Ctrl"],
	] as const)(
		"shows the effective primary modifier on %s while retaining explicit Control bindings",
		async (platform, modifier) => {
			const { user } = await fixture("base", platform);
			await user.click(screen.getByRole("button", { name: "App menu" }));
			await user.click(await screen.findByRole("menuitem", { name: "Keybinds" }));
			const dialog = await screen.findByRole("dialog", { name: "Keybinds" });
			const keys = (label: string) => within(dialog).getByText(label).nextElementSibling?.textContent;
			expect(keys("New page below")).toBe(`${modifier}+N`);
			expect(keys("Open")).toBe(`${modifier}+O`);
			expect(keys("Undo")).toBe(`${modifier}+Z`);
			expect(keys("Redo")).toBe(`${modifier}+Y / ${modifier}+Shift+Z`);
			expect(keys("Select next occurrence")).toBe(`${modifier}+D`);
			expect(keys("Increase text size")).toBe(`${modifier}++`);
			expect(keys("Change text size")).toBe("Ctrl+Scroll");
			expect(keys("Unindent")).toBe("Ctrl+Tab");
		},
	);

	it.each([{ textSize: 18 }, { font: "Arial" }])(
		"invalidates editor geometry for appearance changes %j while retaining selections",
		async (appearance) => {
			const { api, editor } = await fixture("selected text");
			const view = editor();
			await act(async () => {
				api.current!.editor.select([{ anchor: 0, head: 8 }]);
			});
			const selection = view.state.selection;
			const theme = view.themeClasses;
			await act(async () => {
				api.current!.session.appearance = { ...api.current!.session.appearance, ...appearance };
			});
			await waitFor(() => expect(view.themeClasses).not.toBe(theme));
			expect(editor()).toBe(view);
			expect(view.state.selection.eq(selection)).toBe(true);
			expect(view.state.doc.toString()).toBe("selected text");
			expect(api.current!.history.canUndo).toBe(false);
		},
	);

	it("previews fonts in the modal and keeps text size controls open", async () => {
		Element.prototype.scrollIntoView = vi.fn();
		const { user, container } = await fixture();
		await user.click(screen.getByRole("button", { name: "App menu" }));
		await user.click(await screen.findByRole("menuitem", { name: /Font/u }));
		const dialog = await screen.findByRole("dialog", { name: "Font" }, { timeout: 5000 });
		const font = await within(dialog).findByRole("option", { name: "Arial" });
		await user.click(font);
		await waitFor(() =>
			expect(container.querySelector<HTMLElement>(".dump-app")?.style.getPropertyValue("--editor-font")).toBe(
				'"Arial", sans-serif',
			),
		);
		await user.click(screen.getByRole("button", { name: "Apply" }));
		await user.click(screen.getByRole("button", { name: "App menu" }));
		for (let count = 0; count < 3; count++)
			await user.click(screen.getByRole("menuitem", { name: "Increase text size" }));
		expect(screen.getByRole("menu")).toBeTruthy();
		await waitFor(() =>
			expect(container.querySelector<HTMLElement>(".dump-app")?.style.getPropertyValue("--editor-size")).toBe(
				"14pt",
			),
		);
	});

	it("retries native font failures and cancels a live font change", async () => {
		const { user, container } = await fixture();
		vi.mocked(main.getSystemFonts).mockRejectedValueOnce(new Error("Font service busy"));
		await user.click(screen.getByRole("button", { name: "App menu" }));
		await user.click(await screen.findByRole("menuitem", { name: /Font/u }));
		await screen.findByRole("alert");
		expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true);
		await user.click(screen.getByRole("button", { name: "Retry" }));
		await user.click(await screen.findByRole("option", { name: "Arial" }));
		await waitFor(() =>
			expect(container.querySelector<HTMLElement>(".dump-app")?.style.getPropertyValue("--editor-font")).toBe(
				'"Arial", sans-serif',
			),
		);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() =>
			expect(container.querySelector<HTMLElement>(".dump-app")?.style.getPropertyValue("--editor-font")).toBe(
				'"Consolas", monospace',
			),
		);
		expect(main.getSystemFonts).toHaveBeenCalledTimes(2);
	});

	it("ignores a font response from a dismissed modal after reopening", async () => {
		const { user } = await fixture();
		let complete!: (fonts: ReadonlyArray<string>) => void;
		vi.mocked(main.getSystemFonts).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const open = async () => {
			await user.click(screen.getByRole("button", { name: "App menu" }));
			await user.click(await screen.findByRole("menuitem", { name: /Font/u }));
			await screen.findByRole("dialog", { name: "Font" });
		};
		await open();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await open();
		await screen.findByRole("option", { name: "Arial" });
		await act(async () => {
			complete(["Stale family"]);
		});
		expect(screen.queryByRole("option", { name: "Stale family" })).toBeNull();
		expect(screen.getByRole("option", { name: "Arial" })).toBeTruthy();
	});

	it("disables every action a restricted host cannot honour", async () => {
		const capabilities: MainCapabilities = {
			openDump: false,
			saveAs: false,
			importPage: false,
			exportPage: false,
			fonts: false,
			minimize: false,
			maximize: false,
			close: false,
		};
		const { user, api, container } = await fixture(undefined, "windows", capabilities);

		await user.click(screen.getByRole("button", { name: "App menu" }));
		expect((await screen.findByRole("menuitem", { name: /Open…/u })).getAttribute("data-disabled")).toBe("");
		expect(screen.getByRole("menuitem", { name: /Save As…/u }).getAttribute("data-disabled")).toBe("");
		expect(screen.getByRole("menuitem", { name: /Import page…/u }).getAttribute("data-disabled")).toBe("");
		expect(screen.getByRole("menuitem", { name: /Export page…/u }).getAttribute("data-disabled")).toBe("");
		expect(screen.getByRole("menuitem", { name: /Font…/u }).getAttribute("data-disabled")).toBe("");
		expect(screen.getByRole("menuitem", { name: /^Close/u }).getAttribute("data-disabled")).toBe("");
		await user.keyboard("{Escape}");
		expect(screen.getByRole("button", { name: "Minimize" }).hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "Maximize" }).hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "Close window" }).hasAttribute("disabled")).toBe(true);
		const keydown = vi.fn<(event: KeyboardEvent) => void>();
		document.addEventListener("keydown", keydown);
		press("o", { ctrlKey: true });
		press("s", { ctrlKey: true, shiftKey: true });
		document.removeEventListener("keydown", keydown);
		expect(main.showOpenDialog).not.toHaveBeenCalled();
		expect(main.showSaveDialog).not.toHaveBeenCalled();
		expect(keydown.mock.calls[0]![0].defaultPrevented).toBe(false);
		expect(keydown.mock.calls[1]![0].defaultPrevented).toBe(false);
		await user.click(screen.getByRole("button", { name: "App menu" }));
		await user.click(await screen.findByRole("menuitem", { name: "Keybinds" }));
		await screen.findByRole("dialog", { name: "Keybinds" });
		expect(screen.queryByRole("region", { name: "File" })).toBeNull();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keybinds" })).toBeNull());
		await act(async () => {
			api.current!.persistence.state.error = "Disk write failed.";
		});
		await waitFor(() => expect(container.querySelector(".save-error")).not.toBeNull());
		const banner = container.querySelector<HTMLElement>(".save-error")!;
		expect(within(banner).getByRole("button", { name: "Save As…" }).hasAttribute("disabled")).toBe(true);
		expect(within(banner).getByRole("button", { name: "Open…" }).hasAttribute("disabled")).toBe(true);
	});

	it("leaves every action enabled when the host declares no capabilities", async () => {
		const { user } = await fixture();

		await user.click(screen.getByRole("button", { name: "App menu" }));
		expect((await screen.findByRole("menuitem", { name: /Open…/u })).getAttribute("data-disabled")).toBeNull();
		expect(screen.getByRole("menuitem", { name: /Save As…/u }).getAttribute("data-disabled")).toBeNull();
		expect(screen.getByRole("menuitem", { name: /Import page…/u }).getAttribute("data-disabled")).toBeNull();
		expect(screen.getByRole("menuitem", { name: /Export page…/u }).getAttribute("data-disabled")).toBeNull();
		expect(screen.getByRole("menuitem", { name: /Font…/u }).getAttribute("data-disabled")).toBeNull();
		expect(screen.getByRole("menuitem", { name: /^Close/u }).getAttribute("data-disabled")).toBeNull();
		await user.keyboard("{Escape}");
		expect(screen.getByRole("button", { name: "Minimize" }).hasAttribute("disabled")).toBe(false);
		expect(screen.getByRole("button", { name: "Maximize" }).hasAttribute("disabled")).toBe(false);
		expect(screen.getByRole("button", { name: "Close window" }).hasAttribute("disabled")).toBe(false);
		await user.click(screen.getByRole("button", { name: "App menu" }));
		await user.click(await screen.findByRole("menuitem", { name: "Keybinds" }));
		await screen.findByRole("dialog", { name: "Keybinds" });
		expect(screen.queryByRole("region", { name: "File" })).not.toBeNull();
	});
});
