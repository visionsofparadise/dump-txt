// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "events";
import { dialog, type BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import writeFileAtomic from "write-file-atomic";
import { wireWindow } from "../../../../main/wireWindow";
import { MainEvents } from "../../../../renderer/models/MainEvents";
import type { Main } from "../../../../renderer/models/Main";
import type { IpcHandlerDependencies } from "../../../models/IpcHandlerDependencies";
import { ShowOpenDialogMainIpc } from "../../Dialog/showOpenDialog/Main";
import { ShowSaveDialogMainIpc } from "../../Dialog/showSaveDialog/Main";
import { ReadFileMainIpc } from "../readFile/Main";
import { ReadFileRendererIpc } from "../readFile/Renderer";
import { WriteFileMainIpc } from "./Main";

vi.mock("electron", () => ({ dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() } }));
vi.mock("write-file-atomic", async (importOriginal) => {
	const actual = await importOriginal<{ default: typeof writeFileAtomic }>();
	return { default: vi.fn(actual.default) };
});

let directory: string;
let dependencies: IpcHandlerDependencies;
const scratch = path.resolve(".scratch");
const reader = new ReadFileMainIpc();
const writer = new WriteFileMainIpc();
const bytesOf = (text: string) => new TextEncoder().encode(text);

beforeEach(async () => {
	await mkdir(scratch, { recursive: true });
	directory = await mkdtemp(path.join(scratch, "dump-write-"));
	dependencies = {
		userData: directory,
		restoredFilePath: null,
		grants: new Set(),
		browserWindow: {} as BrowserWindow,
		finishClose: () => undefined,
	};
});
afterEach(async () => {
	vi.restoreAllMocks();
	if (directory.startsWith(scratch + path.sep)) await rm(directory, { recursive: true, force: true });
});

