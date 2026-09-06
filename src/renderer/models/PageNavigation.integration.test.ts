import { describe, expect, it } from "vitest";
import { createDocumentState } from "./DocumentState";
import { PageNavigation } from "./PageNavigation";
import { createSessionState } from "./SessionState";

describe("page navigation without an editor", () => {
	it("advances every wheel event and discards unused temporary end pages on reversal", () => {
		const document = createDocumentState([
			{ id: "first", text: "one" },
			{ id: "second", text: "two" },
			{ id: "third", text: "three" },
		]);
		const session = createSessionState(document.pages);
		const navigation = new PageNavigation(document, session);
		const wheel = (deltaY: number) => navigation.handleWheel(new WheelEvent("wheel", { deltaY }));

		wheel(120);
		expect(session.view.activePageId).toBe("second");
		wheel(120);
		expect(session.view.activePageId).toBe("third");
		wheel(120);
		const bottom = document.pages.at(-1)!;
		expect(bottom.temporary).toBe(true);
		expect(session.view.activePageId).toBe(bottom.id);
		wheel(120);
		expect(document.pages).toHaveLength(4);
		wheel(-120);
		expect(session.view.activePageId).toBe("third");
		expect(document.pages).toHaveLength(3);
		wheel(-120);
		wheel(-120);
		expect(session.view.activePageId).toBe("first");
		wheel(-120);
		const top = document.pages[0]!;
		expect(top.temporary).toBe(true);
		expect(session.view.activePageId).toBe(top.id);
		wheel(120);
		expect(session.view.activePageId).toBe("first");
		expect(document.pages[0]?.id).toBe("first");
		expect(document.pages).toHaveLength(3);
	});

	it("accepts horizontal Shift wheel and preserves control-wheel and persistence locking", () => {
		const document = createDocumentState([
			{ id: "first", text: "one" },
			{ id: "second", text: "two" },
		]);
		const session = createSessionState(document.pages);
		const navigation = new PageNavigation(document, session);
		const shift = new WheelEvent("wheel", { shiftKey: true, deltaX: 120, cancelable: true });

		navigation.handleWheel(shift);
		expect(shift.defaultPrevented).toBe(true);
		expect(session.view.activePageId).toBe("second");
		navigation.setLocked(true);
		navigation.navigate(-1);
		expect(session.view.activePageId).toBe("second");
		navigation.setLocked(false);
		const control = new WheelEvent("wheel", { ctrlKey: true, deltaY: -120, cancelable: true });
		navigation.handleWheel(control);
		expect(control.defaultPrevented).toBe(false);
		expect(session.view.activePageId).toBe("second");
		navigation.navigate(-1);
		expect(session.view.activePageId).toBe("first");
	});

	it("resolves end creation after the current composition has committed", () => {
		const document = createDocumentState([{ id: "original", text: "" }]);
		const session = createSessionState(document.pages);
		const navigation = new PageNavigation(document, session);
		navigation.subscribeBeforeChange(() => {
			document.pages = [{ id: "original", text: "composed" }];
		});
		navigation.navigate(1);
		expect(document.pages.map((page) => page.text)).toEqual(["composed", ""]);
		expect(document.pages.at(-1)?.id).toBe(session.view.activePageId);
	});
});
