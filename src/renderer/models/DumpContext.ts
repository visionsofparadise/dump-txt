import type { AppContext } from "./AppContext";
import type { DocumentState } from "./DocumentState";
import type { EditorController } from "./EditorController";
import type { PageNavigation } from "./PageNavigation";
import type { History } from "./History";
import type { SessionState } from "./SessionState";

export interface DumpContext extends AppContext {
	readonly document: DocumentState;
	readonly session: SessionState;
	readonly history: History;
	readonly editor: EditorController;
	readonly navigation: PageNavigation;
}
