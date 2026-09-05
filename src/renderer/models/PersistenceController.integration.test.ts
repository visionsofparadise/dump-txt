import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as waitForIo } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeText } from "../utils/encodeText";
import { serializePages } from "../utils/serializePages";
import { MainEvents } from "./MainEvents";
import { PersistenceController } from "./PersistenceController";
import { snapshotView } from "./SessionState";
import type { WriteRequest } from "../../shared/ipc/FileSystem/writeFile/Renderer";
import type { AppState } from "./AppState";
import type { Main } from "./Main";
import type { RecoveryRecord } from "./RecoveryRecord";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function hash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

const cleanups: Array<() => Promise<void>> = [];

async function fixture(initial?: string) {
	const directory = await mkdtemp(join(tmpdir(), "dump-persistence-"));
	const path = `${directory}/dump.txt`;
	const writes: Array<WriteRequest> = [];
	let openChoice: { path: string; hash: string | null } | null = null;
	let saveChoice: { path: string; hash: string | null } | null = null;
	let beforeWrite: (request: WriteRequest) => Promise<void> = async () => undefined;
	let beforeRead: (path: string) => Promise<void> = async () => undefined;
	let beforeClose: () => Promise<void> = async () => undefined;
	const closed = vi.fn();
	if (initial !== undefined) await writeFile(path, initial);
	const read = async (filePath: string) => {
		try {
			const bytes = new Uint8Array(await readFile(filePath));
			return { bytes, hash: hash(bytes) };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	};
	const main: Main = {
		getPaths: async () => {
			const state = await read(`${directory}/app-state.json`);
			let restoredFilePath: string | null = null;
			try {
				restoredFilePath = state
					? (JSON.parse(new TextDecoder().decode(state.bytes)) as AppState).activePath
					: null;
			} catch {
				restoredFilePath = null;
			}
			return { userData: directory, restoredFilePath };
		},
		readFile: async (filePath) => {
			await beforeRead(filePath);
			return read(filePath);
		},
		writeFile: async (request) => {
			await beforeWrite(request);
			const current = await read(request.path);
			if ((current?.hash ?? null) !== request.expectedHash) throw new Error("File changed outside dump.txt.");
			await writeFile(request.path, request.bytes);
			writes.push({ ...request, bytes: new Uint8Array(request.bytes) });
			return { hash: hash(request.bytes) };
		},
		showOpenDialog: async () => openChoice,
		showSaveDialog: async () => saveChoice,
		minimize: async () => undefined,
		toggleMaximize: async () => undefined,
		finishClose: async () => {
			await beforeClose();
			closed();
		},
		events: { on: () => () => undefined },
	};
	const controllers: Array<PersistenceController> = [];
	const emitters: Array<MainEvents> = [];
	const create = () => {
		const events = new MainEvents(main);
		const persistence = new PersistenceController(main, events);
		controllers.push(persistence);
		emitters.push(events);
		return persistence;
	};
	const persistence = create();
	cleanups.push(async () => {
		controllers.forEach((controller) => controller.dispose());
		await Promise.all(controllers.map((controller) => controller.flush()));
		emitters.forEach((events) => events.dispose());
		await rm(directory, { recursive: true, force: true });
	});
	return {
		directory,
		path,
		writes,
		read,
		main,
		closed,
		persistence,
		create,
		setWrite: (callback: typeof beforeWrite) => {
			beforeWrite = callback;
		},
		setRead: (callback: typeof beforeRead) => {
			beforeRead = callback;
		},
		setClose: (callback: typeof beforeClose) => {
			beforeClose = callback;
		},
		chooseOpen: (choice: typeof openChoice) => {
			openChoice = choice;
		},
		chooseSave: (choice: typeof saveChoice) => {
			saveChoice = choice;
		},
	};
}

function insert(controller: PersistenceController, text: string): void {
	controller.context?.editor.apply({ type: "insert", text });
}

function textOf(controller: PersistenceController): string {
	return controller.context ? serializePages(controller.context.document.pages) : "";
}

async function diskText(path: string): Promise<string> {
	return readFile(path, "utf8");
}

async function until(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 1000; index++) {
		if (predicate()) return;
		await waitForIo(1);
	}
	throw new Error("The controlled persistence operation did not settle.");
}

