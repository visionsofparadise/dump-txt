export function pagePointOf(
	frame: HTMLElement,
	point: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
	const box = frame.parentElement;
	const layout = box?.parentElement;
	const view = frame.ownerDocument.defaultView;

	if (!box || !layout || !view) return point;

	const { left, top } = layout.getBoundingClientRect();
	const style = view.getComputedStyle(box);
	const [originX = 0, originY = 0] = style.transformOrigin.split(" ").map((value) => Number.parseFloat(value));
	const matrix = style.transform === "none" ? new view.DOMMatrix() : new view.DOMMatrix(style.transform);
	const projected = matrix.transformPoint(
		new view.DOMPoint(frame.offsetLeft + point.x - originX, frame.offsetTop + point.y - originY),
	);

	return { x: left + originX + projected.x / projected.w, y: top + originY + projected.y / projected.w };
}
