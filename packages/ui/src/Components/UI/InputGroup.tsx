import { cn } from "../../utils/cn";
import { Input } from "./Input";
import type { ComponentProps } from "react";

interface InputGroupProps extends ComponentProps<"div"> {}

export function InputGroup({ className, ...props }: InputGroupProps) {
	return (
		<div
			data-slot="input-group"
			role="group"
			className={cn(
				"flex min-w-0 items-center gap-2.5 bg-field px-2.5 has-[[data-slot=input-group-control]:focus-visible]:bg-field-accent",
				className,
			)}
			{...props}
		/>
	);
}

interface InputGroupAddonProps extends ComponentProps<"div"> {}

export function InputGroupAddon({ className, ...props }: InputGroupAddonProps) {
	return (
		<div
			role="group"
			data-slot="input-group-addon"
			data-align="inline-start"
			className={cn("order-first flex flex-none items-center text-muted-foreground", className)}
			{...props}
		/>
	);
}

interface InputGroupInputProps extends Omit<ComponentProps<typeof Input>, "variant"> {}

export function InputGroupInput({ className, ...props }: InputGroupInputProps) {
	return <Input variant="bare" data-slot="input-group-control" className={cn("flex-1", className)} {...props} />;
}
