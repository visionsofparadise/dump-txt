import { scope } from "opshot";
import { lazy, Suspense } from "react";
import type { ChromeContext } from "../../models/ChromeContext";

const FontPicker = lazy(() => import("./FontPicker").then((module) => ({ default: module.FontPicker })));
const Keybinds = lazy(() => import("./Keybinds").then((module) => ({ default: module.Keybinds })));

interface ChromeDialogsProps {
	readonly context: ChromeContext;
}

export const ChromeDialogs = scope(({ context }: ChromeDialogsProps) => (
	<Suspense fallback={null}>
		{context.chrome.fontPickerOpen && <FontPicker context={context} />}
		{context.chrome.keybindsOpen && <Keybinds context={context} />}
	</Suspense>
));
