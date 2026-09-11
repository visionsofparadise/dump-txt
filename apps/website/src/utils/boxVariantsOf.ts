import type { Platform } from "./platformOf";
import type { Transition, Variants } from "motion/react";

const tiltedTransform = { transformPerspective: 2400, rotateY: -9 };

const flatTransform = { transformPerspective: 2400, rotateY: 0 };

const flattenTransition: Transition = { duration: 0.15 };

export const maximizeTransitions: Record<Platform, Transition> = {
	windows: { duration: 0.25, ease: [0.1, 0.9, 0.2, 1] },
	macos: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] },
	linux: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};

export function boxVariantsOf(isTilted: boolean, tiltTransition: Transition | null, platform: Platform): Variants {
	const transformOf = (transform: typeof tiltedTransform) => (isTilted ? transform : {});
	const transition = maximizeTransitions[platform];
	const isTiltingIn = isTilted && tiltTransition !== null;

	return {
		hidden: isTiltingIn ? flatTransform : {},
		visible: isTiltingIn ? { ...tiltedTransform, transition: tiltTransition } : {},
		flat: { ...transformOf(flatTransform), transition: flattenTransition },
		maximized: { ...transformOf(flatTransform), borderRadius: 0, transition },
		tilted: { ...transformOf(tiltedTransform), borderRadius: 8, transition },
	};
}
