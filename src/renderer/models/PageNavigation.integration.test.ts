import { describe, expect, it } from "vitest";
import { createDocumentState } from "./DocumentState";
import { PageNavigation } from "./PageNavigation";
import { createSessionState } from "./SessionState";

describe("page navigation without an editor", () => {
	it("advances every wheel event, reverses immediately and stops at document boundaries", () => {
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
		expect(session.view.activePageId).toBe("third");
		wheel(-120);
		expect(session.view.activePageId).toBe("second");
		wheel(-120);
		wheel(-120);
		expect(session.view.activePageId).toBe("first");
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
});
