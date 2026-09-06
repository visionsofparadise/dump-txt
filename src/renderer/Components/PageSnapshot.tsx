import { useLayoutEffect, useRef, type Ref } from "react";
import type { PageSnapshot as Snapshot } from "../models/EditorController";

interface PageSnapshotProps {
	readonly snapshot: Snapshot;
	readonly ref: Ref<HTMLDivElement>;
}

export function PageSnapshot({ snapshot, ref }: PageSnapshotProps) {
	const content = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const parent = content.current;

		if (!parent) return;

		parent.replaceChildren(snapshot.dom);

		const scroller = snapshot.dom.querySelector(".cm-scroller");

		if (scroller) scroller.scrollTop = snapshot.scrollTop;

		return () => parent.replaceChildren();
	}, [snapshot]);

	return (
		<div className="page-snapshot" ref={ref} aria-hidden inert>
			<div className="page-editor" ref={content} />
		</div>
	);
}
