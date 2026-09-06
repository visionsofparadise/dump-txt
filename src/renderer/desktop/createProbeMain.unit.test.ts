import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProbeMain } from "./createProbeMain";
import { probeText } from "./probeText";
import type { Main } from "../models/Main";

function fixture() {
	const forbidden = vi.fn(async (): Promise<never> => {
		throw new Error("Probe attempted production file access.");
	});
	const native: Main = {
		getPaths: forbidden,
		readFile: forbidden,
		writeFile: forbidden,
		showOpenDialog: forbidden,
		showSaveDialog: forbidden,
		minimize: vi.fn(async () => undefined),
		toggleMaximize: vi.fn(async () => undefined),
		setTitle: vi.fn(async () => undefined),
		finishClose: vi.fn(async () => undefined),
		showTextContextMenu: vi.fn(async () => null),
		getSystemFonts: vi.fn(async () => ["Consolas"]),
		readClipboard: vi.fn(async () => "clipboard"),
		writeClipboard: vi.fn(async () => undefined),
		events: { on: vi.fn(() => () => undefined) },
	};

	return { main: createProbeMain(native), native, forbidden };
}

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe("isolated probe files", () => {
	it("seeds deterministic fixture bytes and retains real desktop services", async () => {
		const { main, native, forbidden } = fixture();
		const file = await main.readFile("/fixture/dump.txt");

		expect(new TextDecoder().decode(file?.bytes)).toBe(probeText);
		expect(file?.hash).toBe(createHash("sha256").update(probeText).digest("hex"));
		expect(await main.getPaths()).toEqual({ userData: "/fixture", restoredFilePath: null, startupSettings: null });
		expect(await main.readFile("/fixture/missing.txt")).toBeNull();
		expect(await main.showOpenDialog()).toBeNull();
		expect(await main.showSaveDialog()).toBeNull();
		expect(main.finishClose).toBe(native.finishClose);
		expect(main.events).toBe(native.events);
		expect(main.showTextContextMenu).toBe(native.showTextContextMenu);
		expect(main.getSystemFonts).toBe(native.getSystemFonts);
		expect(main.readClipboard).toBe(native.readClipboard);
		expect(main.writeClipboard).toBe(native.writeClipboard);
		expect(forbidden).not.toHaveBeenCalled();
	});

	it.each([
		"/fixture-other/test",
		"/fixture/../secret",
		"/fixture/a/../../secret",
		"/fixture/a\\..\\secret",
		"C:/secret",
		"/fixture/./test",
		"/fixture/",
		"/fixture/a\0b",
	])("rejects reads and writes outside the fixture namespace: %s", async (path) => {
		const { main, forbidden } = fixture();

		await expect(main.readFile(path)).rejects.toMatchObject({ code: "permission" });
		await expect(main.writeFile({ path, bytes: new Uint8Array(), expectedHash: null })).rejects.toMatchObject({
			code: "permission",
		});
		expect(forbidden).not.toHaveBeenCalled();
	});

	it("clones accepted and returned bytes so later mutation cannot alter stored content", async () => {
		const { main } = fixture();
		const bytes = new Uint8Array([0, 128, 255]);
		const writing = main.writeFile({ path: "/fixture/binary", bytes, expectedHash: null });

		bytes.fill(7);
		await writing;

		const read = await main.readFile("/fixture/binary");

		expect(read?.bytes).toEqual(new Uint8Array([0, 128, 255]));
		read?.bytes.fill(9);
		expect((await main.readFile("/fixture/binary"))?.bytes).toEqual(new Uint8Array([0, 128, 255]));
	});

	it("serializes competing conditional writes and recovers the queue after rejection", async () => {
		const { main } = fixture();
		const path = "/fixture/dump.txt";
		const original = await main.readFile(path);
		const first = main.writeFile({ path, bytes: new TextEncoder().encode("first"), expectedHash: original!.hash });
		const second = main.writeFile({ path, bytes: new TextEncoder().encode("second"), expectedHash: original!.hash });
		const settled = await Promise.allSettled([first, second]);

		expect(settled[0]?.status).toBe("fulfilled");
		expect(settled[1]).toMatchObject({ status: "rejected", reason: { code: "conflict" } });
		expect(new TextDecoder().decode((await main.readFile(path))?.bytes)).toBe("first");
		await expect(
			main.writeFile({ path: "/fixture/new", bytes: new Uint8Array(), expectedHash: "old" }),
		).rejects.toMatchObject({ code: "missing" });
		await expect(
			main.writeFile({ path: "/fixture/new", bytes: new Uint8Array(), expectedHash: null }),
		).resolves.toHaveProperty("hash");
	});

	it("creates an independent in-memory profile for every probe instance", async () => {
		const first = fixture().main;
		const second = fixture().main;
		const previous = await first.readFile("/fixture/dump.txt");

		await first.writeFile({ path: "/fixture/dump.txt", bytes: new Uint8Array(), expectedHash: previous!.hash });
		expect(new TextDecoder().decode((await second.readFile("/fixture/dump.txt"))?.bytes)).toBe(probeText);
	});
});
