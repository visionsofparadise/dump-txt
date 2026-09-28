import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

const chrome =
	"grid h-bar w-button flex-none place-items-center app-no-drag hover:not-disabled:bg-accent hover:not-disabled:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground touch:min-h-11 touch:min-w-11 touch:touch-manipulation";

const panelFocus = "focus-visible:bg-accent focus-visible:outline-none";

const buttonVariants = cva(
	"cursor-default focus-visible:outline-1 focus-visible:-outline-offset-3 focus-visible:outline-ring disabled:opacity-30",
	{
		variants: {
			variant: {
				chrome: [
					chrome,
					"in-data-[slot=title-bar]:hover:not-disabled:bg-chrome-accent in-data-[slot=title-bar]:data-[state=open]:bg-chrome-accent",
				],
				destructive: [chrome, "hover:not-disabled:bg-destructive hover:not-disabled:text-destructive-foreground"],
				constructive: [
					chrome,
					"hover:not-disabled:bg-constructive hover:not-disabled:text-constructive-foreground",
				],
				nav: "grid place-items-center hover:not-disabled:bg-page-hover hover:not-disabled:text-foreground",
				panel: "inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-xs px-1.5 py-0.75 whitespace-nowrap hover:not-disabled:bg-accent",
				macos: "size-3 rounded-full shadow-traffic-light app-no-drag focus-visible:outline-offset-2",
				gnome: "grid size-6 flex-none place-items-center rounded-full bg-gnome-button text-gnome-foreground app-no-drag hover:not-disabled:bg-gnome-button-hover focus-visible:outline-offset-2",
				option:
					"block h-bar w-full px-3.5 text-left text-heading hover:not-disabled:bg-field-accent aria-selected:bg-field-accent",
			},
			tone: {
				close: "bg-macos-close",
				minimize: "bg-macos-minimize",
				maximize: "bg-macos-maximize",
			},
			size: {
				bar: ["h-bar min-w-button rounded-none px-3 py-0", panelFocus],
				icon: ["h-bar w-button flex-none rounded-none p-0", panelFocus],
				block: "h-bar w-full min-w-0 justify-center gap-2 rounded-none",
			},
			offset: {
				none: "pl-0",
				one: "pl-button",
				two: "pl-[calc(var(--spacing-button)*2)]",
			},
		},
	},
);

interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, tone, size, offset, ...props }: ButtonProps) {
	return (
		<button
			data-slot="button"
			data-variant={variant ?? undefined}
			data-size={size ?? undefined}
			className={cn(buttonVariants({ variant, tone, size, offset, className }))}
			{...props}
		/>
	);
}
