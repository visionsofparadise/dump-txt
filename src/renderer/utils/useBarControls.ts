import { useCallback, useEffect, useRef } from "react";
import type { DumpContext } from "../models/DumpContext";

export function useBarControls(context: DumpContext, direction: "up" | "down") {
	const { document, session, editor, navigation, persistenceState } = context;
	const up = direction === "up";
	const index = document.pages.findIndex((page) => page.id === session.view.activePageId);
	const atEnd = up ? index === 0 : index === document.pages.length - 1;

	const bar = useRef<HTMLElement>(null);

	useEffect(() => {
		const element = bar.current;
		const wheel = (event: WheelEvent) => navigation.handleWheel(event);

		element?.addEventListener("wheel", wheel, { passive: false });

		return () => element?.removeEventListener("wheel", wheel);
	}, [navigation]);

	const insert = useCallback(() => {
		editor.apply({ type: "insertPage", position: up ? "above" : "below" });
		editor.focus();
	}, [editor, up]);

	const navigate = useCallback(() => {
		navigation.navigate(up ? -1 : 1);
		editor.focus();
	}, [editor, navigation, up]);

	const boundary = useCallback(() => {
		navigation.navigate(up ? "first" : "last");
		editor.focus();
	}, [editor, navigation, up]);

	const move = useCallback(() => {
		editor.apply({ type: "movePage", direction });
		editor.focus();
	}, [direction, editor]);

	const remove = useCallback(() => {
		editor.apply({ type: "deletePage" });
		editor.focus();
	}, [editor]);

	return { bar, atEnd, locked: persistenceState.locked, insert, navigate, boundary, move, remove };
}