describe("native byte capabilities", () => {
	it("creates only absent files and atomically overwrites the observed hash", async () => {
		const filePath = path.join(directory, "dump.txt");
		expect(await reader.handler(filePath, dependencies)).toBeNull();
		const initial = await writer.handler(
			{ path: filePath, bytes: bytesOf("before"), expectedHash: null },
			dependencies,
		);
		expect(initial.hash).toBe(createHash("sha256").update("before").digest("hex"));
		await expect(
			writer.handler({ path: filePath, bytes: bytesOf("wrong"), expectedHash: null }, dependencies),
		).rejects.toMatchObject({ code: "conflict" });
		await writer.handler({ path: filePath, bytes: bytesOf("after"), expectedHash: initial.hash }, dependencies);
		expect(await readFile(filePath, "utf8")).toBe("after");
	});

	it("preserves an external change when the supplied hash is stale", async () => {
		const filePath = path.join(directory, "dump.txt");
		const first = await writer.handler({ path: filePath, bytes: bytesOf("first"), expectedHash: null }, dependencies);
		await writeFile(filePath, "external");
		await expect(
			writer.handler({ path: filePath, bytes: bytesOf("mine"), expectedHash: first.hash }, dependencies),
		).rejects.toMatchObject({ code: "conflict" });
		expect(await readFile(filePath, "utf8")).toBe("external");
	});

	it("returns typed missing-file and malformed-payload errors", async () => {
		const filePath = path.join(directory, "missing.txt");
		expect(
			await writer.execute([{ path: filePath, bytes: bytesOf("text"), expectedHash: "a".repeat(64) }], dependencies),
		).toMatchObject({ ok: false, error: { code: "missing" } });
		expect(
			await writer.execute([{ path: filePath, bytes: "wrong", expectedHash: null }], dependencies),
		).toMatchObject({ ok: false, error: { code: "invalid" } });
		expect(await reader.execute(["relative.txt"], dependencies)).toMatchObject({
			ok: false,
			error: { code: "invalid" },
		});
	});

	it("leaves the previous bytes intact when atomic replacement fails", async () => {
		const filePath = path.join(directory, "dump.txt");
		const initial = await writer.handler(
			{ path: filePath, bytes: bytesOf("original"), expectedHash: null },
			dependencies,
		);
		vi.mocked(writeFileAtomic).mockRejectedValueOnce(Object.assign(new Error("Access denied"), { code: "EACCES" }));
		expect(
			await writer.execute(
				[{ path: filePath, bytes: bytesOf("replacement"), expectedHash: initial.hash }],
				dependencies,
			),
		).toMatchObject({ ok: false, error: { code: "permission" } });
		expect(await readFile(filePath, "utf8")).toBe("original");
	});

	it("transports plain envelopes and constructs typed errors in the renderer", async () => {
		const handler = new ReadFileRendererIpc();
		const [, invoke] = handler.register({
			invoke: (_channel, ...parameters) => reader.execute(parameters, dependencies),
		});
		const read = handler.connect(async (filePath) => structuredClone(await invoke(filePath)));
		const filePath = path.join(directory, "test.txt");
		await writeFile(filePath, "hello");
		expect(new TextDecoder().decode((await read(filePath))?.bytes)).toBe("hello");
		await expect(read("relative.txt")).rejects.toMatchObject({ name: "IpcError", code: "invalid" });
	});

	it("grants the native Open selection and accepts an omitted options tuple", async () => {
		const filePath = path.join(directory, "open.txt");
		await writeFile(filePath, "chosen");
		vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [filePath] });
		expect(await new ShowOpenDialogMainIpc().execute([], dependencies)).toMatchObject({
			ok: true,
			value: { path: filePath, hash: createHash("sha256").update("chosen").digest("hex") },
		});
		expect(dependencies.grants.size).toBe(1);
	});

	it("records the confirmed Save As destination hash and cancellation grants nothing", async () => {
		const filePath = path.join(directory, "save.txt");
		await writeFile(filePath, "chosen");
		vi.mocked(dialog.showSaveDialog)
			.mockResolvedValueOnce({ canceled: true, filePath: "" })
			.mockResolvedValueOnce({ canceled: false, filePath });
		const handler = new ShowSaveDialogMainIpc();
		expect(await handler.execute([], dependencies)).toEqual({ ok: true, value: null });
		expect(dependencies.grants.size).toBe(0);
		expect(await handler.execute([{ defaultPath: "dump.txt" }], dependencies)).toMatchObject({
			ok: true,
			value: { path: filePath, hash: createHash("sha256").update("chosen").digest("hex") },
		});
	});

	it("subscribes once per preload event and disposes every native subscription", () => {
		const native = new EventEmitter();
		const main: Main = {
			getPaths: async () => ({ userData: directory, restoredFilePath: null }),
			readFile: async () => null,
			writeFile: async () => ({ hash: "" }),
			showOpenDialog: async () => null,
			showSaveDialog: async () => null,
			showTextContextMenu: async () => null,
			setTitle: async () => undefined,
			minimize: async () => undefined,
			toggleMaximize: async () => undefined,
			finishClose: async () => undefined,
			events: {
				on: (channel, listener) => {
					native.on(channel, listener);
					return () => {
						native.off(channel, listener);
					};
				},
			},
		};
		const events = new MainEvents(main);
		const listener = vi.fn();
		events.on("closeRequested", listener);
		native.emit("closeRequested");
		expect(listener).toHaveBeenCalledTimes(1);
		expect(native.listenerCount("closeRequested")).toBe(1);
		events.dispose();
		expect(native.eventNames()).toEqual([]);
	});

	it("gates closing on renderer acknowledgement and removes per-window handlers", async () => {
		const handlers = new Map<string, (event: { senderFrame: object }, ...parameters: unknown[]) => unknown>();
		const mainFrame = {};
		const webContents = Object.assign(new EventEmitter(), {
			ipc: {
				handle: (action: string, listener: (event: { senderFrame: object }, ...parameters: unknown[]) => unknown) =>
					handlers.set(action, listener),
				removeHandler: (action: string) => handlers.delete(action),
			},
			mainFrame,
			send: vi.fn(),
			isDestroyed: () => false,
			setWindowOpenHandler: vi.fn(),
		});
		const close = vi.fn();
		const browserWindow = Object.assign(new EventEmitter(), {
			webContents,
			isDestroyed: () => false,
			isMinimized: () => false,
			isMaximized: () => false,
			getBounds: () => ({ x: 0, y: 0, width: 960, height: 640 }),
			close,
		});
		wireWindow(browserWindow as unknown as BrowserWindow, {
			userData: directory,
			restoredFilePath: null,
			grants: new Set<string>(),
		});
		const event = { preventDefault: vi.fn() };
		browserWindow.emit("close", event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(webContents.send).toHaveBeenCalledWith("closeRequested");
		expect(close).not.toHaveBeenCalled();
		expect(await handlers.get("getPaths")!({ senderFrame: {} })).toMatchObject({
			ok: false,
			error: { code: "permission" },
		});
		expect(await handlers.get("finishClose")!({ senderFrame: mainFrame })).toMatchObject({ ok: true });
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(close).toHaveBeenCalledOnce();
		const acknowledged = { preventDefault: vi.fn() };
		browserWindow.emit("close", acknowledged);
		expect(acknowledged.preventDefault).not.toHaveBeenCalled();
		browserWindow.emit("closed");
		expect(handlers.size).toBe(0);
		expect(browserWindow.listenerCount("resize")).toBe(0);
	});
});