beforeEach(() => {
	vi.stubGlobal("crypto", webcrypto);
});
afterEach(async () => {
	vi.useRealTimers();
	for (const cleanup of cleanups.splice(0)) await cleanup();
	vi.unstubAllGlobals();
});

describe("the current dump lifecycle", () => {
	it("retries a failed adopted-file journal after the backing bytes are saved", async () => {
		const test = await fixture("source");
		await test.persistence.initialize();
		const destination = `${test.directory}/journal-retry.txt`;
		test.chooseSave({ path: destination, hash: null });
		test.setWrite(async (request) => {
			if (
				request.path.endsWith("recovery.json") &&
				new TextDecoder().decode(request.bytes).includes("journal-retry.txt")
			)
				throw new Error("Journal denied");
		});
		await test.persistence.saveAs();
		expect(test.persistence.state.phase).toBe("failed");
		test.setWrite(async () => undefined);
		await test.persistence.flush();
		const journal = JSON.parse(await diskText(`${test.directory}/recovery.json`)) as RecoveryRecord;
		expect(journal.path).toBe(destination);
		expect(test.persistence.state.phase).toBe("ready");
	});

	it("keeps close locked while an older backing write and newer journal settle", async () => {
		vi.useFakeTimers();
		const test = await fixture("");
		await test.persistence.initialize();
		const wait = deferred();
		let started = false;
		test.setWrite(async (request) => {
			if (request.path === test.path && !started) {
				started = true;
				await wait.promise;
			}
		});
		insert(test.persistence, "a");
		await vi.advanceTimersByTimeAsync(250);
		await until(() => started);
		insert(test.persistence, "b");
		const closing = test.persistence.close();
		insert(test.persistence, "late");
		expect(test.persistence.state.locked).toBe(true);
		expect(test.closed).not.toHaveBeenCalled();
		wait.resolve();
		await closing;
		expect(await diskText(test.path)).toBe("ab");
		expect(test.closed).toHaveBeenCalledOnce();
	});

	it("restores input when the candidate read fails after the Open barrier", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "accepted");
		const destination = `${test.directory}/unreadable.txt`;
		test.chooseOpen({ path: destination, hash: null });
		test.setRead(async (path) => {
			if (path === destination) throw new Error("Candidate denied");
		});
		await test.persistence.open();
		expect(test.persistence.state.locked).toBe(false);
		expect(test.persistence.state.path).toBe(test.path);
		expect(await diskText(test.path)).toBe("acceptedbase");
		insert(test.persistence, "more");
		expect(textOf(test.persistence)).toBe("acceptedmorebase");
	});
	it("opens noncanonical text and preserves exact bytes through close and restart", async () => {
		const test = await fixture("old");
		await test.persistence.initialize();
		const destination = `${test.directory}/mixed.txt`;
		const bytes = "one\ftwo\r\nthree\nfour\r";
		await writeFile(destination, bytes);
		test.chooseOpen({ path: destination, hash: null });
		await test.persistence.open();
		await test.persistence.close();
		test.persistence.dispose();
		const restarted = test.create();
		await restarted.initialize();
		await restarted.close();
		expect(await diskText(destination)).toBe(bytes);
		expect(restarted.state.savedRevision).toBe(0);
	});

	it("prefers newer saved navigation over an already-saved journal view", async () => {
		const test = await fixture("one\n\f\ntwo");
		await test.persistence.initialize();
		insert(test.persistence, "new");
		await test.persistence.flush();
		const context = test.persistence.context!;
		const second = context.document.pages[1]!;
		context.session.view = snapshotView({
			...context.session.view,
			activePageId: second.id,
			selections: {
				...context.session.view.selections,
				[second.id]: { ranges: [{ anchor: 1, head: 2 }], mainIndex: 0, scrollTop: 10 },
			},
		});
		await test.persistence.close();
		test.persistence.dispose();
		const restarted = test.create();
		await restarted.initialize();
		const restored = restarted.context!;
		expect(restored.session.view.activePageId).toBe(restored.document.pages[1]?.id);
		expect(restored.session.view.selections[restored.session.view.activePageId]?.ranges).toEqual([
			{ anchor: 1, head: 2 },
		]);
	});

	it("opens a valid file after undecodable startup and persists the new path", async () => {
		const test = await fixture();
		await writeFile(test.path, new Uint8Array([255]));
		await test.persistence.initialize();
		expect(test.persistence.context).toBeNull();
		const destination = `${test.directory}/valid.txt`;
		await writeFile(destination, "valid");
		test.chooseOpen({ path: destination, hash: null });
		await test.persistence.open();
		expect(textOf(test.persistence)).toBe("valid");
		test.persistence.dispose();
		const restarted = test.create();
		await restarted.initialize();
		expect(restarted.state.path).toBe(destination);
		expect(textOf(restarted)).toBe("valid");
	});

	it("retries a transient startup read failure through flush", async () => {
		const test = await fixture("base");
		let failures = 0;
		test.setRead(async () => {
			if (failures++ === 0) throw new Error("Temporary read failure");
		});
		await test.persistence.initialize();
		expect(test.persistence.context).toBeNull();
		await test.persistence.flush();
		expect(textOf(test.persistence)).toBe("base");
	});

	it("opens a valid replacement for a clean missing file", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		await test.persistence.close();
		test.persistence.dispose();
		await rm(test.path);
		const restarted = test.create();
		await restarted.initialize();
		const destination = `${test.directory}/replacement.txt`;
		await writeFile(destination, "replacement");
		test.chooseOpen({ path: destination, hash: null });
		await restarted.open();
		expect(restarted.state.path).toBe(destination);
		expect(restarted.state.phase).toBe("ready");
		insert(restarted, "new");
		await restarted.flush();
		expect(await diskText(destination)).toBe("newreplacement");
	});
	it("creates the default file and keeps unchanged opened bytes intact", async () => {
		const first = await fixture();
		await first.persistence.initialize();
		expect(first.persistence.state.path).toBe(first.path);
		expect(await diskText(first.path)).toBe("");
		const second = await fixture("alpha\fbeta\r\n");
		await second.persistence.initialize();
		await second.persistence.flush();
		expect(await diskText(second.path)).toBe("alpha\fbeta\r\n");
		expect(second.writes.filter((write) => write.path === second.path)).toHaveLength(0);
	});

	it("journals text immediately, coalesces bursts and autosaves undo", async () => {
		vi.useFakeTimers();
		const test = await fixture("");
		await test.persistence.initialize();
		insert(test.persistence, "a");
		insert(test.persistence, "b");
		insert(test.persistence, "c");
		await until(() => test.writes.filter((write) => write.path.endsWith("recovery.json")).length === 3);
		expect(await diskText(test.path)).toBe("");
		await vi.advanceTimersByTimeAsync(250);
		await until(() => test.persistence.state.savedRevision === 3);
		expect(await diskText(test.path)).toBe("abc");
		expect(test.writes.filter((write) => write.path === test.path)).toHaveLength(1);
		test.persistence.context?.history.undo();
		await test.persistence.flush();
		expect(await diskText(test.path)).toBe("ab");
	});

	it("writes within one second of continuous editing", async () => {
		vi.useFakeTimers();
		const test = await fixture("");
		await test.persistence.initialize();
		for (let index = 0; index < 5; index++) {
			insert(test.persistence, "x");
			await vi.advanceTimersByTimeAsync(200);
		}
		await until(() => test.writes.some((write) => write.path === test.path));
		expect(await diskText(test.path)).toBe("xxxxx");
	});

	it("restores saved page selection, appearance, preferences and fresh history", async () => {
		const test = await fixture("one\n\f\ntwo");
		await test.persistence.initialize();
		const context = test.persistence.context!;
		const page = context.document.pages[1]!;
		context.session.view = snapshotView({
			...context.session.view,
			activePageId: page.id,
			selections: {
				...context.session.view.selections,
				[page.id]: { ranges: [{ anchor: 1, head: 3 }], mainIndex: 0, scrollTop: 20 },
			},
		});
		context.session.appearance = { theme: "dark", font: "Consolas", textSize: 18 };
		context.session.occurrencePreferences = { matchCase: true, allPages: true };
		await test.persistence.flush();
		test.persistence.dispose();
		const restarted = test.create();
		await restarted.initialize();
		const restored = restarted.context!;
		expect(restored.session.appearance.textSize).toBe(18);
		expect(restored.session.occurrencePreferences.allPages).toBe(true);
		expect(restored.session.view.activePageId).toBe(restored.document.pages[1]?.id);
		expect(restored.session.view.selections[restored.session.view.activePageId]?.ranges).toEqual([
			{ anchor: 1, head: 3 },
		]);
		expect(restored.history.canUndo).toBe(false);
	});

	it("resets stale selection snapshots after an external file edit", async () => {
		const test = await fixture("one\n\f\ntwo");
		await test.persistence.initialize();
		test.persistence.context?.editor.showPage(test.persistence.context.document.pages[1]!.id);
		await test.persistence.flush();
		test.persistence.dispose();
		await writeFile(test.path, "changed");
		const restarted = test.create();
		await restarted.initialize();
		expect(restarted.context?.session.view.activePageId).toBe(restarted.context?.document.pages[0]?.id);
		expect(textOf(restarted)).toBe("changed");
	});

	it("preserves malformed settings and uses the existing default", async () => {
		const test = await fixture("existing");
		await writeFile(`${test.directory}/app-state.json`, "broken-json");
		await test.persistence.initialize();
		expect(textOf(test.persistence)).toBe("existing");
		const preserved = (await readdir(test.directory)).find((name) => /^app-state-.*\.json$/u.test(name));
		expect(preserved).toBeDefined();
		expect(await diskText(`${test.directory}/${preserved}`)).toBe("broken-json");
	});

	it("holds input across delayed Open reads and installs a fresh file history", async () => {
		const test = await fixture("old");
		await test.persistence.initialize();
		insert(test.persistence, "accepted");
		const destination = `${test.directory}/opened.txt`;
		await writeFile(destination, "candidate");
		test.chooseOpen({ path: destination, hash: hash(new TextEncoder().encode("candidate")) });
		const wait = deferred();
		test.setRead(async (path) => {
			if (path === destination) await wait.promise;
		});
		const operation = test.persistence.open();
		await until(() => test.persistence.state.locked);
		insert(test.persistence, "late");
		await until(() => test.persistence.state.savedRevision === 1);
		expect(await diskText(test.path)).toBe("acceptedold");
		wait.resolve();
		await operation;
		expect(textOf(test.persistence)).toBe("candidate");
		expect(test.persistence.context?.history.canUndo).toBe(false);
		expect(test.persistence.state.locked).toBe(false);
	});

	it("retains the old dump on cancelled Open and invalid candidate bytes", async () => {
		const test = await fixture("old");
		await test.persistence.initialize();
		const original = test.persistence.context;
		await test.persistence.open();
		expect(test.persistence.context).toBe(original);
		const destination = `${test.directory}/invalid.txt`;
		await writeFile(destination, new Uint8Array([255]));
		test.chooseOpen({ path: destination, hash: null });
		await test.persistence.open();
		expect(test.persistence.context).toBe(original);
		expect(test.persistence.state.error).toContain("invalid text bytes");
		expect(test.persistence.state.locked).toBe(false);
		insert(test.persistence, "usable");
		expect(textOf(test.persistence)).toBe("usableold");
	});

	it("treats Open and Save As of the same path as a flush", async () => {
		const test = await fixture("");
		await test.persistence.initialize();
		insert(test.persistence, "a");
		const original = test.persistence.context;
		test.chooseOpen({ path: test.path, hash: null });
		await test.persistence.open();
		test.chooseSave({ path: test.path, hash: null });
		await test.persistence.saveAs();
		expect(test.persistence.context).toBe(original);
		expect(original?.history.canUndo).toBe(true);
	});

	it("Save As adopts the destination while retaining history and session identity", async () => {
		const test = await fixture("");
		await test.persistence.initialize();
		insert(test.persistence, "saved");
		const original = test.persistence.context;
		const destination = `${test.directory}/saved.txt`;
		test.chooseSave({ path: destination, hash: null });
		await test.persistence.saveAs();
		expect(test.persistence.context).toBe(original);
		expect(test.persistence.state.path).toBe(destination);
		expect(await diskText(destination)).toBe("saved");
		const journal = JSON.parse(await diskText(`${test.directory}/recovery.json`)) as RecoveryRecord;
		expect(journal.path).toBe(destination);
		original?.history.undo();
		await test.persistence.flush();
		expect(await diskText(destination)).toBe("");
		expect(await diskText(test.path)).toBe("saved");
	});

	it("keeps the source when Save As is cancelled or the destination write fails", async () => {
		const test = await fixture("source");
		await test.persistence.initialize();
		await test.persistence.saveAs();
		expect(test.persistence.state.path).toBe(test.path);
		const destination = `${test.directory}/saved.txt`;
		test.chooseSave({ path: destination, hash: null });
		test.setWrite(async (request) => {
			if (request.path === destination) throw new Error("Destination denied");
		});
		await test.persistence.saveAs();
		expect(test.persistence.state.path).toBe(test.path);
		expect(test.persistence.state.error).toContain("Destination denied");
		expect(test.persistence.state.locked).toBe(false);
	});

	it("reports a written copy when the destination app-state commit fails", async () => {
		const test = await fixture("source");
		await test.persistence.initialize();
		const destination = `${test.directory}/copy.txt`;
		test.chooseSave({ path: destination, hash: null });
		test.setWrite(async (request) => {
			if (request.path.endsWith("app-state.json") && new TextDecoder().decode(request.bytes).includes("copy.txt"))
				throw new Error("Settings denied");
		});
		await test.persistence.saveAs();
		expect(await diskText(destination)).toBe("source");
		expect(test.persistence.state.path).toBe(test.path);
		expect(test.persistence.state.error).toContain("A copy was written");
	});

	it("preserves pending text on external conflicts and recovers through Save As", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "pending");
		await writeFile(test.path, "external");
		await expect(test.persistence.flush()).rejects.toThrow("changed outside");
		expect(await diskText(test.path)).toBe("external");
		expect(textOf(test.persistence)).toBe("pendingbase");
		const destination = `${test.directory}/recovered.txt`;
		test.chooseSave({ path: destination, hash: null });
		await test.persistence.saveAs();
		expect(await diskText(destination)).toBe("pendingbase");
		expect(test.persistence.state.phase).toBe("ready");
	});

	it("Retry succeeds when the expected backing bytes are restored", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "new");
		await writeFile(test.path, "external");
		await expect(test.persistence.flush()).rejects.toThrow();
		await writeFile(test.path, "base");
		await test.persistence.flush();
		expect(await diskText(test.path)).toBe("newbase");
	});

	it("holds the close lock until native acknowledgement and rejects late input", async () => {
		const test = await fixture("");
		await test.persistence.initialize();
		insert(test.persistence, "accepted");
		const wait = deferred();
		test.setClose(() => wait.promise);
		const operation = test.persistence.close();
		await until(() => test.persistence.state.savedRevision === 1);
		insert(test.persistence, "late");
		expect(textOf(test.persistence)).toBe("accepted");
		expect(test.persistence.state.locked).toBe(true);
		wait.resolve();
		await operation;
		expect(test.closed).toHaveBeenCalledOnce();
		expect(test.persistence.state.locked).toBe(false);
	});

	it("keeps the window open and restores editing when closing cannot save", async () => {
		const test = await fixture("");
		await test.persistence.initialize();
		insert(test.persistence, "pending");
		test.setWrite(async (request) => {
			if (request.path === test.path) throw new Error("Save denied");
		});
		await test.persistence.close();
		expect(test.closed).not.toHaveBeenCalled();
		expect(test.persistence.state.locked).toBe(false);
		insert(test.persistence, "more");
		expect(textOf(test.persistence)).toBe("pendingmore");
	});

	it("keeps the adopted file after transition journal failure", async () => {
		const test = await fixture("source");
		await test.persistence.initialize();
		const destination = `${test.directory}/adopted.txt`;
		test.chooseSave({ path: destination, hash: null });
		test.setWrite(async (request) => {
			if (request.path.endsWith("recovery.json")) throw new Error("Journal denied");
		});
		await test.persistence.saveAs();
		expect(test.persistence.state.path).toBe(destination);
		expect(test.persistence.state.phase).toBe("failed");
		expect(textOf(test.persistence)).toBe("source");
		expect(test.persistence.state.locked).toBe(false);
	});

	it("ignores overlapping lifecycle requests while a dialog is active", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		const wait = deferred();
		test.main.showOpenDialog = async () => {
			await wait.promise;
			return null;
		};
		const operation = test.persistence.open();
		await test.persistence.close();
		expect(test.closed).not.toHaveBeenCalled();
		wait.resolve();
		await operation;
	});
});

