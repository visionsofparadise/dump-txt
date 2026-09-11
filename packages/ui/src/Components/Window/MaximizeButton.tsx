import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import type { AppContext } from "../../models/AppContext";

interface MaximizeButtonProps extends Omit<ComponentProps<"button">, "children"> {
	readonly context: AppContext;
	readonly children?: (maximized: boolean) => ReactNode;
}

export function MaximizeButton({ context, children, ...props }: MaximizeButtonProps) {
	const { main, events } = context;
	const capabilities = capabilitiesOf(main);

	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		events.on("maximizedChanged", setMaximized);

		return () => {
			events.off("maximizedChanged", setMaximized);
		};
	}, [events]);

	const toggleMaximize = useCallback(() => {
		if (!capabilities.maximize) return;

		void main.toggleMaximize();
	}, [capabilities.maximize, main]);

	const label = maximized ? "Restore window" : "Maximize";

	return (
		<button {...props} aria-label={label} title={label} onClick={toggleMaximize} disabled={!capabilities.maximize}>
			{children?.(maximized)}
		</button>
	);
}
