import { useEffect, useRef, useState } from "react";
import { gpuCompositingOf } from "./utils/gpuCompositingOf";
import type { Platform } from "./utils/platformOf";

interface AppBoxProps {
	readonly platform: Platform;
}

function postPlatform(frame: HTMLIFrameElement | null, platform: Platform): void {
	frame?.contentWindow?.postMessage({ type: "platform", platform }, window.location.origin);
}

export function AppBox({ platform }: AppBoxProps) {
	const frame = useRef<HTMLIFrameElement>(null);

	const [initialPlatform] = useState(platform);

	const [gpuCompositing] = useState(() => gpuCompositingOf(document));

	useEffect(() => {
		postPlatform(frame.current, platform);
	}, [platform]);

	return (
		<div id="app">
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
		</div>
	);
}
