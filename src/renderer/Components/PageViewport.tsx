import { subscribe } from "opshot";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FindPanel } from "./FindPanel";
import { OccurrencePanel } from "./OccurrencePanel";
import { PageEditor } from "./PageEditor";
import { SaveStatus } from "./SaveStatus";
import type { DumpContext } from "../models/DumpContext";

interface PageViewportProps {
	readonly context: DumpContext;
}
interface PageTransition {
	readonly id: string;
	readonly text: string;
	readonly scrollTop: number;
	readonly direction: 1 | -1;
}

export function PageViewport({ context }: PageViewportProps) {
	const { editor, persistence } = context;
	const [transition, setTransition] = useState<PageTransition | null>(null);
	const incoming = useRef<HTMLDivElement>(null);
	const outgoing = useRef<HTMLDivElement>(null);
	const scrollTop = transition?.scrollTop ?? 0;
	const outgoingStyle = useMemo(() => ({ transform: `translateY(${-scrollTop}px)` }), [scrollTop]);

	useEffect(() => {
		const dump = persistence.context;

		if (!dump) return;

		let previousId = dump.session.view.activePageId;
		let previousIndex = dump.document.pages.findIndex((page) => page.id === previousId);
		let previousText = dump.document.pages[previousIndex]?.text ?? "";
		let previousScroll = dump.session.view.selections[previousId]?.scrollTop ?? 0;
		const changed = () => {
			const pageId = dump.session.view.activePageId;
			const index = dump.document.pages.findIndex((page) => page.id === pageId);
			const page = dump.document.pages[index];

			if (!page) return;

			if (pageId !== previousId) {
				const oldIndex = dump.document.pages.findIndex((candidate) => candidate.id === previousId);

				setTransition({
					id: crypto.randomUUID(),
					text: previousText,
					scrollTop: previousScroll,
					direction: index >= (oldIndex >= 0 ? oldIndex : previousIndex) ? 1 : -1,
				});
			}

			previousId = pageId;
			previousIndex = index;
			previousText = page.text;
			previousScroll = dump.session.view.selections[pageId]?.scrollTop ?? 0;
		};
		const unsubscribe = [subscribe(dump.document, changed), subscribe(dump.session, changed)];

		return () => {
			for (const remove of unsubscribe) remove();
		};
	}, [persistence]);
	useLayoutEffect(() => {
		if (!transition) return;

		const element = incoming.current;
		const departing = outgoing.current;
		const finish = () => setTransition((current) => (current?.id === transition.id ? null : current));

		if (!element?.animate || !departing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			queueMicrotask(finish);

			return;
		}

		const options: KeyframeAnimationOptions = { duration: 200, easing: "cubic-bezier(.2,.7,.2,1)" };
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
	}, [transition]);

	return (
		<section className="page-viewport" aria-label="Current page">
			<div className="page-current" ref={incoming}>
				<PageEditor editor={editor} />
			</div>
			{transition && (
				<div className="page-outgoing" ref={outgoing} aria-hidden inert>
					<pre style={outgoingStyle}>{transition.text}</pre>
				</div>
			)}
			<FindPanel context={context} />
			<OccurrencePanel context={context} />
			<SaveStatus context={context} />
		</section>
	);
}
