import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

interface KbdProps extends ComponentProps<"kbd"> {}

export function Kbd({ className, ...props }: KbdProps) {
	return (
		<kbd
			data-slot="kbd"
			className={cn("font-mono text-interface leading-[normal] whitespace-nowrap", className)}
			{...props}
		/>
	);
}
