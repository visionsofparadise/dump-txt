import type { TextMatch } from "./SessionState";

export type EditCommand =
	| { readonly type: "insert" | "paste"; readonly text: string }
	| { readonly type: "delete"; readonly direction: "backward" | "forward" }
	| { readonly type: "enclose"; readonly opening: string }
	| { readonly type: "indent"; readonly direction: "in" | "out" }
	| { readonly type: "insertPage"; readonly position: "above" | "below" }
	| { readonly type: "movePage"; readonly direction: "up" | "down" }
	| { readonly type: "deletePage" }
	| { readonly type: "replace"; readonly matches: ReadonlyArray<TextMatch>; readonly text: string };
