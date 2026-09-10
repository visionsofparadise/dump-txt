import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyCaptureSources, verifyFramePixels, verifyLoop } from "./render.mjs";

test("accepts identical encoded frames without decoding", () => {
	const opening = Buffer.from("opening frame pixels");
	assert.deepEqual(verifyLoop(opening, Buffer.from(opening)), { changedPixels: 0, maximumChannelDelta: 0 });
});

test("permits isolated rounding noise within two channel levels and 0.01% of pixels", () => {
	const first = Buffer.alloc(960 * 720 * 4, 128);
	const last = Buffer.from(first);
	for (let pixel = 0; pixel < 69; pixel += 1) last[pixel * 4] += (pixel % 2) + 1;
	assert.deepEqual(verifyFramePixels(first, last), { changedPixels: 69, maximumChannelDelta: 2 });
});

test("rejects a high contrast caret change even within a small number of pixels", () => {
	const first = Buffer.alloc(960 * 720 * 4, 255);
	const last = Buffer.from(first);
	for (let pixel = 0; pixel < 16; pixel += 1) last[pixel * 4] = 0;
	assert.throws(() => verifyFramePixels(first, last), /maximum channel delta 255/u);
});

test("rejects widespread low level changes", () => {
	const first = Buffer.alloc(960 * 720 * 4, 128);
	const last = Buffer.from(first);
	for (let pixel = 0; pixel < 70; pixel += 1) last[pixel * 4] += 1;
	assert.throws(() => verifyFramePixels(first, last), /70 changed pixels/u);
});

test("rejects incorrect decoded frame dimensions", () => {
	const frame = Buffer.alloc(960 * 720 * 4);
	assert.throws(() => verifyFramePixels(frame, frame.subarray(4)), /RGBA/u);
	assert.throws(() => verifyFramePixels(frame.subarray(4), frame), /RGBA/u);
});

test("rejects differently sized PNG frames before decoding", () => {
	const frame = Buffer.alloc(24);
	Buffer.from("89504e470d0a1a0a", "hex").copy(frame);
	frame.writeUInt32BE(720, 16);
	frame.writeUInt32BE(960, 20);
	assert.throws(() => verifyLoop(frame, Buffer.from("other frame")), /960 by 720 PNG/u);
});

const clean = { source: { sha: "release", dirty: false }, generator: { sha: "recorder", dirty: false } };

test("permits a clean recorder commit distinct from the released source", () => {
	assert.doesNotThrow(() => verifyCaptureSources(clean, structuredClone(clean), true));
});

for (const name of ["source", "generator"]) {
	test(`rejects a changed ${name} commit during capture`, () => {
		const changed = structuredClone(clean);
		changed[name].sha = "changed";
		assert.throws(() => verifyCaptureSources(clean, changed, false), /commit changed/u);
	});

	test(`requires a clean ${name} checkout throughout release capture`, () => {
		const dirty = structuredClone(clean);
		dirty[name].dirty = true;
		assert.throws(() => verifyCaptureSources(dirty, clean, true), /clean/u);
		assert.throws(() => verifyCaptureSources(clean, dirty, true), /clean/u);
		assert.doesNotThrow(() => verifyCaptureSources(dirty, dirty, false));
	});
}
