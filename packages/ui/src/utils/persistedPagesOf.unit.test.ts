import { describe, expect, it } from "vitest";
import { createSessionState } from "../models/SessionState";
import { persistedPagesOf } from "./persistedPagesOf";

describe("temporary page persistence", () => {
	it("omits untouched end pages and maps the saved selection to real pages", () => {
		const pages = [
			{ id: "top", text: "", temporary: true as const },
			{ id: "original", text: "original" },
		];
		const view = createSessionState(pages).view;
		const persisted = persistedPagesOf(pages, view);
		expect(persisted.pages).toEqual([pages[1]]);
		expect(persisted.view.activePageId).toBe("original");
		expect(Object.keys(persisted.view.selections)).toEqual(["original"]);
	});

	it("retains content and filters stale selection IDs after undo or redo", () => {
		const pages = [{ id: "kept", text: "typed", temporary: true as const }];
		const view = createSessionState([...pages, { id: "removed", text: "" }]).view;
		const persisted = persistedPagesOf(pages, view);
		expect(persisted.pages[0]?.text).toBe("typed");
		expect(Object.keys(persisted.view.selections)).toEqual(["kept"]);
	});
});
