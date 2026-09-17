import { afterEach, describe, expect, it, vi } from "vitest";
import { observePageTouch } from "./observePageTouch";
import type { EditorController } from "../models/EditorController";
import type { PageNavigation } from "../models/PageNavigation";

afterEach(() => vi.unstubAllGlobals());

describe("passive mobile page observer", () => {
	function fixture() {
		vi.stubGlobal("requestAnimationFrame", () => 1);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());

		const element = document.createElement("div");

		element.innerHTML = '<div class="cm-editor"><div class="cm-scroller"></div></div>';

		const scroller = element.querySelector<HTMLElement>(".cm-scroller")!;

		Object.defineProperties(scroller, { clientHeight: { value: 200 }, scrollHeight: { value: 1200 } });
		scroller.scrollTop = 1000;

		const state = { eligible: true };
		const editor = {
			get canNavigateByTouch() {
				return state.eligible;
			},
		} as EditorController;
		const navigate = vi.fn();
		const cleanup = observePageTouch(element, editor, { navigate } as unknown as PageNavigation);
		const send = (type: string, y: number, count = 1) => {
			const event = new Event(type, { cancelable: true });

			Object.defineProperty(event, "touches", {
				value: Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: 50, clientY: y })),
			});
			element.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(false);
		};

		return { state, navigate, cleanup, send };
	}

	it("navigates through the owner once while leaving native scrolling untouched", () => {
		const { send, navigate, cleanup } = fixture();

		send("touchstart", 300);
		send("touchmove", 190);
		send("touchmove", 50);

		expect(navigate).toHaveBeenCalledExactlyOnceWith(1, "start");
		cleanup();
	});

	it("cancels when selection/composition makes the editor ineligible mid-gesture", () => {
		const { send, state, navigate, cleanup } = fixture();

		send("touchstart", 300);
		send("touchmove", 250);
		state.eligible = false;
		send("touchmove", 50);
		state.eligible = true;
		send("touchmove", 0);

		expect(navigate).not.toHaveBeenCalled();
		cleanup();
	});

	it("cancels multitouch and interrupted gestures", () => {
		const { send, navigate, cleanup } = fixture();

		send("touchstart", 300);
		send("touchmove", 150, 2);
		send("touchmove", 0);
		send("touchstart", 300);
		send("touchcancel", 300, 0);
		send("touchmove", 0);

		expect(navigate).not.toHaveBeenCalled();
		cleanup();
	});
});
