import { useEffect, useRef } from "react";
import { PageEditorSurface } from "./Surface";
import type { EditorController } from "../../models/EditorController";

interface PageEditorProps {
	readonly editor: EditorController;
}

export function PageEditor({ editor }: PageEditorProps) {
	const parent = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const element = parent.current;
		const wheel = (event: WheelEvent) => editor.handleWheel(event);

		if (element) {
			editor.attach(element);
			editor.focus();
			performance.mark("dump:editor-ready");
			element.addEventListener("wheel", wheel, { passive: false });
		}

		return () => {
			element?.removeEventListener("wheel", wheel);
			editor.detach();
		};
	}, [editor]);

	return <PageEditorSurface className="data-covered:opacity-0" ref={parent} />;
}
