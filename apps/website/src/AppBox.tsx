import { motion, type AnimationDefinition, type MotionProps, type Transition } from "motion/react";
import { scope } from "opshot";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { boxVariantsOf, maximizeTransitions } from "./utils/boxVariantsOf";
import { gpuCompositingOf } from "./utils/gpuCompositingOf";
import { postPlatform } from "./utils/postPlatform";
import type { AppWindowControl } from "./hooks/useAppWindow";
import type { Platform } from "./utils/platformOf";

const applicationReadyTimeout = 4000;

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
