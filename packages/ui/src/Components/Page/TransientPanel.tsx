import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

interface TransientPanelProps extends ComponentProps<"div"> {
	readonly "aria-label": string;
	readonly "data-slot": string;
}

export function TransientPanel({ className, ...props }: TransientPanelProps) {
	return (
		<div
			className={cn(
				"absolute top-0 right-0 z-5 max-h-full w-110 max-w-full animate-panel-appear overflow-auto bg-bar shadow-panel motion-reduce:animate-none",
				className,
			)}
			{...props}
			role="dialog"
			aria-modal="false"
		/>
	);
}

interface TransientPanelOptionsProps extends ComponentProps<"div"> {}

export function TransientPanelOptions({ className, ...props }: TransientPanelOptionsProps) {
	return (
		<div
			data-slot="panel-options"
			className={cn(
				"flex h-bar flex-nowrap items-center *:data-[slot=label]:px-3 *:data-[slot=label]:whitespace-nowrap",
				className,
			)}
			{...props}
		/>
	);
}
