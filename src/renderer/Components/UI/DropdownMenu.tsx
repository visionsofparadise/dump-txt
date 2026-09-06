import {
	Content,
	Item,
	ItemIndicator,
	Portal,
	RadioGroup,
	RadioItem,
	Root,
	Separator,
	Sub,
	SubContent,
	SubTrigger,
	Trigger,
} from "@radix-ui/react-dropdown-menu";
import { cva } from "class-variance-authority";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

const itemClass = cva("menu-item", { variants: { inset: { true: "menu-item-inset" } } });

interface DropdownMenuProps extends ComponentProps<typeof Root> {}

export function DropdownMenu(props: DropdownMenuProps) {
	return <Root {...props} />;
}

interface DropdownMenuTriggerProps extends ComponentProps<typeof Trigger> {}

export function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
	return <Trigger {...props} />;
}

interface DropdownMenuContentProps extends ComponentProps<typeof Content> {}

export function DropdownMenuContent({
	className,
	sideOffset = 0,
	collisionPadding = 0,
	...props
}: DropdownMenuContentProps) {
	return (
		<Portal>
			<Content
				className={cn("menu-content", className)}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				{...props}
			/>
		</Portal>
	);
}

interface DropdownMenuItemProps extends ComponentProps<typeof Item> {}

export function DropdownMenuItem({ className, ...props }: DropdownMenuItemProps) {
	return <Item className={cn(itemClass(), className)} {...props} />;
}

interface DropdownMenuSeparatorProps extends ComponentProps<typeof Separator> {}

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
	return <Separator className={cn("menu-separator", className)} {...props} />;
}

interface DropdownMenuSubProps extends ComponentProps<typeof Sub> {}

export function DropdownMenuSub(props: DropdownMenuSubProps) {
	return <Sub {...props} />;
}

interface DropdownMenuSubTriggerProps extends ComponentProps<typeof SubTrigger> {}

export function DropdownMenuSubTrigger({ children, className, ...props }: DropdownMenuSubTriggerProps) {
	return (
		<SubTrigger className={cn(itemClass(), className)} {...props}>
			{children}
			<ChevronRight aria-hidden size={12} />
		</SubTrigger>
	);
}

interface DropdownMenuSubContentProps extends ComponentProps<typeof SubContent> {}

export function DropdownMenuSubContent({ className, ...props }: DropdownMenuSubContentProps) {
	return (
		<Portal>
			<SubContent className={cn("menu-content menu-subcontent", className)} collisionPadding={0} {...props} />
		</Portal>
	);
}

interface DropdownMenuRadioGroupProps extends ComponentProps<typeof RadioGroup> {}

export function DropdownMenuRadioGroup(props: DropdownMenuRadioGroupProps) {
	return <RadioGroup {...props} />;
}

interface DropdownMenuRadioItemProps extends ComponentProps<typeof RadioItem> {}

export function DropdownMenuRadioItem({ children, className, ...props }: DropdownMenuRadioItemProps) {
	return (
		<RadioItem className={cn(itemClass({ inset: true }), className)} {...props}>
			<span className="menu-check">
				<ItemIndicator>
					<Check aria-hidden size={12} />
				</ItemIndicator>
			</span>
			{children}
		</RadioItem>
	);
}
