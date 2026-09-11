import { useCallback, type ComponentProps } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import type { AppContext } from "../../models/AppContext";

interface MinimizeButtonProps extends ComponentProps<"button"> {
	readonly context: AppContext;
}

export function MinimizeButton({ context, ...props }: MinimizeButtonProps) {
	const { main } = context;
	const capabilities = capabilitiesOf(main);

	const minimize = useCallback(() => {
		if (!capabilities.minimize) return;

		void main.minimize();
	}, [capabilities.minimize, main]);

	return (
		<button {...props} aria-label="Minimize" title="Minimize" onClick={minimize} disabled={!capabilities.minimize} />
	);
}
