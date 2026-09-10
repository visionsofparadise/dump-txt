import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { installAnimationClock } from "./animationClock.mjs";

function fixture(duration) {
	let time = 0;
	let finishes = 0;
	const animation = {
		currentTime: 0,
		playState: "running",
		effect: { getComputedTiming: () => ({ endTime: duration }) },
		pause() {
			this.playState = "paused";
		},
		finish() {
			this.playState = "finished";
			finishes += 1;
		},
	};
	class Element {
		animate() {
			return animation;
		}
	}
	const window = {};
	runInNewContext(`(${installAnimationClock.toString()})()`, {
		Element,
		window,
		document: { getAnimations: () => [animation] },
		performance: { now: () => time },
	});
	new Element().animate();
	return {
		animation,
		finishes: () => finishes,
		advance: (elapsed) => {
			time = elapsed;
			window.advanceAnimations();
		},
	};
}

test("seeks browser transitions on simulated time and finishes them once", () => {
	const state = fixture(200);
	assert.equal(state.animation.playState, "paused");
	state.advance(50);
	assert.equal(state.animation.currentTime, 50);
	state.advance(250);
	assert.equal(state.animation.currentTime, 200);
	assert.equal(state.finishes(), 1);
	state.advance(300);
	assert.equal(state.finishes(), 1);
});

test("does not complete canceled animations or infinite animations", () => {
	const canceled = fixture(200);
	canceled.animation.playState = "idle";
	canceled.advance(300);
	assert.equal(canceled.finishes(), 0);
	const infinite = fixture(Infinity);
	infinite.advance(5000);
	assert.equal(infinite.animation.currentTime, 5000);
	assert.equal(infinite.finishes(), 0);
});
