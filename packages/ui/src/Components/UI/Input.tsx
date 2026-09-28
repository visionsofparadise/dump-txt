import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

const inputVariants = cva("focus-visible:outline-1 focus-visible:-outline-offset-3 focus-visible:outline-ring", {
	variants: {
		variant: {
			panel: "m-1.5 h-[calc(var(--spacing-bar)-12px)] w-0 min-w-0 flex-[1_1_120px] rounded-none bg-field px-3 text-foreground focus-visible:bg-field-accent focus-visible:outline-none",
			bare: "h-full w-full min-w-0 bg-transparent p-0 focus-visible:outline-none",
		},
	},
	defaultVariants: {
		variant: "panel",
	},
});

interface InputProps extends ComponentProps<"input">, VariantProps<typeof inputVariants> {}

export function Input({ className, type, variant = "panel", ...props }: InputProps) {
	return (
		<input
			type={type}
			data-slot="input"
			data-variant={variant ?? undefined}
			className={cn(inputVariants({ variant, className }))}
			{...props}
		/>
	);
}
