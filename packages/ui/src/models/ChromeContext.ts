import type { ChromeState } from "./ChromeState";
import type { DumpContext } from "./DumpContext";
import type { RefObject } from "react";

export interface ChromeContext extends DumpContext {
	readonly chrome: ChromeState;
	readonly surface: RefObject<HTMLDivElement | null>;
}
