import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import { Button } from "../UI/Button";
import type { AppContext } from "../../models/AppContext";

interface MaximizeButtonProps extends Omit<ComponentProps<typeof Button>, "children" | "className"> {
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
		<Button {...props} aria-label={label} title={label} onClick={toggleMaximize} disabled={!capabilities.maximize}>
			{children?.(maximized)}
		</Button>
	);
}
