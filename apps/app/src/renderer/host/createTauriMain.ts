import { EventEmitter } from "events";
import { appPathsSchema } from "@dump-txt/ui/host";
import { dialogChoiceSchema } from "@dump-txt/ui/host";
import { fileReadSchema } from "@dump-txt/ui/host";
import { failureOf, IpcError } from "@dump-txt/ui/host";
import { mainEventSchemas, type MainEventMap } from "@dump-txt/ui/host";
import { textContextMenuResponseSchema } from "@dump-txt/ui/host";
import { writeResultSchema } from "@dump-txt/ui/host";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { platformOf } from "./platformOf";
import { invokeTauri, nativeVoid } from "./utils/invokeTauri";
import type { Main } from "@dump-txt/ui/host";

const nativeFileRead = z
	.object({ bytes: z.array(z.number().int().min(0).max(255)), hash: z.string() })
	.transform(({ bytes, hash }) => ({ bytes: new Uint8Array(bytes), hash }))
	.pipe(fileReadSchema);
const nativePaths = appPathsSchema
	.extend({ startupSettings: nativeFileRead.nullable().optional() })
	.pipe(appPathsSchema);

export async function createTauriMain(): Promise<{ main: Main; dispose(): void }> {
	const events = new EventEmitter<MainEventMap>();
	const subscriptions = await Promise.allSettled(
		(["closeRequested", "windowBoundsChanged", "maximizedChanged"] as const).map((channel) =>
			listen<unknown>(channel, ({ payload }) => {
				const parsed = mainEventSchemas[channel].safeParse(payload);

				if (parsed.success) events.emit(channel, ...parsed.data);
				else console.error(new IpcError({ code: "invalid", message: `Invalid ${channel} event.` }));
			}),
		),
	);
	const unlisten = subscriptions.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
	const failed = subscriptions.find((result) => result.status === "rejected");

	if (failed) {
		for (const unsubscribe of unlisten) unsubscribe();

		throw new IpcError(failureOf(failed.reason));
	}

	let disposed = false;

	let removeInspector: () => void = () => undefined;

	if (import.meta.env.DEV) {
		const openInspector = (event: KeyboardEvent) => {
			const shortcut =
				event.key === "F12" ||
				(event.key.toLowerCase() === "i" &&
					((event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) ||
						(event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey)));

			if (!shortcut) return;

			event.preventDefault();
			void invokeTauri("open_inspector", {}, nativeVoid).catch((error: unknown) => console.error(error));
		};

		window.addEventListener("keydown", openInspector);
		removeInspector = () => window.removeEventListener("keydown", openInspector);
	}

	const main: Main = {
		platform: platformOf(),
		getPaths: () => invokeTauri("get_paths", {}, nativePaths),
		readFile: (path) => invokeTauri("read_file", { path }, nativeFileRead.nullable()),
		writeFile: (request) =>
			invokeTauri("write_file", { ...request, bytes: Array.from(request.bytes) }, writeResultSchema),
		showOpenDialog: (options) => invokeTauri("show_open_dialog", { ...options }, dialogChoiceSchema),
		showSaveDialog: (options) => invokeTauri("show_save_dialog", { ...options }, dialogChoiceSchema),
		minimize: () => invokeTauri("minimize", {}, nativeVoid),
		toggleMaximize: () => invokeTauri("toggle_maximize", {}, nativeVoid),
		setTitle: (title) => {
			document.title = title;

			return invokeTauri("set_title", { title }, nativeVoid);
		},
		setTheme: (theme) => {
			document.documentElement.dataset.theme = theme;

			return invokeTauri("set_theme", { theme }, nativeVoid);
		},
		finishClose: () => invokeTauri("finish_close", {}, nativeVoid),
		showTextContextMenu: (state) =>
			invokeTauri("show_text_context_menu", { ...state }, textContextMenuResponseSchema),
		getSystemFonts: async () => {
			const fonts = await invokeTauri("get_system_fonts", {}, z.array(z.string().min(1)));

			return [...new Set(fonts)].sort((left, right) => left.localeCompare(right));
		},
		readClipboard: () => invokeTauri("read_clipboard", {}, z.string()),
		writeClipboard: (text) => invokeTauri("write_clipboard", { text }, nativeVoid),
		events: {
			on(channel, listener) {
				if (disposed) throw new IpcError({ code: "io", message: "The desktop adapter is disposed." });

				const receive = (...parameters: Array<unknown>) => listener(...mainEventSchemas[channel].parse(parameters));

				events.on(channel, receive);

				return () => {
					events.off(channel, receive);
				};
			},
		},
	};

	return {
		main,
		dispose() {
			if (disposed) return;

			disposed = true;
			removeInspector();

			for (const unsubscribe of unlisten) unsubscribe();

			events.removeAllListeners();
		},
	};
}
