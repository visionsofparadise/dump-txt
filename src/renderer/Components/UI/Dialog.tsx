import { Content, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

interface DialogProps extends ComponentProps<typeof Root> {}

export function Dialog(props: DialogProps) {
	return <Root {...props} />;
}

interface DialogContentProps extends ComponentProps<typeof Content> {}

export function DialogContent({ children, className, ...props }: DialogContentProps) {
	return (
		<Portal>
			<Overlay data-slot="dialog-overlay" className="dialog-overlay" />
			<Content data-slot="dialog-content" className={cn("dialog-content", className)} {...props}>
				{children}
			</Content>
		</Portal>
	);
}

interface DialogTitleProps extends ComponentProps<typeof Title> {}

export function DialogTitle({ className, ...props }: DialogTitleProps) {
	return <Title data-slot="dialog-title" className={cn("dialog-title", className)} {...props} />;
}
