import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTauriMain } from "./createTauriMain";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

const listeners = new Map<string, (event: { payload: unknown }) => void>();
const unsubscribers: Array<ReturnType<typeof vi.fn>> = [];

beforeEach(() => {
	listeners.clear();
	unsubscribers.length = 0;
	native.invoke.mockReset();
	native.listen
		.mockReset()
		.mockImplementation(async (channel: string, listener: (event: { payload: unknown }) => void) => {
			listeners.set(channel, listener);
			const unsubscribe = vi.fn();

			unsubscribers.push(unsubscribe);
			return unsubscribe;
		});
});
afterEach(() => vi.restoreAllMocks());

describe("Tauri desktop boundary", () => {
	it("opens the native development inspector and removes its shortcut on disposal", async () => {
		const desktop = await createTauriMain();

		native.invoke.mockResolvedValue({ ok: true, value: null });
		for (const options of [
			{ key: "F12" },
			{ key: "I", ctrlKey: true, shiftKey: true },
			{ key: "i", metaKey: true, altKey: true },
		]) {
			const event = new KeyboardEvent("keydown", { ...options, cancelable: true });

			window.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(true);
		}
		expect(native.invoke).toHaveBeenCalledTimes(3);
		expect(native.invoke).toHaveBeenLastCalledWith("open_inspector", { request: {} });
		desktop.dispose();
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "F12" }));
		expect(native.invoke).toHaveBeenCalledTimes(3);
	});

	it("awaits all native subscriptions before exposing synchronous local events", async () => {
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const unsubscribe = vi.fn();

		native.listen.mockImplementationOnce(
			async (_channel: string, listener: (event: { payload: unknown }) => void) => {
				listeners.set("closeRequested", listener);
				await pending;
				return unsubscribe;
			},
		);
		let ready = false;
		const creating = createTauriMain().then((desktop) => {
			ready = true;
			return desktop;
		});

		await Promise.resolve();
		expect(ready).toBe(false);
		expect(native.listen).toHaveBeenCalledTimes(3);
		release();

		const desktop = await creating;
		const closed = vi.fn();
		const off = desktop.main.events.on("closeRequested", closed);

		listeners.get("closeRequested")?.({ payload: [] });
		expect(closed).toHaveBeenCalledOnce();
		off();
		listeners.get("closeRequested")?.({ payload: [] });
		expect(closed).toHaveBeenCalledOnce();
		desktop.dispose();
		desktop.dispose();
		expect(unsubscribe).toHaveBeenCalledOnce();
		for (const unlisten of unsubscribers) expect(unlisten).toHaveBeenCalledOnce();
	});

	it("cleans successful subscriptions when another registration fails", async () => {
		native.listen.mockRejectedValueOnce(new Error("listener unavailable"));
		await expect(createTauriMain()).rejects.toMatchObject({ code: "io", message: "listener unavailable" });
		for (const unlisten of unsubscribers) expect(unlisten).toHaveBeenCalledOnce();
	});

	it("validates native event tuples before notifying the editor", async () => {
		const desktop = await createTauriMain();
		const changed = vi.fn();
		const report = vi.spyOn(console, "error").mockImplementation(() => undefined);

		desktop.main.events.on("maximizedChanged", changed);
		listeners.get("maximizedChanged")?.({ payload: "true" });
		expect(changed).not.toHaveBeenCalled();
		expect(report).toHaveBeenCalledOnce();
		listeners.get("maximizedChanged")?.({ payload: [true] });
		expect(changed).toHaveBeenCalledWith(true);
		desktop.dispose();
		listeners.get("maximizedChanged")?.({ payload: [false] });
		expect(changed).toHaveBeenCalledOnce();
	});

	it("converts validated JSON bytes in file and startup settings envelopes", async () => {
		const desktop = await createTauriMain();
		native.invoke.mockResolvedValueOnce({ ok: true, value: { bytes: [0, 128, 255], hash: "hash" } });

		expect(await desktop.main.readFile("/fixture/test")).toEqual({
			bytes: new Uint8Array([0, 128, 255]),
			hash: "hash",
		});
		expect(native.invoke).toHaveBeenLastCalledWith("read_file", { request: { path: "/fixture/test" } });
		native.invoke.mockResolvedValueOnce({
			ok: true,
			value: {
				userData: "/profile",
				restoredFilePath: null,
				startupSettings: { bytes: [123, 125], hash: "settings" },
			},
		});
		expect((await desktop.main.getPaths()).startupSettings?.bytes).toEqual(new Uint8Array([123, 125]));
		desktop.dispose();
	});

	it.each([[256], [-1], [1.5], ["1"]])("rejects invalid byte values without coercion: %j", async (...bytes) => {
		const desktop = await createTauriMain();
		native.invoke.mockResolvedValueOnce({ ok: true, value: { bytes, hash: "hash" } });
		await expect(desktop.main.readFile("/test")).rejects.toMatchObject({ code: "invalid" });
		desktop.dispose();
	});

	it("encodes writes as one request object and maps native void null to undefined", async () => {
		const desktop = await createTauriMain();
		native.invoke.mockResolvedValueOnce({ ok: true, value: { hash: "new" } });
		await desktop.main.writeFile({ path: "/test", bytes: new Uint8Array([0, 255]), expectedHash: "old" });
		expect(native.invoke).toHaveBeenLastCalledWith("write_file", {
			request: { path: "/test", bytes: [0, 255], expectedHash: "old" },
		});
		native.invoke.mockResolvedValueOnce({ ok: true, value: null });
		await expect(desktop.main.setTitle("file.txt")).resolves.toBeUndefined();
		expect(native.invoke).toHaveBeenLastCalledWith("set_title", { request: { title: "file.txt" } });
		desktop.dispose();
	});

	it("preserves typed native failure codes and rejects malformed envelopes", async () => {
		const desktop = await createTauriMain();
		native.invoke.mockResolvedValueOnce({ ok: false, error: { code: "permission", message: "Denied" } });
		await expect(desktop.main.readClipboard()).rejects.toMatchObject({
			name: "IpcError",
			code: "permission",
			message: "Denied",
		});
		native.invoke.mockResolvedValueOnce({ ok: true });
		await expect(desktop.main.minimize()).rejects.toMatchObject({ code: "invalid" });
		native.invoke.mockRejectedValueOnce(new Error("bridge failed"));
		await expect(desktop.main.getSystemFonts()).rejects.toMatchObject({ code: "io" });
		desktop.dispose();
	});
});
