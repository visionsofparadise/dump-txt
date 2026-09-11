import { motion, type Variants } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { gpuCompositingOf } from "./utils/gpuCompositingOf";
import type { Platform } from "./utils/platformOf";

interface AppBoxProps {
	readonly platform: Platform;
	readonly variants: Variants;
}

function postPlatform(frame: HTMLIFrameElement | null, platform: Platform): void {
	frame?.contentWindow?.postMessage({ type: "platform", platform }, window.location.origin);
}

export function AppBox({ platform, variants }: AppBoxProps) {
	const frame = useRef<HTMLIFrameElement>(null);

	const [initialPlatform] = useState(platform);

	const [gpuCompositing] = useState(() => gpuCompositingOf(document));

	useEffect(() => {
		postPlatform(frame.current, platform);
	}, [platform]);

	return (
		<motion.div id="app" variants={variants} initial="hidden" whileInView="visible" viewport={{ once: true }}>
			<div id="appbox" data-gpu-compositing={String(gpuCompositing)}>
				<iframe
					ref={frame}
					className="appbox-frame"
					src={`app.html?platform=${initialPlatform}`}
					title="dump.txt"
					onLoad={(event) => {
						postPlatform(event.currentTarget, platform);
					}}
				/>
			</div>
		</motion.div>
	);
}
