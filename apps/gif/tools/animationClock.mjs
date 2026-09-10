export function installAnimationClock() {
	const animations = new Map();
	const animate = Element.prototype.animate;
	const track = (animation) => {
		if (animations.has(animation) || animation.playState === "finished") return;
		animations.set(animation, performance.now());
		animation.pause();
		animation.currentTime = 0;
	};
	Element.prototype.animate = function (...arguments_) {
		const animation = animate.apply(this, arguments_);
		track(animation);
		return animation;
	};
	window.advanceAnimations = () => {
		for (const animation of document.getAnimations()) track(animation);
		for (const [animation, startedAt] of animations) {
			if (animation.playState === "idle") {
				animations.delete(animation);
				continue;
			}
			const elapsed = performance.now() - startedAt;
			const end = Number(animation.effect?.getComputedTiming().endTime ?? Infinity);
			animation.currentTime = Math.min(elapsed, end);
			if (Number.isFinite(end) && elapsed >= end) {
				animation.finish();
				animations.delete(animation);
			}
		}
	};
}
