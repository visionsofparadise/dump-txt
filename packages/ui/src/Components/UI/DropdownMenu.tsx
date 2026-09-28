import {
	Content,
	Group,
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
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

const content =
	"z-20 max-h-(--radix-dropdown-menu-content-available-height) w-72 max-w-full animate-panel-appear overflow-y-auto rounded-none bg-popover p-0 shadow-menu motion-reduce:animate-none";

const row = "flex h-bar items-center gap-3 pl-3 whitespace-nowrap select-none [&>svg]:flex-none";

const item = [
	row,
	"min-h-bar cursor-default pr-3 outline-none data-disabled:pointer-events-none data-disabled:opacity-30 data-highlighted:bg-popover-accent data-[state=open]:bg-popover-accent",
];

interface DropdownMenuProps extends ComponentProps<typeof Root> {}

export function DropdownMenu(props: DropdownMenuProps) {
	return <Root data-slot="dropdown-menu" {...props} />;
}

interface DropdownMenuTriggerProps extends ComponentProps<typeof Trigger> {}

export function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
	return <Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

interface DropdownMenuContentProps extends ComponentProps<typeof Content> {
	readonly container: HTMLElement | null;
}

export function DropdownMenuContent({
	className,
	container,
	sideOffset = 0,
	collisionPadding = 0,
	...props
}: DropdownMenuContentProps) {
	return (
		<Portal container={container}>
			<Content
				data-slot="dropdown-menu-content"
				className={cn(content, className)}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				collisionBoundary={container}
				{...props}
			/>
		</Portal>
	);
}

interface DropdownMenuItemProps extends ComponentProps<typeof Item> {}

export function DropdownMenuItem({ className, ...props }: DropdownMenuItemProps) {
	return <Item data-slot="dropdown-menu-item" className={cn(item, className)} {...props} />;
}

interface DropdownMenuRowProps extends ComponentProps<typeof Group> {}

export function DropdownMenuRow({ className, ...props }: DropdownMenuRowProps) {
	return <Group data-slot="dropdown-menu-row" className={cn(row, className)} {...props} />;
}

interface DropdownMenuStepItemProps extends Omit<ComponentProps<typeof Item>, "asChild"> {}

export function DropdownMenuStepItem({ className, children, ...props }: DropdownMenuStepItemProps) {
	return (
		<Item asChild {...props}>
			<button
				type="button"
				data-slot="dropdown-menu-step-item"
				className={cn(item, "w-bar justify-center p-0", className)}
			>
				{children}
			</button>
		</Item>
	);
}

const shortcutVariants = cva("ml-auto text-secondary text-popover-muted-foreground", {
	variants: {
		variant: {
			shortcut: "",
			value: "max-w-30 overflow-hidden text-ellipsis",
		},
	},
});

interface DropdownMenuShortcutProps extends ComponentProps<"span">, VariantProps<typeof shortcutVariants> {}

export function DropdownMenuShortcut({ className, variant = "shortcut", ...props }: DropdownMenuShortcutProps) {
	return (
		<span
			data-slot="dropdown-menu-shortcut"
			data-variant={variant}
			className={cn(shortcutVariants({ variant, className }))}
			{...props}
		/>
	);
}

interface DropdownMenuSeparatorProps extends ComponentProps<typeof Separator> {}

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
	return (
		<Separator
			data-slot="dropdown-menu-separator"
			className={cn("m-0 h-px bg-popover-border", className)}
			{...props}
		/>
	);
}

interface DropdownMenuSubProps extends ComponentProps<typeof Sub> {}

export function DropdownMenuSub(props: DropdownMenuSubProps) {
	return <Sub data-slot="dropdown-menu-sub" {...props} />;
}

interface DropdownMenuSubTriggerProps extends ComponentProps<typeof SubTrigger> {}

export function DropdownMenuSubTrigger({ children, className, ...props }: DropdownMenuSubTriggerProps) {
	return (
		<SubTrigger data-slot="dropdown-menu-sub-trigger" className={cn(item, className)} {...props}>
			{children}
			<ChevronRight aria-hidden className="size-icon" />
		</SubTrigger>
	);
}

interface DropdownMenuSubContentProps extends ComponentProps<typeof SubContent> {
	readonly container: HTMLElement | null;
}

export function DropdownMenuSubContent({ className, container, ...props }: DropdownMenuSubContentProps) {
	return (
		<Portal container={container}>
			<SubContent
				data-slot="dropdown-menu-sub-content"
				className={cn(
					content,
					"max-h-[min(280px,var(--radix-dropdown-menu-content-available-height))] w-max min-w-40",
					className,
				)}
				collisionPadding={0}
				collisionBoundary={container}
				{...props}
			/>
		</Portal>
	);
}

interface DropdownMenuRadioGroupProps extends ComponentProps<typeof RadioGroup> {}

export function DropdownMenuRadioGroup(props: DropdownMenuRadioGroupProps) {
	return <RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

interface DropdownMenuRadioItemProps extends ComponentProps<typeof RadioItem> {}

export function DropdownMenuRadioItem({ children, className, ...props }: DropdownMenuRadioItemProps) {
	return (
		<RadioItem data-slot="dropdown-menu-radio-item" className={cn(item, "relative pl-8", className)} {...props}>
			<span className="absolute left-3 grid place-items-center">
				<ItemIndicator>
					<Check aria-hidden size={12} />
				</ItemIndicator>
			</span>
			{children}
		</RadioItem>
	);
}
