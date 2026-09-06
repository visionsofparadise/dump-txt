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

	it.each([
		["showOpenDialog", "show_open_dialog"],
		["showSaveDialog", "show_save_dialog"],
	] as const)("preserves native choices and cancellation for %s with optional hints", async (method, command) => {
		const desktop = await createTauriMain();
		const selected = { path: "/fixture/日本語.txt", hash: "observed-content-hash" };

		native.invoke.mockResolvedValueOnce({ ok: true, value: selected });
		await expect(desktop.main[method]()).resolves.toEqual(selected);
		expect(native.invoke).toHaveBeenLastCalledWith(command, { request: {} });

		const options = { title: "Choose text", defaultPath: "/fixture/suggested.txt" };
		const newFile = { path: "/fixture/chosen.txt", hash: null };

		native.invoke.mockResolvedValueOnce({ ok: true, value: newFile });
		await expect(desktop.main[method](options)).resolves.toEqual(newFile);
		expect(native.invoke).toHaveBeenLastCalledWith(command, { request: options });
		native.invoke.mockResolvedValueOnce({ ok: true, value: null });
		await expect(desktop.main[method]()).resolves.toBeNull();
		expect(native.invoke).toHaveBeenCalledTimes(3);
		desktop.dispose();
	});

	it.each(["showOpenDialog", "showSaveDialog"] as const)(
		"rejects malformed choices and preserves native failures for %s",
		async (method) => {
			const desktop = await createTauriMain();

			for (const choice of [
				undefined,
				{ path: "/fixture/missing-hash.txt" },
				{ path: 42, hash: null },
				{ path: "/fixture/file.txt", hash: 42 },
			]) {
				native.invoke.mockResolvedValueOnce({ ok: true, value: choice });
				await expect(desktop.main[method]()).rejects.toMatchObject({ name: "IpcError", code: "invalid" });
			}
			native.invoke.mockResolvedValueOnce({
				ok: false,
				error: { code: "permission", message: "Selected file is unavailable" },
			});
			await expect(desktop.main[method]()).rejects.toMatchObject({
				name: "IpcError",
				code: "permission",
				message: "Selected file is unavailable",
			});
			desktop.dispose();
		},
	);

	it.each(["success", "failure"] as const)(
		"waits for clipboard acknowledgement before reporting %s",
		async (outcome) => {
			const desktop = await createTauriMain();
			let acknowledge!: (response: unknown) => void;
			const pending = new Promise<unknown>((resolve) => {
				acknowledge = resolve;
			});

			native.invoke.mockReturnValueOnce(pending);
			const text = "中文 👩‍💻\r\n\f\nsecond";
			const writing = desktop.main.writeClipboard(text);
			let completed = false;
			void writing.then(
				() => {
					completed = true;
				},
				() => {
					completed = true;
				},
			);
			await Promise.resolve();
			expect(completed).toBe(false);
			expect(native.invoke).toHaveBeenLastCalledWith("write_clipboard", { request: { text } });
			if (outcome === "success") {
				acknowledge({ ok: true, value: null });
				await expect(writing).resolves.toBeUndefined();
			} else {
				acknowledge({ ok: false, error: { code: "io", message: "Clipboard busy" } });
				await expect(writing).rejects.toMatchObject({ name: "IpcError", code: "io", message: "Clipboard busy" });
			}
			expect(completed).toBe(true);
			desktop.dispose();
		},
	);

	it("validates font families and clipboard transport while preserving native menu intents", async () => {
		const desktop = await createTauriMain();
		native.invoke.mockResolvedValueOnce({ ok: true, value: ["Consolas", "Arial", "Arial"] });
		await expect(desktop.main.getSystemFonts()).resolves.toEqual(["Arial", "Consolas"]);
		expect(native.invoke).toHaveBeenLastCalledWith("get_system_fonts", { request: {} });
		native.invoke.mockResolvedValueOnce({ ok: true, value: "中文\n\f\n👩‍💻" });
		await expect(desktop.main.readClipboard()).resolves.toBe("中文\n\f\n👩‍💻");
		native.invoke.mockResolvedValueOnce({ ok: true, value: null });
		await expect(desktop.main.writeClipboard("")).resolves.toBeUndefined();
		expect(native.invoke).toHaveBeenLastCalledWith("write_clipboard", { request: { text: "" } });
		for (const intent of ["cut", "copy", "paste", "selectAll", null]) {
			native.invoke.mockResolvedValueOnce({ ok: true, value: intent });
			await expect(
				desktop.main.showTextContextMenu({ canUndo: false, canRedo: false, hasSelection: true, locked: false }),
			).resolves.toBe(intent);
		}
		native.invoke.mockResolvedValueOnce({ ok: true, value: ["Arial", ""] });
		await expect(desktop.main.getSystemFonts()).rejects.toMatchObject({ code: "invalid" });
		desktop.dispose();
	});
});
