import { useCallback, type ComponentProps } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import type { AppContext } from "../../models/AppContext";

interface CloseButtonProps extends ComponentProps<"button"> {
	readonly context: AppContext;
}

export function CloseButton({ context, ...props }: CloseButtonProps) {
	const { main, persistence } = context;
	const capabilities = capabilitiesOf(main);

	const close = useCallback(() => {
		if (!capabilities.close) return;

		void persistence.close().catch(() => undefined);
	}, [capabilities.close, persistence]);

	return (
		<button
			{...props}
			aria-label="Close window"
			title="Close window"
			onClick={close}
			disabled={!capabilities.close}
		/>
	);
}
