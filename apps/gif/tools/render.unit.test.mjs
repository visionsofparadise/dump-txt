import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyCaptureSources, verifyFramePixels } from "./render.mjs";

test("permits rendering noise that stays below a visible jump", () => {
	const first = Buffer.alloc(960 * 720 * 4, 128);
	const last = Buffer.from(first);
	for (let pixel = 0; pixel < 6912; pixel += 1) last[pixel * 4] += 32;
	assert.deepEqual(verifyFramePixels(first, last), { changedPixels: 6912, maximumChannelDelta: 32 });
});

test("rejects a high contrast change even within a small number of pixels", () => {
	const first = Buffer.alloc(960 * 720 * 4, 255);
	const last = Buffer.from(first);
	for (let pixel = 0; pixel < 16; pixel += 1) last[pixel * 4] = 0;
	assert.throws(() => verifyFramePixels(first, last), /maximum channel delta 255/u);
});

test("rejects low level changes across more than 1% of pixels", () => {
	const first = Buffer.alloc(960 * 720 * 4, 128);
	const last = Buffer.from(first);
	for (let pixel = 0; pixel < 6913; pixel += 1) last[pixel * 4] += 1;
	assert.throws(() => verifyFramePixels(first, last), /6913 changed pixels/u);
});

test("rejects incorrect decoded frame dimensions", () => {
	const frame = Buffer.alloc(960 * 720 * 4);
	assert.throws(() => verifyFramePixels(frame, frame.subarray(4)), /RGBA/u);
	assert.throws(() => verifyFramePixels(frame.subarray(4), frame), /RGBA/u);
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
