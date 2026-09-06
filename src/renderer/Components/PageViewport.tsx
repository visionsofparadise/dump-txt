import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FindPanel } from "./FindPanel";
import { OccurrencePanel } from "./OccurrencePanel";
import { PageEditor } from "./PageEditor";
import { PageSnapshot } from "./PageSnapshot";
import { SaveStatus } from "./SaveStatus";
import type { DumpContext } from "../models/DumpContext";
import type { PageTransition } from "../models/EditorController";

interface PageViewportProps {
	readonly context: DumpContext;
}

export function PageViewport({ context }: PageViewportProps) {
	const { editor } = context;
	const [transition, setTransition] = useState<PageTransition | null>(null);
	const incoming = useRef<HTMLDivElement>(null);
	const outgoing = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => editor.subscribePageTransition((next) => flushSync(() => setTransition(next))), [editor]);
	useLayoutEffect(() => {
		if (!transition?.incoming) return;

		const element = incoming.current;
		const departing = outgoing.current;
		const finish = () => editor.finishPageTransition(transition.id);

		if (!element?.animate || !departing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			queueMicrotask(finish);

			return;
		}

		const options: KeyframeAnimationOptions = { duration: 200, easing: "cubic-bezier(.2,.7,.2,1)", fill: "both" };
		const entering = element.animate(
			[{ transform: `translateY(${transition.direction * 100}%)` }, { transform: "translateY(0)" }],
			options,
		);
		const leaving = departing.animate(
			[{ transform: "translateY(0)" }, { transform: `translateY(${-transition.direction * 100}%)` }],
			options,
		);

		void entering.finished.then(finish).catch(() => undefined);

		return () => {
			entering.cancel();
			leaving.cancel();
		};
	}, [editor, transition]);

	return (
		<section className="page-viewport" aria-label="Current page">
			<div className="page-current">
				<PageEditor editor={editor} />
			</div>
			{transition && <PageSnapshot ref={outgoing} snapshot={transition.outgoing} />}
			{transition?.incoming && <PageSnapshot ref={incoming} snapshot={transition.incoming} />}
			<FindPanel context={context} />
			<OccurrencePanel context={context} />
			<SaveStatus context={context} />
		</section>
	);
}
