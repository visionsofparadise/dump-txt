import { useCallback, type ComponentProps } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import { Button } from "../UI/Button";
import type { AppContext } from "../../models/AppContext";

interface MinimizeButtonProps extends Omit<ComponentProps<typeof Button>, "className"> {
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
		<Button {...props} aria-label="Minimize" title="Minimize" onClick={minimize} disabled={!capabilities.minimize} />
	);
}
