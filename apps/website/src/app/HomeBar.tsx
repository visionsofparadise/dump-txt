import { useRef } from "react";
import type { BrowserMain } from "@dump-txt/rig";

interface HomeBarProps {
	readonly main: BrowserMain;
}

export function HomeBar({ main }: HomeBarProps) {
	const start = useRef<number | null>(null);

	const swiped = useRef(false);

	return (
		<button
			className="home-bar"
			type="button"
			aria-label="Home"
			title="Tap: home · Swipe up: close"
			onPointerDown={(event) => {
				start.current = event.clientY;
				swiped.current = false;
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerUp={(event) => {
				swiped.current = start.current !== null && start.current - event.clientY > 60;
				start.current = null;

				if (swiped.current) main.emit("closeRequested");
			}}
			onPointerCancel={() => {
				start.current = null;
			}}
			onClick={() => {
				if (!swiped.current) void main.minimize();

				swiped.current = false;
			}}
		>
			<span />
		</button>
	);
}
