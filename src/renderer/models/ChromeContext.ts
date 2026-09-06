import type { ChromeState } from "./ChromeState";
import type { DumpContext } from "./DumpContext";

export interface ChromeContext extends DumpContext {
	readonly chrome: ChromeState;
}
