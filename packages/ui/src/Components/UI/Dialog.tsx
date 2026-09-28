import { Content, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

interface DialogProps extends ComponentProps<typeof Root> {}

export function Dialog(props: DialogProps) {
	return <Root data-slot="dialog" {...props} />;
}

interface DialogContentProps extends ComponentProps<typeof Content> {
	readonly container: HTMLElement | null;
}

export function DialogContent({ children, className, container, ...props }: DialogContentProps) {
	return (
		<Portal container={container}>
			<Overlay data-slot="dialog-overlay" className="absolute inset-0 z-50 bg-overlay" />
			<Content
				data-slot="dialog-content"
				className={cn(
					"absolute top-1/2 left-1/2 z-51 -translate-1/2 rounded-lg shadow-dialog outline-none",
					className,
				)}
				{...props}
			>
				{children}
			</Content>
		</Portal>
	);
}

interface DialogHeaderProps extends ComponentProps<"header"> {}

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
	return (
		<header
			data-slot="dialog-header"
			className={cn("flex items-center justify-between bg-chrome pl-3.5", className)}
			{...props}
		/>
	);
}

interface DialogFooterProps extends ComponentProps<"footer"> {}

export function DialogFooter({ className, ...props }: DialogFooterProps) {
	return (
		<footer
			data-slot="dialog-footer"
			className={cn("grid auto-cols-fr grid-flow-col bg-chrome", className)}
			{...props}
		/>
	);
}

interface DialogTitleProps extends ComponentProps<typeof Title> {}

export function DialogTitle({ className, ...props }: DialogTitleProps) {
	return (
		<Title
			data-slot="dialog-title"
			className={cn("m-0 flex items-center gap-2.5 text-heading font-medium", className)}
			{...props}
		/>
	);
}