describe("recovery ordering", () => {
	it("retries a missing saved-recovery file when its exact saved bytes return", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "saved");
		await test.persistence.flush();
		test.persistence.dispose();
		await rm(test.path);
		const restarted = test.create();
		await restarted.initialize();
		expect(textOf(restarted)).toBe("savedbase");
		expect(restarted.state.phase).toBe("failed");
		await writeFile(test.path, "savedbase");
		await restarted.flush();
		expect(restarted.state.phase).toBe("ready");
		expect(textOf(restarted)).toBe("savedbase");
	});
	it("retries a backing read failure after a placeholder session has loaded", async () => {
		const test = await fixture("original text");
		let reads = 0;
		test.setRead(async (path) => {
			if (path === test.path && reads++ === 0) throw new Error("Temporary backing failure");
		});
		await test.persistence.initialize();
		expect(test.persistence.context).not.toBeNull();
		expect(textOf(test.persistence)).toBe("");
		await test.persistence.flush();
		expect(textOf(test.persistence)).toBe("original text");
		expect(test.persistence.state.phase).toBe("ready");
		expect(await diskText(test.path)).toBe("original text");
	});

	it("retries inaccessible recovery without losing edits accepted before access returned", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "pending");
		await until(() => test.writes.some((request) => request.path.endsWith("recovery.json")));
		test.persistence.dispose();
		let inaccessible = true;
		test.setRead(async (path) => {
			if (path === test.path && inaccessible) throw new Error("Drive unavailable");
		});
		const restarted = test.create();
		await restarted.initialize();
		insert(restarted, "more");
		inaccessible = false;
		await restarted.flush();
		expect(textOf(restarted)).toBe("pendingmorebase");
		expect(await diskText(test.path)).toBe("pendingmorebase");
		expect(restarted.state.phase).toBe("ready");
	});

	it("preserves text entered into an unavailable-file placeholder for Save As", async () => {
		const test = await fixture("unknown original");
		let inaccessible = true;
		test.setRead(async (path) => {
			if (path === test.path && inaccessible) throw new Error("Drive unavailable");
		});
		await test.persistence.initialize();
		insert(test.persistence, "accepted while unavailable");
		inaccessible = false;
		await expect(test.persistence.flush()).rejects.toThrow("Use Save As");
		expect(textOf(test.persistence)).toBe("accepted while unavailable");
		expect(await diskText(test.path)).toBe("unknown original");
		const destination = `${test.directory}/placeholder-rescue.txt`;
		test.chooseSave({ path: destination, hash: null });
		await test.persistence.saveAs();
		expect(await diskText(destination)).toBe("accepted while unavailable");
	});

	it("exposes pending recovery beside undecodable backing bytes and rescues it with Save As", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "pending");
		await until(() => test.writes.some((request) => request.path.endsWith("recovery.json")));
		test.persistence.dispose();
		const invalid = new Uint8Array([255]);
		await writeFile(test.path, invalid);
		const restarted = test.create();
		await restarted.initialize();
		expect(textOf(restarted)).toBe("pendingbase");
		expect(restarted.state.phase).toBe("failed");
		expect(restarted.state.error).toContain("could not be decoded");
		const destination = `${test.directory}/invalid-rescue.txt`;
		test.chooseSave({ path: destination, hash: null });
		await restarted.saveAs();
		expect(await diskText(destination)).toBe("pendingbase");
		expect(new Uint8Array(await readFile(test.path))).toEqual(invalid);
	});
	it("loads matching recovery when the backing file cannot be read", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "pending");
		await until(() => test.writes.some((request) => request.path.endsWith("recovery.json")));
		test.persistence.dispose();
		test.setRead(async (path) => {
			if (path === test.path) throw new Error("Permission denied");
		});
		const restarted = test.create();
		await restarted.initialize();
		expect(textOf(restarted)).toBe("pendingbase");
		expect(restarted.state.error).toContain("Permission denied");
		const destination = `${test.directory}/read-recovery.txt`;
		test.chooseSave({ path: destination, hash: null });
		await restarted.saveAs();
		expect(await diskText(destination)).toBe("pendingbase");
	});
	it("restores occurrence edits whose historical seed exceeds the replacement length", async () => {
		const test = await fixture("longlong\n\f\nlonglong");
		await test.persistence.initialize();
		const context = test.persistence.context!;
		const first = context.document.pages[0]!;
		context.session.view = snapshotView({
			...context.session.view,
			occurrence: {
				seed: "longlong",
				seedPageId: first.id,
				seedRange: { anchor: 0, head: 8 },
				steps: 2,
				matchCase: false,
				allPages: true,
				targets: context.document.pages.map((page) => ({ pageId: page.id, range: { anchor: 0, head: 8 } })),
				primaryTarget: 0,
			},
		});
		insert(test.persistence, "a");
		await until(() => test.writes.some((request) => request.path.endsWith("recovery.json")));
		test.persistence.dispose();
		const restarted = test.create();
		await restarted.initialize();
		expect(textOf(restarted)).toBe("a\n\f\na");
		expect(restarted.state.phase).toBe("ready");
	});
	it.each(["journal", "backing", "state"])(
		"restarts after the %s boundary with the newest recoverable text",
		async (boundary) => {
			const test = await fixture("base");
			await test.persistence.initialize();
			insert(test.persistence, "pending");
			await until(() => test.writes.some((request) => request.path.endsWith("recovery.json")));
			const journal = JSON.parse(await diskText(`${test.directory}/recovery.json`)) as RecoveryRecord;
			if (boundary !== "journal") await writeFile(test.path, encodeText(journal.text, journal.format));
			if (boundary === "state") {
				const state = JSON.parse(await diskText(`${test.directory}/app-state.json`)) as AppState;
				await writeFile(
					`${test.directory}/app-state.json`,
					JSON.stringify({ ...state, savedContentHash: hash(encodeText(journal.text, journal.format)) }),
				);
			}
			test.persistence.dispose();
			const restarted = test.create();
			await restarted.initialize();
			expect(textOf(restarted)).toBe("pendingbase");
			expect(await diskText(test.path)).toBe("pendingbase");
			expect(restarted.state.phase).toBe("ready");
			expect(restarted.context?.document.pages.map((page) => page.id)).toEqual(journal.pageIds);
		},
	);

	it("uses the acknowledged base hash when a newer journal follows an in-flight write", async () => {
		vi.useFakeTimers();
		const test = await fixture("");
		await test.persistence.initialize();
		const wait = deferred();
		let started = false;
		test.setWrite(async (request) => {
			if (request.path === test.path && !started) {
				started = true;
				await wait.promise;
			}
		});
		insert(test.persistence, "a");
		await vi.advanceTimersByTimeAsync(250);
		await until(() => started);
		insert(test.persistence, "b");
		wait.resolve();
		await until(() => test.writes.filter((request) => request.path.endsWith("recovery.json")).length === 2);
		const journal = JSON.parse(await diskText(`${test.directory}/recovery.json`)) as RecoveryRecord;
		expect(journal.text).toBe("ab");
		expect(journal.baseHash).toBe(hash(new TextEncoder().encode("a")));
		test.persistence.dispose();
		const restarted = test.create();
		await restarted.initialize();
		expect(textOf(restarted)).toBe("ab");
		expect(await diskText(test.path)).toBe("ab");
	});

	it("presents conflicting recovery without overwriting either version", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "pending");
		await until(() => test.writes.some((request) => request.path.endsWith("recovery.json")));
		test.persistence.dispose();
		await writeFile(test.path, "external");
		const restarted = test.create();
		await restarted.initialize();
		expect(textOf(restarted)).toBe("pendingbase");
		expect(await diskText(test.path)).toBe("external");
		expect(restarted.state.phase).toBe("failed");
	});

	it("retains a missing last-opened file and pending recovery", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "pending");
		await until(() => test.writes.some((request) => request.path.endsWith("recovery.json")));
		test.persistence.dispose();
		await rm(test.path);
		const restarted = test.create();
		await restarted.initialize();
		expect(restarted.state.path).toBe(test.path);
		expect(textOf(restarted)).toBe("pendingbase");
		expect(await test.read(test.path)).toBeNull();
		expect(restarted.state.phase).toBe("failed");
	});

	it("preserves corrupt recovery and rejects invalid page IDs or selection bounds", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "pending");
		await until(() => test.writes.some((request) => request.path.endsWith("recovery.json")));
		test.persistence.dispose();
		const record = JSON.parse(await diskText(`${test.directory}/recovery.json`)) as RecoveryRecord;
		await writeFile(`${test.directory}/recovery.json`, JSON.stringify({ ...record, pageIds: ["wrong"] }));
		const restarted = test.create();
		await restarted.initialize();
		expect(textOf(restarted)).toBe("base");
		expect(restarted.state.error).toContain("Invalid recovery");
		expect((await readdir(test.directory)).some((name) => /^recovery-.*\.json$/u.test(name))).toBe(true);
	});

	it("retains a recovery journal for a different file without applying it", async () => {
		const test = await fixture("base");
		await test.persistence.initialize();
		insert(test.persistence, "pending");
		await until(() => test.writes.some((request) => request.path.endsWith("recovery.json")));
		test.persistence.dispose();
		const record = JSON.parse(await diskText(`${test.directory}/recovery.json`)) as RecoveryRecord;
		await writeFile(
			`${test.directory}/recovery.json`,
			JSON.stringify({ ...record, path: `${test.directory}/other.txt` }),
		);
		const restarted = test.create();
		await restarted.initialize();
		expect(textOf(restarted)).toBe("base");
		expect((await readdir(test.directory)).some((name) => /^recovery-.*\.json$/u.test(name))).toBe(true);
	});
});
