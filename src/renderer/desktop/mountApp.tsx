import { createRoot } from "react-dom/client";
import { App } from "../Components/App";
import type { Main } from "../models/Main";

export function mountApp(main: Main, onReady?: () => void, dispose?: () => void): void {
	const element = document.getElementById("root");

	if (!element) throw new Error("The editor root is missing.");

	const root = createRoot(element);
	const cleanup = () => {
		root.unmount();
		dispose?.();
		window.removeEventListener("unload", cleanup);
	};

	window.addEventListener("unload", cleanup, { once: true });
	import.meta.hot?.dispose(cleanup);
	root.render(<App main={main} onReady={onReady} />);
}
