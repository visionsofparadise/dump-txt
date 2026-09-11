import type { DemoRig } from "./DemoRig";

const notes = "Today\n\n- Sketch the Atlas launch\n- Send the draft on Friday\n- Keep the useful bits together";
const draft = [
	"Draft reply",
	"",
	"Hi Sam,",
	"",
	"Here's the plan for Friday.",
	"",
	"Start small. Put the useful thing first.",
	"Leave room for the next thought.",
	"",
	"Launch notes",
	"",
	"A place for ideas while they're still rough.",
	"A separate page when the subject changes.",
	"Everything ready when you come back.",
	"",
	"Things to check",
	"",
	"- Keep the opening short",
	"- Make the next step clear",
	"- Send the draft before lunch",
	"",
	"Questions for later",
	"",
	"What would make this easier to use?",
	"What can we simplify?",
	"",
	"Thanks,",
	"",
	"Sam",
].join("\n");
const checklist = "Checklist\n\nAtlas copy\nAtlas screenshots\nAtlas release\n\nReady for Friday.";

async function explain(rig: DemoRig, text: string): Promise<void> {
	rig.context.editor.select([{ anchor: rig.text.length, head: rig.text.length }]);
	await rig.type(`\n\n${text}`, 30);
	await rig.wait(700);
}

async function captureThoughts(rig: DemoRig): Promise<void> {
	await rig.wait(350);
	await rig.type("Dump text, think less.", 75);
	await rig.wait(2200);
	await rig.select("Dump text, think less.");
	await rig.paste(notes);
	await explain(rig, "Somewhere to put the thought.");
	await rig.wait(1500);
	await explain(rig, "New thought? Scroll down for a new page.");
	await rig.wheel(360, {}, ".page-bar-bottom");
	rig.assert(
		rig.context.document.pages.length === 2 && rig.text === "",
		"Scrolling must create an empty second page.",
	);
	await rig.type("Draft reply\n\n", 55);
	await rig.paste(draft.slice("Draft reply\n\n".length));
	await rig.wheel(360, {}, ".page-bar-bottom");
	await rig.type("Checklist\n\n", 55);
	await rig.paste(checklist.slice("Checklist\n\n".length));
	rig.assert(rig.context.document.pages.length === 3, "The scratchpad must contain three pages.");
}

async function navigateNotes(rig: DemoRig): Promise<void> {
	await explain(rig, "Shift + scroll to flip through your notes.");
	await rig.wheel(-120, { shiftKey: true });
	await rig.wheel(-120, { shiftKey: true });
	await rig.wait(650);
	await rig.wheel(120, { shiftKey: true });
	rig.assert(rig.text.startsWith("Draft reply"), "Page navigation must return to the draft.");
	await rig.wheel(-120);
	await rig.wheel(-120);
	await rig.wait(650);
	await rig.wheel(120, { shiftKey: true });
	await rig.wheel(-120, { shiftKey: true });
	await rig.wait(900);
	rig.context.editor.select([{ anchor: rig.text.length, head: rig.text.length }]);
	await rig.type("\n\nP.S. Let's keep it simple.", 40);
	await rig.wait(950);
	await rig.wheel(120, { shiftKey: true });
	await explain(rig, "Move this page up. Keep things in order.");
	await rig.click('[aria-label="Move page up"]');
	rig.assert(
		rig.context.document.pages[1]?.text.startsWith("Checklist") === true,
		"The checklist must move above the draft.",
	);
	await rig.wait(1100);
}

async function editTogether(rig: DemoRig): Promise<void> {
	await explain(rig, "Select a word. Ctrl + D picks the next. Edit together.");
	await rig.select("Atlas");
	await rig.wait(500);
	await rig.key("d", { ctrlKey: true });
	await rig.key("d", { ctrlKey: true });
	await rig.wait(750);
	await rig.type("Orbit", 100);
	rig.assert(rig.text.split("Orbit").length === 4, "Three occurrence selections must edit together.");
	await rig.wait(1000);
	await rig.key("Escape");
	await explain(rig, "Ctrl + F finds it across your notes.");
	await rig.key("f", { ctrlKey: true });
	await rig.move('[aria-label="Find text"]');

	for (const query of ["F", "Fr", "Fri", "Frid", "Frida", "Friday"]) {
		rig.context.editor.updateFind({ query });
		await rig.wait(100);
	}

	await rig.click(".find-panel label:last-of-type input");
	await rig.wait(600);
	await rig.click('[aria-label="Next match"]');
	await rig.click('[aria-label="Next match"]');
	await rig.move('[aria-label="Replacement text"]');
	rig.element('[aria-label="Replacement text"]').focus();

	for (const replacement of ["M", "Mo", "Mon", "Mond", "Monda", "Monday"]) {
		rig.context.editor.updateFind({ replacement });
		await rig.wait(100);
	}

	await rig.move(".find-panel .panel-options:nth-child(2) button:last-child");
	await rig.click(".find-panel .panel-options:nth-child(2) button:last-child");
	rig.assert(
		rig.context.document.pages.every((page) => !page.text.includes("Friday")),
		"Replace all must update every page.",
	);
	await rig.wait(900);
	await rig.click('[aria-label="Close find"]');
}

async function returnLater(rig: DemoRig, options: DemonstrationOptions): Promise<void> {
	await explain(rig, "Delete a page. Ctrl + Z brings it back.");
	await rig.click('[aria-label="Delete page"]');
	await rig.wait(600);
	rig.context.editor.focus();
	await rig.key("z", { ctrlKey: true });
	rig.assert(rig.context.document.pages.length === 3, "Undo must restore the deleted page.");
	await rig.wait(1000);
	await explain(rig, "Ctrl + scroll. Make yourself comfortable.");
	await rig.select("Make yourself comfortable.");
	await rig.wheel(-100, { ctrlKey: true });
	await rig.wait(700);
	await rig.wheel(100, { ctrlKey: true });

	if (!options.reopen) {
		await explain(rig, "Saved as you go. Come back anytime.");
		await rig.wait(1800);

		return;
	}

	await explain(rig, "Saved as you go. Close it. Come back anytime.");
	await rig.wait(1000);

	const pages = rig.context.document.pages.map((page) => page.text);

	await rig.click('[aria-label="Close window"]');
	await rig.wait(1300);
	await rig.click('[aria-label="Open dump.txt"]');
	await rig.wait(1100);
	rig.assert(
		JSON.stringify(rig.context.document.pages.map((page) => page.text)) === JSON.stringify(pages),
		"Reopening must restore every saved page.",
	);
	await explain(rig, "Right where you left it.");
	await rig.wait(1800);
}

async function closeLoop(rig: DemoRig): Promise<void> {
	while (rig.context.document.pages.length > 1) {
		await rig.click('[aria-label="Delete page"]');
		await rig.wait(300);
	}

	await rig.click('[aria-label="Delete page"]');
	rig.assert(rig.context.document.pages.length === 1 && rig.text === "", "The loop must end with one empty page.");
	rig.context.editor.select([{ anchor: 0, head: 0 }]);
	rig.context.editor.focus();
	await rig.move(rig.origin);
	await rig.wait(1000);
}

export interface DemonstrationOptions {
	readonly reopen: boolean;
}

export async function demonstrate(rig: DemoRig, options: DemonstrationOptions): Promise<void> {
	await captureThoughts(rig);
	await navigateNotes(rig);
	await editTogether(rig);
	await returnLater(rig, options);
	await closeLoop(rig);
}
