import { Root } from "@radix-ui/react-label";
import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

interface LabelProps extends ComponentProps<typeof Root> {}

export function Label({ className, ...props }: LabelProps) {
	return (
		<Root
			data-slot="label"
			className={cn("inline-flex items-center gap-2 px-3 whitespace-nowrap", className)}
			{...props}
		/>
	);
}
