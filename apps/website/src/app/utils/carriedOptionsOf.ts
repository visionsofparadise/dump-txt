import { appStateSchema } from "@dump-txt/ui/host";
import type { BrowserMain } from "@dump-txt/rig";
import type { ChromeContext } from "@dump-txt/ui";

export async function carriedOptionsOf(main: BrowserMain, context: ChromeContext | null) {
	await context?.persistence.flush();

	const { startupSettings } = await main.getPaths();

	if (!startupSettings) throw new Error("The dump settings are missing.");

	const decoder = new TextDecoder();
	const state = appStateSchema.parse(JSON.parse(decoder.decode(startupSettings.bytes)));
	const file = await main.readFile(state.activePath);

	return {
		text: decoder.decode(file?.bytes),
		theme: state.appearance.theme,
		font: state.appearance.font,
		textSize: state.appearance.textSize,
		showStatusBar: state.appearance.showStatusBar,
	};
}
