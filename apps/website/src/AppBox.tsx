import { motion, type MotionProps, type Variants } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { gpuCompositingOf } from "./utils/gpuCompositingOf";
import type { Platform } from "./utils/platformOf";

const applicationReadyTimeout = 4000;

interface AppBoxProps {
	readonly platform: Platform;
	readonly entrance: MotionProps;
	readonly tiltVariants: Variants;
	readonly onApplicationReady: () => void;
}

function postPlatform(frame: HTMLIFrameElement | null, platform: Platform): void {
	frame?.contentWindow?.postMessage({ type: "platform", platform }, window.location.origin);
}

export function AppBox({ platform, entrance, tiltVariants, onApplicationReady }: AppBoxProps) {
	const frame = useRef<HTMLIFrameElement>(null);

	const [initialPlatform] = useState(platform);

	const [gpuCompositing] = useState(() => gpuCompositingOf(document));

	useEffect(() => {
		postPlatform(frame.current, platform);
	}, [platform]);

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
	}, [onApplicationReady]);

	return (
		<motion.div id="app" {...entrance}>
			<motion.div
				id="appbox"
				data-gpu-compositing={String(gpuCompositing)}
				variants={gpuCompositing ? tiltVariants : undefined}
			>
				<iframe
					ref={frame}
					className="appbox-frame"
					src={`app.html?platform=${initialPlatform}`}
					title="dump.txt"
					onLoad={(event) => {
						postPlatform(event.currentTarget, platform);
					}}
				/>
			</motion.div>
		</motion.div>
	);
}
