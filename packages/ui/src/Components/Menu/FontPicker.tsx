import { CaseSensitive, Check, Search, X } from "lucide-react";
import { scope } from "opshot";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Dialog, DialogContent, DialogTitle } from "../UI/Dialog";
import { FontMenuItem } from "./FontMenuItem";
import type { ChromeContext } from "../../models/ChromeContext";

interface FontPickerProps {
	readonly context: ChromeContext;
}

export const FontPicker = scope(({ context }: FontPickerProps) => {
	const { chrome, session, history, editor, persistenceState, main } = context;
	const open = chrome.fontPickerOpen;
	const currentFont = session.appearance.font;

	const search = useRef<HTMLInputElement>(null);

	const list = useRef<HTMLDivElement>(null);

	const originalFont = useRef(currentFont);

	const wasOpen = useRef(false);

	const [fonts, setFonts] = useState<ReadonlyArray<string>>([]);

	const [query, setQuery] = useState("");

	const [selected, setSelected] = useState(currentFont);

	const [loading, setLoading] = useState(false);

	const [error, setError] = useState<string | null>(null);

	const request = useRef(0);

	const filtered = useMemo(
		() => fonts.filter((font) => font.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
		[fonts, query],
	);

	const load = useCallback(async () => {
		const generation = ++request.current;

		setLoading(true);
		setError(null);

		try {
			const installed = await main.getSystemFonts();

			if (generation === request.current) setFonts(installed);
		} catch (failure) {
			if (generation === request.current)
				setError(failure instanceof Error ? failure.message : "Unable to load installed fonts.");
		} finally {
			if (generation === request.current) setLoading(false);
		}
	}, [main]);

	const dismiss = useCallback(() => {
		if (!chrome.fontPickerOpen) return;

		session.appearance = { ...session.appearance, font: originalFont.current };
		chrome.fontPickerOpen = false;
	}, [chrome, session]);

	const openChanged = useCallback(
		(value: boolean) => {
			if (!value) dismiss();
		},
		[dismiss],
	);

	const restoreFocus = useCallback(
		(event: Event) => {
			event.preventDefault();
			editor.focus();
		},
		[editor],
	);

	const focusSearch = useCallback((event: Event) => {
		event.preventDefault();
		search.current?.focus();
	}, []);

	const selectFont = useCallback(
		(font: string) => {
			if (persistenceState.locked) return;

			setSelected(font);
			session.appearance = { ...session.appearance, font };
		},
		[persistenceState, session],
	);

	const apply = useCallback(() => {
		if (persistenceState.locked || !fonts.includes(selected)) return;

		session.appearance = { ...session.appearance, font: selected };
		chrome.fontPickerOpen = false;
	}, [chrome, fonts, persistenceState, selected, session]);

	const queryChanged = useCallback((event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value), []);

	const retry = useCallback(() => {
		void load();
	}, [load]);

	const navigate = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			const index = filtered.indexOf(selected);
			const next =
				event.key === "ArrowDown"
					? Math.min(filtered.length - 1, index + 1)
					: event.key === "ArrowUp"
						? Math.max(0, index - 1)
						: event.key === "Home"
							? 0
							: event.key === "End"
								? filtered.length - 1
								: null;

			if (next === null) return;

			event.preventDefault();

			const font = filtered[next];

			if (font) {
				selectFont(font);

				const option = list.current?.querySelectorAll<HTMLButtonElement>(".font-option")[next];

				option?.focus();
				option?.scrollIntoView({ block: "nearest" });
			}
		},
		[filtered, selected, selectFont],
	);

	useEffect(() => {
		if (open && !wasOpen.current) {
			originalFont.current = currentFont;
			setSelected(currentFont);
			setQuery("");
			history.closeGroup();
			void load();
		} else if (!open && wasOpen.current) request.current++;

		wasOpen.current = open;
	}, [currentFont, history, load, open]);

	return (
		<Dialog open={open} onOpenChange={openChanged}>
			<DialogContent
				container={context.surface.current}
				className="font-picker"
				aria-describedby={undefined}
				onOpenAutoFocus={focusSearch}
				onCloseAutoFocus={restoreFocus}
			>
				<header className="font-picker-header">
					<DialogTitle>
						<CaseSensitive size={18} aria-hidden />
						Font
					</DialogTitle>
				</header>
				<div className="font-search-field">
					<Search size={16} aria-hidden />
					<input
						ref={search}
						className="font-search"
						aria-label="Search installed fonts"
						value={query}
						onChange={queryChanged}
					/>
				</div>
				<div
					ref={list}
					className="font-list"
					role="listbox"
					aria-label="Installed fonts"
					tabIndex={0}
					onKeyDown={navigate}
					aria-busy={loading}
				>
					{loading ? (
						<p>Loading installed fonts…</p>
					) : error ? (
						<p role="alert">
							{error}{" "}
							<button type="button" className="panel-button" onClick={retry}>
								Retry
							</button>
						</p>
					) : filtered.length ? (
						filtered.map((font) => (
							<FontMenuItem key={font} font={font} selected={selected === font} onSelect={selectFont} />
						))
					) : (
						<p>No matching fonts.</p>
					)}
				</div>
				<footer className="font-picker-actions">
					<button type="button" className="panel-button" onClick={dismiss}>
						<X size={16} aria-hidden />
						Cancel
					</button>
					<button
						type="button"
						className="panel-button"
						onClick={apply}
						disabled={loading || !!error || persistenceState.locked || !fonts.includes(selected)}
					>
						<Check size={16} aria-hidden />
						Apply
					</button>
				</footer>
			</DialogContent>
		</Dialog>
	);
});
