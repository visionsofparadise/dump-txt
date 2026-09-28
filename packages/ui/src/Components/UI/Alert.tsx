import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

interface AlertProps extends ComponentProps<"div"> {}

export function Alert({ className, ...props }: AlertProps) {
	return (
		<div
			data-slot="alert"
			role="status"
			aria-live="polite"
			className={cn(
				"flex flex-wrap items-center justify-between gap-1.5 overflow-auto rounded-sm border border-border bg-card px-2.5 py-1.75 shadow-toast",
				className,
			)}
			{...props}
		/>
	);
}
