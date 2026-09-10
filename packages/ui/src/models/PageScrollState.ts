import { createMutableState } from "opshot";
import { snapshotView, type ViewSnapshot } from "./SessionState";

export class PageScrollState {
	readonly positions = createMutableState<Record<string, number>>(
		{},
		{
			emitOn: (emit) => {
				if (typeof requestAnimationFrame === "function") requestAnimationFrame(emit);
				else queueMicrotask(emit);
			},
		},
	);

	capture(view: ViewSnapshot, before?: ViewSnapshot): ViewSnapshot {
		return snapshotView({
			...view,
			selections: Object.fromEntries(
				Object.entries(view.selections).map(([id, selection]) => [
					id,
					{
						...selection,
						scrollTop:
							before && selection.scrollTop !== before.selections[id]?.scrollTop
								? selection.scrollTop
								: (this.positions[id] ?? selection.scrollTop),
					},
				]),
			),
		});
	}

	restore(view: ViewSnapshot): void {
		for (const [id, selection] of Object.entries(view.selections)) this.positions[id] = selection.scrollTop;

		for (const id of Object.keys(this.positions))
			if (!Object.hasOwn(view.selections, id)) Reflect.deleteProperty(this.positions, id);
	}
}
