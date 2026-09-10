import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { installAnimationClock } from "./animationClock.mjs";

const application = fileURLToPath(new URL("..", import.meta.url));
const width = 960;
const height = 720;
const fps = 20;
const interval = 1000 / fps;
const maximumFrames = 90 * fps;

export function hashOf(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

export function verifyLoop(first, last) {
	if (hashOf(first) !== hashOf(last)) throw new Error("The final frame does not match the opening frame.");
}

async function movePointer(page) {
	const position = await page.locator(".demo-pointer").boundingBox();
	if (position) await page.mouse.move(position.x, position.y);
	await page.evaluate(() => window.advanceAnimations());
}

export async function render() {
	const git = (arguments_) => execFileSync("git", arguments_, { cwd: application, encoding: "utf8" }).trim();
	const releaseSha = git(["rev-parse", "HEAD"]);
	const sourceDirty = git(["status", "--porcelain", "--untracked-files=all"]) !== "";
	const scratch = join(application, ".scratch");
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(join(scratch, "render-"));
	const frames = join(directory, "frames");
	await mkdir(frames);
	const server = await createServer({ root: application, server: { host: "127.0.0.1", port: 0 } });
	let browser;
	try {
		await server.listen();
		browser = await chromium.launch({ channel: "chromium", args: ["--force-color-profile=srgb"] });
		const page = await browser.newPage({
			viewport: { width, height },
			deviceScaleFactor: 1,
			locale: "en-GB",
			timezoneId: "UTC",
			colorScheme: "light",
		});
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
		await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
		await page.addInitScript(installAnimationClock);
		await page.goto(server.resolvedUrls.local[0]);
		await page.evaluate(() => document.fonts.ready);
		for (let attempt = 0; attempt < 200; attempt += 1) {
			if (await page.evaluate(() => window.demo?.ready)) break;
			await page.clock.runFor(interval);
			await page.evaluate(() => window.advanceAnimations());
		}
		if (!(await page.evaluate(() => window.demo?.ready))) throw new Error("The demonstration did not become ready.");
		await page.clock.runFor(200);
		await page.evaluate(() => window.advanceAnimations());
		await page.addStyleTag({
			content: ".cm-cursor { animation: none !important; } * { caret-color: transparent !important; }",
		});
		await movePointer(page);
		const first = await page.screenshot({ path: join(frames, "00000.png"), caret: "initial" });
		await page.evaluate(() => {
			window.demo.play();
		});
		let frameCount = 1;
		let finished = false;
		for (; frameCount < maximumFrames; frameCount += 1) {
			await page.clock.runFor(interval);
			await page.evaluate(() => window.advanceAnimations());
			const state = await page.evaluate(() => ({ finished: window.demo.finished, error: window.demo.error }));
			if (state.error || errors.length) throw new Error(state.error ?? errors.join("\n"));
			await movePointer(page);
			const frame = await page.screenshot({
				path: join(frames, `${String(frameCount).padStart(5, "0")}.png`),
				caret: "initial",
			});
			if (state.finished) {
				verifyLoop(first, frame);
				frameCount += 1;
				finished = true;
				break;
			}
			if (frameCount % (fps * 10) === 0) process.stdout.write(`Captured ${frameCount / fps}s\n`);
		}
		if (!finished) throw new Error("The demonstration exceeded 90 seconds.");
		await browser.close();
		browser = undefined;
		await server.close();
		process.stdout.write(`Captured ${frameCount} frames; exact loop verified. Generating palette.\n`);
		const output = join(directory, "demo.gif");
		const palette = join(directory, "palette.png");
		const input = [
			"-hide_banner",
			"-loglevel",
			"warning",
			"-threads",
			"2",
			"-framerate",
			String(fps),
			"-i",
			join(frames, "%05d.png"),
		];
		execFileSync(
			"ffmpeg",
			[
				...input,
				"-filter_threads",
				"2",
				"-vf",
				"palettegen=stats_mode=diff",
				"-frames:v",
				"1",
				"-update",
				"1",
				palette,
			],
			{ stdio: "inherit" },
		);
		process.stdout.write("Palette complete. Encoding GIF.\n");
		execFileSync(
			"ffmpeg",
			[
				...input,
				"-i",
				palette,
				"-filter_complex_threads",
				"2",
				"-filter_complex",
				"paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
				"-threads",
				"2",
				"-loop",
				"0",
				output,
			],
			{ stdio: "inherit" },
		);
		const bytes = await readFile(output);
		if (bytes.subarray(0, 6).toString() !== "GIF89a") throw new Error("FFmpeg did not produce a GIF.");
		if (git(["rev-parse", "HEAD"]) !== releaseSha) throw new Error("The source commit changed during capture.");
		const manifest = {
			releaseSha,
			sourceDirty: sourceDirty || git(["status", "--porcelain", "--untracked-files=all"]) !== "",
			width,
			height,
			fps,
			frames: frameCount,
			duration: frameCount / fps,
			sha256: hashOf(bytes),
			loopVerified: true,
		};
		await writeFile(join(directory, "demo.json"), `${JSON.stringify(manifest, null, 2)}\n`);
		const destination = join(application, "out");
		await mkdir(destination, { recursive: true });
		await rename(output, join(destination, "demo.gif"));
		await rename(join(directory, "demo.json"), join(destination, "demo.json"));
		process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
		return manifest;
	} finally {
		await browser?.close();
		await server.close();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	render().catch((error) => {
		process.stderr.write(`${error.stack ?? error}\n`);
		process.exitCode = 1;
	});
}
