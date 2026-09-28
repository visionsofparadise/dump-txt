import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";
import { BarButton } from "./BarButton";
import type { ComponentProps } from "react";

const pageBarVariants = cva("relative grid h-bar bg-bar text-muted-foreground", {
	variants: {
		variant: {
			previous: "grid-cols-[var(--spacing-button)_minmax(0,1fr)_calc(var(--spacing-button)*2)]",
			menu: "grid-cols-[calc(var(--spacing-button)*2)_minmax(0,1fr)_calc(var(--spacing-button)*2)]",
			next: "grid-cols-[var(--spacing-button)_minmax(0,1fr)_calc(var(--spacing-button)*3)]",
		},
	},
	defaultVariants: {
		variant: "previous",
	},
});

const navigationButtonVariants = cva("", {
	variants: {
		bar: {
			previous: "pl-button",
			menu: "pl-0",
			next: "pl-[calc(var(--spacing-button)*2)]",
		},
	},
	defaultVariants: {
		bar: "previous",
	},
});

interface PageBarProps extends ComponentProps<"nav">, VariantProps<typeof pageBarVariants> {}

export function PageBar({ className, variant = "previous", ...props }: PageBarProps) {
	return (
		<nav
			data-slot="page-bar"
			data-variant={variant ?? undefined}
			className={cn(pageBarVariants({ variant, className }))}
			{...props}
		/>
	);
}

interface PageBarNavigationButtonProps
	extends
		Omit<ComponentProps<typeof BarButton>, "variant" | "className">,
		VariantProps<typeof navigationButtonVariants> {}

export function PageBarNavigationButton({ bar, ...props }: PageBarNavigationButtonProps) {
	return <BarButton variant="nav" className={navigationButtonVariants({ bar })} {...props} />;
}
