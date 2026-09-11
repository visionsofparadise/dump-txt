import { appStateSchema, contentHashOf } from "@dump-txt/ui/host";
import { describe, expect, it, vi } from "vitest";
import { MemoryMain } from "./MemoryMain";
import type { MainCapabilities } from "@dump-txt/ui/host";

describe("MemoryMain", () => {
	it("initializes a valid profile and keeps text between mounts", async () => {
		const main = new MemoryMain({ text: "First page\fSecond page" });
		const paths = await main.getPaths();
		const state = appStateSchema.parse(JSON.parse(new TextDecoder().decode(paths.startupSettings?.bytes)));
		const file = await main.readFile(state.activePath);

		expect(state.appearance).toEqual({ theme: "dark", font: "Consolas", textSize: 11, showStatusBar: true });
		expect(new TextDecoder().decode(file?.bytes)).toBe("First page\fSecond page");
		expect(file?.hash).toBe(await contentHashOf(file!.bytes));
		expect(await main.readFile("/missing.txt")).toBeNull();
	});

	it("serializes competing writes and continues after a conflict", async () => {
		const main = new MemoryMain();
		const encoder = new TextEncoder();
		const original = await main.readFile("/memory/dump.txt");
		const first = main.writeFile({
			path: "/memory/dump.txt",
			bytes: encoder.encode("first"),
			expectedHash: original!.hash,
		});
		const second = main.writeFile({
			path: "/memory/dump.txt",
			bytes: encoder.encode("second"),
			expectedHash: original!.hash,
		});

		await expect(second).rejects.toMatchObject({ code: "conflict" });

		const result = await first;

		await main.writeFile({ path: "/memory/dump.txt", bytes: encoder.encode("third"), expectedHash: result.hash });

		expect(new TextDecoder().decode((await main.readFile("/memory/dump.txt"))?.bytes)).toBe("third");
	});

	it("copies buffers and enforces missing file hashes", async () => {
		const main = new MemoryMain();
		const bytes = new TextEncoder().encode("original");
		const write = main.writeFile({ path: "/new.txt", bytes, expectedHash: null });

		bytes.fill(0);

		await write;

		const read = await main.readFile("/new.txt");

		read!.bytes.fill(0);

		expect(new TextDecoder().decode((await main.readFile("/new.txt"))?.bytes)).toBe("original");

		await expect(main.writeFile({ path: "/absent.txt", bytes, expectedHash: "stale" })).rejects.toMatchObject({
			code: "missing",
		});
	});

	it("uses instance-local clipboard and typed detachable events", async () => {
		const main = new MemoryMain();
		const other = new MemoryMain();
		const listener = vi.fn();
		const unsubscribe = main.events.on("maximizedChanged", listener);

		await main.writeClipboard("copied text");
		await main.toggleMaximize();

		expect(await main.readClipboard()).toBe("copied text");
		expect(await other.readClipboard()).toBe("");
		expect(listener).toHaveBeenCalledWith(true);

		unsubscribe();

		await main.toggleMaximize();

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("waits for pending writes before telling the host to close", async () => {
		const onClose = vi.fn();
		const main = new MemoryMain({ onClose });
		const bytes = new TextEncoder().encode("saved");
		const write = main.writeFile({ path: "/saved.txt", bytes, expectedHash: null });

		await main.finishClose();
		await write;

		expect(onClose).toHaveBeenCalledOnce();
		expect(new TextDecoder().decode((await main.readFile("/saved.txt"))?.bytes)).toBe("saved");
	});

	it("carries the status bar visibility into the startup settings", async () => {
		const main = new MemoryMain({ showStatusBar: false });
		const paths = await main.getPaths();
		const state = appStateSchema.parse(JSON.parse(new TextDecoder().decode(paths.startupSettings?.bytes)));

		expect(state.appearance.showStatusBar).toBe(false);
	});

	it("exposes constructed capabilities and leaves them undefined otherwise", () => {
		const capabilities: MainCapabilities = {
			openDump: false,
			saveAs: false,
			importPage: true,
			exportPage: true,
			fonts: false,
			minimize: false,
			maximize: false,
			close: false,
		};
		const restricted = new MemoryMain({ capabilities });
		const unrestricted = new MemoryMain();

		expect(restricted.capabilities).toBe(capabilities);
		expect(unrestricted.capabilities).toBeUndefined();
	});
});
