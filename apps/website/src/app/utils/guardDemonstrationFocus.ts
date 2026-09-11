function isFocusOutside(owner: Document, region: Element): boolean {
	const active = owner.activeElement;

	return active !== null && active !== owner.body && active !== owner.documentElement && !region.contains(active);
}

export function guardDemonstrationFocus(stage: HTMLElement): () => void {
	const view = stage.ownerDocument.defaultView;

	if (!view) return () => undefined;

	const frame = view.frameElement;
	const focus = view.HTMLElement.prototype.focus;
	const select = view.HTMLInputElement.prototype.select;
	const pageView = frame?.ownerDocument.defaultView;
	const taskbar = pageView?.document.getElementById("github");
	const pageFocus = pageView?.HTMLElement.prototype.focus;

	const isHeldElsewhere = (target: Element) =>
		stage.contains(target) &&
		(isFocusOutside(stage.ownerDocument, stage) || (frame !== null && isFocusOutside(frame.ownerDocument, frame)));

	view.HTMLElement.prototype.focus = function focusUnlessHeldElsewhere(options?: FocusOptions) {
		if (!isHeldElsewhere(this)) focus.call(this, options);
	};

	view.HTMLInputElement.prototype.select = function selectUnlessHeldElsewhere() {
		if (!isHeldElsewhere(this)) select.call(this);
	};

	if (pageView && taskbar && pageFocus)
		pageView.HTMLElement.prototype.focus = function focusOutsideTaskbar(options?: FocusOptions) {
			if (!taskbar.contains(this)) pageFocus.call(this, options);
		};

	return () => {
		view.HTMLElement.prototype.focus = focus;
		view.HTMLInputElement.prototype.select = select;

		if (pageView && pageFocus) pageView.HTMLElement.prototype.focus = pageFocus;
	};
}
