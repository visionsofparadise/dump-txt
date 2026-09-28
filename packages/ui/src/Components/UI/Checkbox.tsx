import { Indicator, Root } from "@radix-ui/react-checkbox";
import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

interface CheckboxProps extends ComponentProps<typeof Root> {}

export function Checkbox({ className, ...props }: CheckboxProps) {
	return (
		<Root
			data-slot="checkbox"
			className={cn(
				"grid size-4 shrink-0 place-items-center rounded-none bg-field text-foreground focus-visible:bg-field-accent focus-visible:outline-none",
				className,
			)}
			{...props}
		>
			<Indicator data-slot="checkbox-indicator" className="text-[13px] leading-none">
				✓
			</Indicator>
		</Root>
	);
}
