import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function testWindowChrome(browser, native, folder) {
	const observations = [{ method: native.method }];
	const record = (name, actual, expected = true) => {
		observations.push({ name, actual, expected });
		assert.deepEqual(actual, expected, name);
	};
	const waitFor = (predicate) => browser.waitUntil(predicate, { timeout: 15000, interval: 100 });
	const menuOpen = () => browser.execute(() => !!document.querySelector(".menu-content"));
	const dismiss = () => native.click(process.platform === "linux" ? ".page-current .cm-line" : ".app-name");
	try {
		await native.restore();
		await browser.execute(() => {
			window.chromeTestPointerEvents = [];
			document.addEventListener(
				"pointerdown",
				(event) => {
					if (event.target.closest?.('[aria-label="App menu"]'))
						window.chromeTestPointerEvents.push({ trusted: event.isTrusted });
				},
				true,
			);
		});
		for (const theme of ["light", "dark"]) {
			await native.click('[aria-label="App menu"]');
			await waitFor(menuOpen);
			await browser.execute(() => {
				const appearance = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
					item.textContent.startsWith("Appearance"),
				);
				if (!appearance) throw new Error("Appearance menu missing");
				appearance.dataset.chromeTest = "appearance";
			});
			await native.click('[data-chrome-test="appearance"]');
			await waitFor(() => browser.execute(() => !!document.querySelector('[role="menuitemradio"]')));
			await browser.execute((value) => {
				const option = [...document.querySelectorAll('[role="menuitemradio"]')].find(
					(item) => item.textContent.trim().toLowerCase() === value,
				);
				if (!option) throw new Error(`Theme option missing: ${value}`);
				option.dataset.chromeTest = "theme";
			}, theme);
			await native.click('[data-chrome-test="theme"]');
			await waitFor(() => browser.execute((value) => document.documentElement.dataset.theme === value, theme));
			if (await menuOpen()) await dismiss();
			await waitFor(async () => !(await menuOpen()));
			await delay(300);
			await native.screenshot(`layout-${theme}`);
			const layout = await browser.execute(() => {
				const rectangle = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null;
				return {
					width: innerWidth,
					height: innerHeight,
					menu: rectangle('[aria-label="App menu"]'),
					title: rectangle(".app-name"),
					header: rectangle(".title-bar"),
					controls: rectangle(".window-controls"),
					up: rectangle(".page-bar"),
					insert: rectangle('[aria-label="Insert page above"]'),
					viewport: rectangle(".page-viewport"),
					bars: [...document.querySelectorAll(".page-bar")].map((bar) => bar.getBoundingClientRect().height),
				};
			});
			const windowState = await native.state();
			observations.push({ theme, layout, native: windowState });
			record(
				`${theme}: page bars remain 40px`,
				layout.bars.every((height) => height === 40),
			);
			record(`${theme}: editor clears upper bar`, Math.abs(layout.viewport.top - layout.up.bottom) <= 1);
			if (process.platform === "linux") {
				record(`${theme}: Linux uses native title bar`, layout.header, null);
				record(
					`${theme}: Linux menu follows insertion button`,
					Math.abs(layout.menu.left - layout.insert.right) <= 1,
				);
				record(`${theme}: Linux menu sits in upper bar`, layout.menu.top, layout.up.top);
			} else {
				record(
					`${theme}: filename stays centered`,
					Math.abs((layout.title.left + layout.title.right) / 2 - layout.width / 2) <= 1,
				);
				record(`${theme}: title bar remains 40px`, layout.header.height, 40);
				if (process.platform === "darwin") {
					record(`${theme}: three native traffic lights exist`, windowState.controls.length, 3);
					for (const control of windowState.controls) {
						const right = control.x + control.width - windowState.clientX;
						const top = control.y - windowState.clientY;
						record(
							`${theme}: ${control.name} clears title and menu`,
							right <= layout.title.left && right <= layout.menu.left,
						);
						record(
							`${theme}: ${control.name} fits title bar`,
							top >= 0 && top + control.height <= layout.header.bottom,
						);
					}
					record(`${theme}: Mac menu stays on right edge`, Math.abs(layout.menu.right - layout.width) <= 1);
					record(
						`${theme}: Mac reserves traffic-light space`,
						layout.title.left >= 138 && layout.menu.left >= 138,
					);
				} else {
					record(`${theme}: Windows menu stays on left edge`, layout.menu.left, 0);
					record(`${theme}: Windows title clears controls`, layout.title.right <= layout.controls.left);
				}
			}
			await native.click('[aria-label="App menu"]');
			await waitFor(menuOpen);
			await delay(200);
			const dropdown = await browser.execute(() => {
				const panel = document.querySelector(".menu-content").getBoundingClientRect();
				const trigger = document.querySelector('[aria-label="App menu"]').getBoundingClientRect();
				return {
					edge: window.dumpPlatform === "macos" ? panel.right - trigger.right : panel.left - trigger.left,
					below: panel.top >= trigger.bottom - 1,
					inside: panel.left >= -1 && panel.right <= innerWidth + 1 && panel.bottom <= innerHeight + 1,
				};
			});
			record(`${theme}: dropdown aligns with trigger`, Math.abs(dropdown.edge) <= 1);
			record(`${theme}: dropdown stays below trigger`, dropdown.below);
			record(`${theme}: dropdown stays within window`, dropdown.inside);
			await native.screenshot(`menu-${theme}`);
			await dismiss();
			await waitFor(async () => !(await menuOpen()));
		}
		const pointerEvents = await browser.execute(() => window.chromeTestPointerEvents);
		record(
			"OS menu clicks arrive as trusted pointer events",
			pointerEvents.length >= 4 && pointerEvents.every((event) => event.trusted),
		);
		const before = await native.state();
		await native.drag(process.platform === "linux" ? null : ".app-name", 60, 40);
		await waitFor(async () => {
			const after = await native.state();
			return Math.abs(after.x - before.x) > 20 || Math.abs(after.y - before.y) > 20;
		});
		record("native title-bar drag moves window", true);
		const unzoomed = await native.state();
		await native.maximize();
		await waitFor(async () => {
			const current = await native.state();
			return process.platform === "darwin"
				? Math.abs(current.width - unzoomed.width) > 10 || Math.abs(current.height - unzoomed.height) > 10
				: current.maximized;
		});
		record("maximize or native zoom control changes window state", true);
		await native.screenshot("maximized");
		if (process.platform === "darwin") await native.maximize();
		else await native.restore();
		await waitFor(async () => {
			const current = await native.state();
			return Math.abs(current.width - unzoomed.width) <= 2 && Math.abs(current.height - unzoomed.height) <= 2;
		});
		record("restore returns to original window dimensions", true);
		await native.minimize();
		await waitFor(async () => (await native.state()).minimized);
		record("minimize control changes native window state", true);
		await native.restore();
		await waitFor(async () => !(await native.state()).minimized);
	} catch (error) {
		observations.push({ failure: error.stack ?? String(error) });
		await native.screenshot("chrome-failure").catch(() => undefined);
		throw error;
	} finally {
		await writeFile(path.join(folder, "window-chrome.json"), JSON.stringify(observations, null, 2));
	}
}
