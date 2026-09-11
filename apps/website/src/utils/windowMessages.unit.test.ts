import { describe, expect, it } from "vitest";
import { windowReportOf, windowRequestOf } from "./windowMessages";

describe("windowRequestOf", () => {
	it.each([
		[{ type: "minimize" }, { type: "minimize" }],
		[{ type: "toggleMaximize" }, { type: "toggleMaximize" }],
		[{ type: "open", platform: "linux" }, { type: "open" }],
		[
			{ type: "close", isDemonstration: true },
			{ type: "close", isDemonstration: true },
		],
		[
			{ type: "close", isDemonstration: false },
			{ type: "close", isDemonstration: false },
		],
	])("reads %j as a window request", (data, request) => {
		expect(windowRequestOf(data)).toEqual(request);
	});

	it.each([
		[null],
		["minimize"],
		[{}],
		[{ type: "close" }],
		[{ type: "close", isDemonstration: "yes" }],
		[{ type: "platform", platform: "linux" }],
		[{ type: "window", state: "open", isMaximized: false }],
	])("rejects %j", (data) => {
		expect(windowRequestOf(data)).toBeNull();
	});
});

describe("windowReportOf", () => {
	it.each(["open", "minimized", "closed"] as const)("reads a report of the %s window", (state) => {
		expect(windowReportOf({ type: "window", state, isMaximized: true })).toEqual({
			type: "window",
			state,
			isMaximized: true,
		});
	});

	it.each([
		[null],
		[{ type: "window", state: "hidden", isMaximized: false }],
		[{ type: "window", state: "open" }],
		[{ type: "window", state: "open", isMaximized: "no" }],
		[{ type: "minimize" }],
	])("rejects %j", (data) => {
		expect(windowReportOf(data)).toBeNull();
	});
});
