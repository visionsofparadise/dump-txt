import { motion, type AnimationDefinition, type MotionProps, type Transition, type Variants } from "motion/react";
import { scope } from "opshot";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { gpuCompositingOf } from "./utils/gpuCompositingOf";
import type { AppWindowControl } from "./hooks/useAppWindow";
import type { Platform } from "./utils/platformOf";

const applicationReadyTimeout = 4000;

const tiltedTransform = { transformPerspective: 2400, rotateY: -9 };

const flatTransform = { transformPerspective: 2400, rotateY: 0 };

const flattenTransition: Transition = { duration: 0.15 };

const maximizeTransitions: Record<Platform, Transition> = {
	windows: { duration: 0.25, ease: [0.1, 0.9, 0.2, 1] },
	macos: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] },
	linux: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};

interface AppBoxProps {
	readonly platform: Platform;
	readonly entrance: MotionProps;
	readonly tiltTransition: Transition | null;
	readonly control: AppWindowControl;
	readonly onApplicationReady: () => void;
}

interface TileOffsetStyle extends CSSProperties {
	readonly "--tile-x": string;
	readonly "--tile-y": string;
}

function boxVariantsOf(isTilted: boolean, tiltTransition: Transition | null, platform: Platform): Variants {
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

function postPlatform(frame: HTMLIFrameElement | null, platform: Platform): void {
	frame?.contentWindow?.postMessage({ type: "platform", platform }, window.location.origin);
}

export const AppBox = scope(({ platform, entrance, tiltTransition, control, onApplicationReady }: AppBoxProps) => {
	const { appWindow, frame, finishAnimation, reportWindow } = control;

	const [initialPlatform] = useState(platform);

	const [gpuCompositing] = useState(() => gpuCompositingOf(document));

	const [isEntered, setEntered] = useState(false);

	const boxVariants = useMemo(
		() => boxVariantsOf(gpuCompositing, tiltTransition, platform),
		[gpuCompositing, tiltTransition, platform],
	);

	const enter = useCallback((definition: AnimationDefinition) => {
		if (definition === "visible") setEntered(true);
	}, []);

	const layoutTransition = useMemo(() => ({ layout: maximizeTransitions[platform] }), [platform]);

	const { x, y } = appWindow.tileOffset;

	const tileOffset = useMemo<TileOffsetStyle>(() => ({ "--tile-x": `${x}px`, "--tile-y": `${y}px` }), [x, y]);

	useEffect(() => {
		postPlatform(frame.current, platform);
	}, [frame, platform]);

	useEffect(() => {
		const startedAt = performance.now();

		let request = 0;

		const awaitHeader = () => {
			const hasHeader = Boolean(frame.current?.contentDocument?.querySelector("header, nav"));

			if (hasHeader || performance.now() - startedAt > applicationReadyTimeout) onApplicationReady();
			else request = requestAnimationFrame(awaitHeader);
		};

		awaitHeader();

		return () => {
			cancelAnimationFrame(request);
		};
	}, [frame, onApplicationReady]);

	return (
		<motion.div
			id="app"
			data-window={appWindow.state}
			data-maximized={String(appWindow.isMaximized)}
			layout
			layoutDependency={appWindow.isMaximized}
			transition={layoutTransition}
			onAnimationStart={enter}
			{...entrance}
		>
			<div
				id="appanim"
				data-animation={appWindow.animation ?? undefined}
				style={tileOffset}
				onAnimationEnd={finishAnimation}
			>
				<motion.div
					id="appbox"
					data-gpu-compositing={String(gpuCompositing)}
					variants={boxVariants}
					initial="hidden"
					animate={appWindow.pose ?? (isEntered ? "visible" : "hidden")}
				>
					<iframe
						ref={frame}
						className="appbox-frame"
						src={`app.html?platform=${initialPlatform}`}
						title="dump.txt"
						onLoad={(event) => {
							postPlatform(event.currentTarget, platform);
							reportWindow();
						}}
					/>
				</motion.div>
			</div>
		</motion.div>
	);
});
