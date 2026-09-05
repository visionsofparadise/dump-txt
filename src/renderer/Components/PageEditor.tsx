import { useEffect, useRef } from "react";
import type { EditorController } from "../models/EditorController";

interface PageEditorProps {
	readonly editor: EditorController;
}

export function PageEditor({ editor }: PageEditorProps) {
	const parent = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (parent.current) {
			editor.attach(parent.current);
			editor.focus();
		}

		return () => editor.detach();
	}, [editor]);

	return <div className="page-editor" ref={parent} />;
}
