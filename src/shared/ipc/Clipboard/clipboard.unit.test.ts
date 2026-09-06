import { clipboard, type BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReadClipboardMainIpc } from "./readText/Main";
import { ReadClipboardRendererIpc } from "./readText/Renderer";
import { WriteClipboardMainIpc } from "./writeText/Main";
import type { IpcHandlerDependencies } from "../../models/IpcHandlerDependencies";

vi.mock("electron", () => ({ clipboard: { readText: vi.fn(), writeText: vi.fn() } }));

const dependencies: IpcHandlerDependencies = {
	browserWindow: {} as BrowserWindow,
	userData: "/fixture",
	restoredFilePath: null,
	grants: new Set(),
	finishClose: () => undefined,
};

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(clipboard.writeText).mockResolvedValue(undefined);
});

describe("native clipboard bridge", () => {
	it("waits for the native write acknowledgement and transports failures", async () => {
		let reject!: (error: Error) => void;
		vi.mocked(clipboard.writeText).mockImplementation(
			() =>
				new Promise((_resolve, rejectWrite) => {
					reject = rejectWrite;
				}),
		);
		let completed = false;
		const result = new WriteClipboardMainIpc().execute(["text"], dependencies).then((value) => {
			completed = true;
			return value;
		});
		await Promise.resolve();
		expect(completed).toBe(false);
		reject(new Error("Clipboard busy"));
		await expect(result).resolves.toMatchObject({ ok: false, error: { code: "io", message: "Clipboard busy" } });
	});

	it("reads and writes text including Unicode, line endings and form feeds", async () => {
		const text = "中文 👩‍💻\r\n\f\nsecond";

		vi.mocked(clipboard.readText).mockResolvedValue(text);
		expect(await new ReadClipboardMainIpc().execute([], dependencies)).toEqual({ ok: true, value: text });
		expect(await new WriteClipboardMainIpc().execute([text], dependencies)).toEqual({ ok: true, value: undefined });
		expect(clipboard.writeText).toHaveBeenCalledWith(text);
	});

	it("rejects non-text writes before touching the clipboard", async () => {
		expect(await new WriteClipboardMainIpc().execute([42], dependencies)).toMatchObject({
			ok: false,
			error: { code: "invalid" },
		});
		expect(clipboard.writeText).not.toHaveBeenCalled();
	});

	it("carries native clipboard failures through the typed renderer error", async () => {
		vi.mocked(clipboard.readText).mockRejectedValue(new Error("Clipboard busy"));
		const native = new ReadClipboardMainIpc();
		const read = new ReadClipboardRendererIpc().connect(() => native.execute([], dependencies));

		await expect(read()).rejects.toMatchObject({ name: "IpcError", code: "io", message: "Clipboard busy" });
	});
});
