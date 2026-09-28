import { describe, expect, it } from "vitest";
import { suppressWebviewContextMenu } from "./suppressWebviewContextMenu";

describe("suppressWebviewContextMenu", () => {
	it("cancels the webview menu outside editable text and keeps it inside", () => {
		document.body.innerHTML = `<div id="chrome"></div><div contenteditable="true"><span id="text"></span></div><div contenteditable="false"><span id="inert"></span></div><input id="field" />`;
		const cancelled = (id: string) => {
			const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

			document.getElementById(id)?.addEventListener("contextmenu", suppressWebviewContextMenu, { once: true });
			document.getElementById(id)?.dispatchEvent(event);

			return event.defaultPrevented;
		};

		expect(cancelled("chrome")).toBe(true);
		expect(cancelled("inert")).toBe(true);
		expect(cancelled("text")).toBe(false);
		expect(cancelled("field")).toBe(false);
	});
});
