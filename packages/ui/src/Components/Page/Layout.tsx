import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { observePageTouch } from "../../utils/observePageTouch";
import { mobilePlatforms } from "../../utils/platformGroups";
import { PageEditor } from "./Editor";
import { FindPanel } from "./FindPanel";
import { OccurrencePanel } from "./OccurrencePanel";
import { SaveStatus } from "./SaveStatus";
import { PageSnapshot } from "./Snapshot";
import { PageSurface } from "./Surface";
import type { DumpContext } from "../../models/DumpContext";
import type { PageTransition } from "../../models/EditorController";

interface PageLayoutProps {
	readonly context: DumpContext;
}

export function PageLayout({ context }: PageLayoutProps) {
	const { editor, navigation } = context;

	const current = useRef<HTMLDivElement>(null);

	const [transition, setTransition] = useState<PageTransition | null>(null);

	const incoming = useRef<HTMLDivElement>(null);

	const outgoing = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!current.current || !mobilePlatforms.has(context.main.platform ?? "")) return;

		return observePageTouch(current.current, editor, navigation);
	}, [context.main.platform, editor, navigation]);

	useEffect(() => {
		const element = current.current;
		const wheel = (event: WheelEvent) => {
			if (!event.shiftKey || event.ctrlKey) return;

			navigation.handleWheel(event);
			event.stopPropagation();
		};

		element?.addEventListener("wheel", wheel, { passive: false, capture: true });

		return () => element?.removeEventListener("wheel", wheel, true);
	}, [navigation]);

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
		<section
			className="relative @container-size min-h-0 overflow-hidden"
			data-slot="page-viewport"
			aria-label="Current page"
		>
			<PageSurface data-slot="page-current" ref={current}>
				<PageEditor editor={editor} />
			</PageSurface>
			{transition && <PageSnapshot ref={outgoing} snapshot={transition.outgoing} />}
			{transition?.incoming && <PageSnapshot ref={incoming} snapshot={transition.incoming} />}
			<FindPanel context={context} />
			<OccurrencePanel context={context} />
			<SaveStatus context={context} />
		</section>
	);
}
