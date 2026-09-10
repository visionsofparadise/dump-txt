import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLoop } from "./render.mjs";

test("rejects publishing a loop whose last frame differs from its first", () => {
	const opening = Buffer.from("opening frame pixels");
	assert.doesNotThrow(() => verifyLoop(opening, Buffer.from(opening)));
	assert.throws(() => verifyLoop(opening, Buffer.from("a different caret position")), /final frame/u);
});
