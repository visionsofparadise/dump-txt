export type WindowState = "open" | "minimized" | "closed";

export type WindowRequest =
	| { readonly type: "minimize" }
	| { readonly type: "toggleMaximize" }
	| { readonly type: "close"; readonly isDemonstration: boolean }
	| { readonly type: "open" };

export interface WindowReport {
	readonly type: "window";
	readonly state: WindowState;
	readonly isMaximized: boolean;
}

export function windowRequestOf(data: unknown): WindowRequest | null {
	if (typeof data !== "object" || data === null || !("type" in data)) return null;

	if (data.type === "minimize" || data.type === "toggleMaximize" || data.type === "open") return { type: data.type };

	if (data.type === "close" && "isDemonstration" in data && typeof data.isDemonstration === "boolean")
		return { type: "close", isDemonstration: data.isDemonstration };

	return null;
}

export function windowReportOf(data: unknown): WindowReport | null {
	if (typeof data !== "object" || data === null || !("type" in data) || data.type !== "window") return null;

	if (!("state" in data) || !("isMaximized" in data) || typeof data.isMaximized !== "boolean") return null;

	return data.state === "open" || data.state === "minimized" || data.state === "closed"
		? { type: "window", state: data.state, isMaximized: data.isMaximized }
		: null;
}
