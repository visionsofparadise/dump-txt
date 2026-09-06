import { EventEmitter } from "node:events";
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShowTextContextMenuMainIpc } from "./Main";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";

const native = vi.hoisted(() => ({ popup: vi.fn() }));
vi.mock("electron", () => ({ Menu: { buildFromTemplate: vi.fn(() => native) } }));
const state = { canUndo: true, canRedo: false, hasSelection: true, locked: false };

function fixture() {
	const window = Object.assign(new EventEmitter(), { isDestroyed: () => false });
	const dependencies: IpcHandlerDependencies = {
		browserWindow: window as unknown as BrowserWindow,
		userData: "",
		restoredFilePath: null,
		grants: new Set(),
		finishClose: () => undefined,
	};
	const handler = new ShowTextContextMenuMainIpc();
	return { window, dependencies, handler };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("native text menu", () => {
	it("validates menu input before constructing a native menu", async () => {
		const { handler, dependencies } = fixture();
		expect(await handler.execute([{ ...state, locked: "false" }], dependencies)).toMatchObject({ ok: false });
		expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
	});

	it("uses explicit editing intents and resolves history once before menu close", async () => {
		const { handler, dependencies, window } = fixture();
		const result = handler.execute([state], dependencies);
		const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]![0];
		expect(template.map((item) => item.role ?? item.label ?? item.type)).toEqual([
			"Undo",
			"Redo",
			"separator",
			"Cut",
			"Copy",
			"Paste",
			"Delete",
			"separator",
			"Select All",
		]);
		expect(template[0]?.enabled).toBe(true);
		expect(template[1]?.enabled).toBe(false);
		const undo = template[0] as MenuItemConstructorOptions;
		Reflect.apply(undo.click!, undefined, []);
		native.popup.mock.calls[0]![0].callback();
		expect(await result).toEqual({ ok: true, value: "undo" });
		expect(window.listenerCount("closed")).toBe(0);
	});

	it.each([
		[3, "cut"],
		[4, "copy"],
		[5, "paste"],
		[6, "delete"],
		[8, "selectAll"],
	] as const)("returns menu item %s as %s without native editing roles", async (index, intent) => {
		const { handler, dependencies, window } = fixture();
		const result = handler.execute([state], dependencies);
		const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]![0];
		const item = template[index]!;

		expect(item.role).toBeUndefined();
		Reflect.apply(item.click!, undefined, []);
		native.popup.mock.calls[0]![0].callback();
		window.emit("closed");
		expect(await result).toEqual({ ok: true, value: intent });
		expect(window.listenerCount("closed")).toBe(0);
	});

	it("disables mutation for locked input while retaining copy and cancellation", async () => {
		const { handler, dependencies } = fixture();
		const result = handler.execute([{ ...state, locked: true }], dependencies);
		const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]![0];
		for (const index of [0, 1, 3, 5, 6]) expect(template[index]?.enabled).toBe(false);
		expect(template[4]?.enabled).toBe(true);
		native.popup.mock.calls[0]![0].callback();
		expect(await result).toEqual({ ok: true, value: null });
	});

	it("resolves a closing window as cancellation and releases its listener", async () => {
		const { handler, dependencies, window } = fixture();
		const result = handler.execute([state], dependencies);
		window.emit("closed");
		expect(await result).toEqual({ ok: true, value: null });
		expect(window.listenerCount("closed")).toBe(0);
	});
});
