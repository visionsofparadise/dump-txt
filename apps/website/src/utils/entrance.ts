import type { MotionProps, TargetAndTransition, Transition, Variants } from "motion/react";

const easeOut = [0.16, 1, 0.3, 1] as const;

const headlineEase = [0.3, 0.6, 0.2, 1] as const;

const instant: Transition = { duration: 0 };

const entranceViewport = { once: true, amount: 0.15 } as const;

interface Entrance {
	readonly app: Variants;
	readonly tilt: Transition | null;
	readonly controls: Variants;
	readonly github: Variants;
	readonly headline: Variants;
	readonly pointer: Variants;
}

function variantsOf(hidden: TargetAndTransition, visible: TargetAndTransition, transition: Transition): Variants {
	return { hidden, visible: { ...visible, transition } };
}

export function entranceOf(isMobile: boolean, isReducedMotion: boolean): Entrance {
	const timingOf = (transition: Transition) => (isReducedMotion ? instant : transition);
	const riseOf = (distance: number, delay: number, duration: number) =>
		variantsOf({ opacity: 0, y: distance }, { opacity: 1, y: 0 }, timingOf({ duration, delay, ease: easeOut }));
	const fadeOf = (delay: number) =>
		variantsOf({ opacity: 0 }, { opacity: 1 }, timingOf({ duration: 1.8, delay, ease: headlineEase }));

	const pointerOf = (delay: number) =>
		variantsOf({ opacity: 0 }, { opacity: 1 }, timingOf({ duration: 1.2, delay, ease: easeOut }));

	if (isMobile)
		return {
			app: riseOf(28, 0.15, 1.2),
			tilt: null,
			controls: riseOf(20, 0.2, 1),
			github: riseOf(20, 0.35, 1),
			headline: fadeOf(0.1),
			pointer: pointerOf(0.15),
		};

	return {
		app: variantsOf({ opacity: 0, x: -160 }, { opacity: 1, x: 0 }, timingOf({ duration: 1.2, ease: easeOut })),
		tilt: timingOf({ duration: 1.2, ease: easeOut }),
		controls: riseOf(40, 0.35, 1),
		github: riseOf(40, 0.5, 1),
		headline: fadeOf(0.65),
		pointer: pointerOf(0),
	};
}

export function sectionOf(variants: Variants, isEntranceReady: boolean): MotionProps {
	return {
		variants,
		initial: "hidden",
		whileInView: isEntranceReady ? "visible" : undefined,
		viewport: entranceViewport,
	};
}
