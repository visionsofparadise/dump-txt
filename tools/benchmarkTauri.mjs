import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { arch, cpus, platform, release } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { fixture } from "./tauri-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const arguments_ = process.argv.slice(2);
assert.ok(arguments_.every((argument) => argument === "--sizes-only" || /^--runs=\d+$/u.test(argument)));
const sizesOnly = arguments_.includes("--sizes-only");
const runs = Number(arguments_.find((argument) => argument.startsWith("--runs="))?.split("=")[1] ?? 15);
assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 100, "Use --runs=1 through --runs=100");
const directory = path.join(root, ".scratch", "tauri-benchmark", String(Date.now()));
const reportPath = path.join(root, ".scratch", sizesOnly ? "tauri-benchmark-sizes.json" : "tauri-benchmark.json");
const manifestPath = process.env.TAURI_BENCHMARK_MANIFEST ?? path.join(root, ".scratch", "tauri-build.json");
const execute = promisify(execFile);
const compress = promisify(gzip);
const source = await readFile(fileURLToPath(import.meta.url));
const report = {
	startedAt: new Date().toISOString(),
	directory,
	harness: { sha256: createHash("sha256").update(source).digest("hex"), source: "benchmarkTauri.mjs" },
	host: { platform: platform(), architecture: arch(), release: release(), processor: cpus()[0]?.model },
	method: {
		mode: sizesOnly ? "Artifact sizes only" : "Paired warm launches",
		cache: "Warm-cache launches after one discarded launch per application; no reboot or filesystem-cache flush",
		schedule: "Alternating application order in paired rounds, Electron first on even rounds",
		readiness: "Process spawn to existing dump:editor-ready renderer performance mark, using the same CDP query",
		readinessDecomposition:
			"Before-document is spawn to renderer performance.timeOrigin; renderer-ready is document origin to the editor mark. This boundary does not identify a particular native startup operation",
		instrumentation:
			"Both shells enable localhost remote debugging; timings include its startup overhead and do not measure uninstrumented visible startup",
		paint: "Renderer first-contentful-paint when available, including possible loading content; themed DOM observation is an upper bound after CDP attachment",
		nativeVisibleDisplay: "Pending; CDP renderer paint cannot establish the first visible themed native window",
		storage: "Electron reads a synthetic file/settings from disk; Tauri probe uses its built-in virtual filesystem",
		memory:
			"Windows descendant-process private committed bytes and working-set sums, sampled after one second idle; shared resident pages can be counted more than once",
		runtime:
			"WebView2 processes attributable to the probe are included in its tree; shared installed runtime disk bytes are reported separately",
	},
	fixture: { bytes: fixture.bytes, sha256: fixture.sha256 },
	artifacts: {},
	launches: [],
	failures: [],
};

await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, "benchmarkTauri.mjs"), source);

async function bytesOf(directory) {
	let bytes = 0;
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const location = path.join(directory, entry.name);
		if (entry.isDirectory()) bytes += await bytesOf(location);
		else if (entry.isFile()) bytes += (await stat(location)).size;
	}
	return bytes;
}

async function treeIdentityOf(directory) {
	const files = [];
	async function collect(relative) {
		for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
			const location = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await collect(location);
			else {
				assert.ok(entry.isFile(), `Package identity requires regular files: ${location}`);
				files.push(location);
			}
		}
	}
	await collect("");
	const digest = createHash("sha256");
	for (const relative of files.sort()) {
		const hash = createHash("sha256")
			.update(await readFile(path.join(directory, relative)))
			.digest("hex");
		digest.update(`${relative}\0${hash}\n`);
	}
	return digest.digest("hex");
}

async function powershell(script, environment = {}) {
	const result = await execute(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
		{ windowsHide: true, encoding: "utf8", timeout: 30000, env: { ...process.env, ...environment } },
	);
	return JSON.parse(result.stdout.trim() || "null");
}

async function memoryOf(identifier, profile) {
	const snapshot = await powershell(
		`$ErrorActionPreference = 'Stop'
$benchmarkProcesses = @(Get-CimInstance Win32_Process)
$benchmarkById = @{}
foreach ($benchmarkProcess in $benchmarkProcesses) { $benchmarkById[[int]$benchmarkProcess.ProcessId] = $benchmarkProcess }
$benchmarkRoot = $benchmarkById[[int]$env:DUMP_BENCHMARK_PROCESS]
if (!$benchmarkRoot) { throw 'The measured application process is missing' }
$benchmarkIdentifiers = [System.Collections.Generic.HashSet[int]]::new()
[void]$benchmarkIdentifiers.Add([int]$env:DUMP_BENCHMARK_PROCESS)
do {
    $benchmarkChanged = $false
    foreach ($benchmarkProcess in $benchmarkProcesses) {
        if ($benchmarkIdentifiers.Contains([int]$benchmarkProcess.ParentProcessId)) {
            $benchmarkParent = $benchmarkById[[int]$benchmarkProcess.ParentProcessId]
            if ($benchmarkProcess.CreationDate -ge $benchmarkParent.CreationDate -and $benchmarkProcess.CreationDate -ge $benchmarkRoot.CreationDate) {
                if ($benchmarkIdentifiers.Add([int]$benchmarkProcess.ProcessId)) { $benchmarkChanged = $true }
            }
        }
    }
} while ($benchmarkChanged)
$benchmarkOwned = @($benchmarkProcesses | Where-Object { $benchmarkIdentifiers.Contains([int]$_.ProcessId) })
$benchmarkRows = @($benchmarkOwned | ForEach-Object {
    [pscustomobject]@{
        id = [int]$_.ProcessId
        parentId = [int]$_.ParentProcessId
        name = $_.Name
        createdAt = $_.CreationDate.ToUniversalTime().ToString('o')
        workingSetBytes = [double]$_.WorkingSetSize
        privateBytes = [double]$_.PrivatePageCount
        executable = $_.ExecutablePath
        profileMatched = ($_.CommandLine -and $_.CommandLine.Replace('/', [char]92).Contains($env:DUMP_BENCHMARK_PROFILE.Replace('/', [char]92)))
    }
})
ConvertTo-Json -Depth 5 -Compress -InputObject $benchmarkRows`,
		{ DUMP_BENCHMARK_PROCESS: String(identifier), DUMP_BENCHMARK_PROFILE: profile },
	);
	assert.ok(
		snapshot.some((process) => process.id === identifier),
		"The measured application process is missing",
	);
	assert.ok(
		snapshot.some((process) => process.profileMatched),
		"The isolated browser profile was not observed",
	);
	const runtime = snapshot.filter((process) => process.name.toLowerCase() === "msedgewebview2.exe");
	const sum = (processes, field) => processes.reduce((total, process) => total + process[field], 0);
	return {
		observedAt: new Date().toISOString(),
		processes: snapshot,
		privateBytes: sum(snapshot, "privateBytes"),
		workingSetBytes: sum(snapshot, "workingSetBytes"),
		webview2PrivateBytes: sum(runtime, "privateBytes"),
		webview2WorkingSetBytes: sum(runtime, "workingSetBytes"),
	};
}

async function stopRemaining(processes) {
	if (!processes.length) return;
	await powershell(
		`$ErrorActionPreference = 'Stop'
$benchmarkOwned = ConvertFrom-Json -InputObject $env:DUMP_BENCHMARK_OWNED
foreach ($benchmarkPrevious in $benchmarkOwned) {
    $benchmarkCurrent = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$benchmarkPrevious.id)
    if ($benchmarkCurrent -and $benchmarkCurrent.CreationDate.ToUniversalTime().ToString('o') -eq $benchmarkPrevious.createdAt) {
        Stop-Process -Id ([int]$benchmarkPrevious.id) -Force -ErrorAction SilentlyContinue
    }
}
'null'`,
		{ DUMP_BENCHMARK_OWNED: JSON.stringify(processes.map(({ id, createdAt }) => ({ id, createdAt }))) },
	);
}

async function portOf() {
	const server = createServer();
	const listening = once(server, "listening");
	server.listen(0, "127.0.0.1");
	await listening;
	try {
		return server.address().port;
	} finally {
		await promisify(server.close.bind(server))();
	}
}

async function connectionOf(child, port) {
	const deadline = Date.now() + 30000;
	let target;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`Application exited before CDP connected (${child.exitCode})`);
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
			target = (await response.json()).find((target) => target.type === "page");
			if (target) break;
		} catch (error) {
			if (Date.now() >= deadline) throw error;
		}
		await delay(10);
	}
	assert.ok(target, "The application did not expose its renderer through CDP");
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.close();
			reject(new Error("The renderer WebSocket did not connect"));
		}, 5000);
		socket.addEventListener(
			"open",
			() => {
				clearTimeout(timeout);
				resolve();
			},
			{ once: true },
		);
		socket.addEventListener(
			"error",
			(error) => {
				clearTimeout(timeout);
				reject(error);
			},
			{ once: true },
		);
	});
	let identifier = 0;
	const pending = new Map();
	socket.addEventListener("message", ({ data }) => {
		const message = JSON.parse(data);
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		clearTimeout(entry.timeout);
		if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
		else entry.resolve(message.result);
	});
	socket.addEventListener("close", () => {
		for (const entry of pending.values()) {
			clearTimeout(entry.timeout);
			entry.reject(new Error("The CDP renderer connection closed"));
		}
		pending.clear();
	});
	return {
		close: () => socket.close(),
		send: (method, parameters = {}) =>
			new Promise((resolve, reject) => {
				const id = ++identifier;
				const timeout = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`CDP timeout: ${method}`));
				}, 10000);
				pending.set(id, { resolve, reject, timeout });
				socket.send(JSON.stringify({ id, method, params: parameters }));
			}),
	};
}

async function launch(label, executable, profile, round) {
	const port = await portOf();
	const browserArguments = `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`;
	const environment = { ...process.env };
	if (label === "tauri") {
		environment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = browserArguments;
		environment.WEBVIEW2_USER_DATA_FOLDER = profile;
	}
	const started = Date.now();
	const child = spawn(
		executable,
		label === "electron" ? [...browserArguments.split(" "), `--user-data-dir=${profile}`] : [],
		{ cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: environment },
	);
	let output = "";
	child.stdout.on("data", (bytes) => {
		output += bytes.toString();
	});
	child.stderr.on("data", (bytes) => {
		output += bytes.toString();
	});
	const startupError = new Promise((_, reject) => child.once("error", reject));
	const exited = new Promise((resolve) => child.once("exit", resolve));
	let connection;
	let memory;
	try {
		connection = await Promise.race([connectionOf(child, port), startupError]);
		const evaluate = async (expression, awaitPromise = false) => {
			const response = await connection.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
			if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
			return response.result.value;
		};
		let metrics;
		let themedDomObservedMs = null;
		const deadline = Date.now() + 30000;
		while (Date.now() < deadline) {
			metrics = await evaluate(`(() => {
if (!document.body) return null;
const scroller = document.querySelector('.page-current .cm-scroller');
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const surface = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim();
const background = getComputedStyle(document.body).backgroundColor;
return { origin: performance.timeOrigin, ready: performance.getEntriesByName('dump:editor-ready')[0]?.startTime ?? null,
    firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    dark, surface, background, themed: !!scroller && document.documentElement.dataset.theme === 'system' && background === (dark ? 'rgb(44, 44, 44)' : 'rgb(250, 250, 250)'),
    page: document.querySelector('.page-count')?.textContent.trim() ?? null,
    text: scroller ? [...scroller.querySelectorAll('.cm-line')].map(line => line.textContent).join(String.fromCharCode(10)) : null,
    font: scroller ? getComputedStyle(scroller).fontFamily : null,
    textSize: scroller ? getComputedStyle(scroller).fontSize : null,
    userAgent: navigator.userAgent, href: location.href };
})()`);
			if (!metrics) {
				await delay(10);
				continue;
			}
			if (metrics.themed && themedDomObservedMs === null) themedDomObservedMs = Date.now() - started;
			if (metrics.ready !== null && metrics.text === fixture.pages[0]) break;
			await delay(10);
		}
		assert.ok(Number.isFinite(metrics?.ready), "The editor readiness mark is missing");
		assert.ok(metrics.themed, "The common system theme was not observed");
		assert.equal(metrics.text, fixture.pages[0], "The application did not load the common fixture");
		assert.ok(metrics.page?.includes("1 / 3"), "The expected three fixture pages are missing");
		if (label === "tauri") assert.equal(new URL(metrics.href).pathname, "/probe.html");
		await delay(1000);
		metrics.firstContentfulPaint = await evaluate(
			"performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null",
		);
		memory = await memoryOf(child.pid, profile);
		const result = {
			label,
			round,
			warmup: round === 0,
			startedAt: new Date(started).toISOString(),
			readyMs: metrics.origin + metrics.ready - started,
			rendererReadyMs: metrics.ready,
			firstContentfulPaintMs:
				metrics.firstContentfulPaint === null ? null : metrics.origin + metrics.firstContentfulPaint - started,
			themedDomObservedMs,
			nativeVisibleDisplayMs: null,
			metrics,
			memory,
		};
		await evaluate(
			label === "electron"
				? "setTimeout(() => window.main.finishClose(), 50)"
				: "setTimeout(() => window.__TAURI_INTERNALS__.invoke('finish_close', {request: {}}), 50)",
		);
		await Promise.race([
			exited,
			delay(5000).then(() => {
				throw new Error("Application close timed out");
			}),
		]);
		return result;
	} finally {
		connection?.close();
		if (child.exitCode === null && child.pid)
			spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
		await stopRemaining(memory?.processes ?? []);
		await writeFile(path.join(directory, `${round}-${label}.log`), output);
	}
}

function summaryOf(values) {
	const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
	if (!sorted.length) return null;
	const middle = Math.floor(sorted.length / 2);
	return {
		count: sorted.length,
		median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
		p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
		min: sorted[0],
		max: sorted.at(-1),
	};
}

try {
	const baseline = JSON.parse(await readFile(path.join(root, ".scratch", "tauri-baseline.json"), "utf8"));
	const build = JSON.parse(await readFile(manifestPath, "utf8"));
	assert.equal(build.probe, true, "Build the isolated Tauri probe before benchmarking");
	assert.equal(build.automation, false, "Benchmark the ordinary probe without test plugins");
	const native = await readFile(build.executable);
	assert.equal(createHash("sha256").update(native).digest("hex"), build.sha256, "Tauri build hash differs");
	assert.equal(native.length, build.bytes, "Tauri build size differs");
	report.build = build;
	report.baseline = baseline;
	report.artifacts.tauri = {
		executableBytes: native.length,
		gzipExecutableBytes: (await compress(native, { level: 9 })).length,
		compression: "gzip of the standalone executable; size proxy, not an NSIS installer",
		installerBytes: null,
	};
	const electron = baseline.windows;
	if (platform() === "win32") {
		assert.match(
			electron.treeSha256 ?? "",
			/^[a-f0-9]{64}$/u,
			"The preserved Electron package needs a verified tree hash",
		);
		assert.ok(electron.installerPath, "The preserved Electron installer path is required for verification");
		const installer = await readFile(electron.installerPath);
		assert.equal(
			createHash("sha256").update(installer).digest("hex"),
			electron.installerSha256,
			"Preserved Electron installer hash differs",
		);
		assert.equal(installer.length, electron.installerBytes, "Preserved Electron installer size differs");
		report.artifacts.electron = {
			treeSha256: await treeIdentityOf(electron.package),
			executableSha256: createHash("sha256")
				.update(await readFile(electron.executable))
				.digest("hex"),
			unpackedBytes: await bytesOf(electron.package),
			releasedInstallerBytes: electron.installerBytes,
			installerSha256: electron.installerSha256,
			provenance: electron.provenance,
		};
		assert.equal(
			report.artifacts.electron.treeSha256,
			electron.treeSha256,
			"Preserved Electron package tree hash differs",
		);
		assert.equal(
			report.artifacts.electron.unpackedBytes,
			electron.unpackedBytes,
			"Preserved Electron package size changed",
		);
	}
	if (!sizesOnly) {
		assert.equal(
			platform(),
			"win32",
			"Paired CDP startup/memory measurement currently supports Windows; use --sizes-only elsewhere",
		);
		const profiles = {
			electron: path.join(directory, "electron-profile"),
			tauri: path.join(directory, "tauri-webview-profile"),
		};
		await Promise.all(Object.values(profiles).map((profile) => mkdir(profile, { recursive: true })));
		const fixturePath = path.join(profiles.electron, "dump.txt");
		await writeFile(fixturePath, fixture.text);
		await writeFile(
			path.join(profiles.electron, "app-state.json"),
			JSON.stringify({
				version: 1,
				activePath: fixturePath,
				savedContentHash: fixture.sha256,
				activePageIndex: 0,
				appearance: { theme: "system", font: "Consolas", textSize: 11, showStatusBar: true },
				findPreferences: { matchCase: false, allPages: false },
				occurrencePreferences: { matchCase: false, allPages: false },
				windowBounds: null,
				selections: fixture.pages.map(() => ({ ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 })),
			}),
		);
		for (let round = 0; round <= runs; round++) {
			for (const label of round % 2 ? ["tauri", "electron"] : ["electron", "tauri"]) {
				const result = await launch(
					label,
					label === "electron" ? electron.executable : build.executable,
					profiles[label],
					round,
				);
				const first = report.launches[0];
				if (first) {
					for (const field of ["font", "textSize", "dark", "background"])
						assert.equal(result.metrics[field], first.metrics[field], `The common appearance differs: ${field}`);
				}
				report.launches.push(result);
				await writeFile(reportPath, JSON.stringify(report, null, 2));
				console.log(
					JSON.stringify({ label, round, readyMs: result.readyMs, privateBytes: result.memory.privateBytes }),
				);
				await delay(250);
			}
		}
		report.summaries = {};
		for (const label of ["electron", "tauri"]) {
			const measured = report.launches.filter((launch) => launch.label === label && !launch.warmup);
			report.summaries[label] = {
				readyMs: summaryOf(measured.map((launch) => launch.readyMs)),
				beforeDocumentMs: summaryOf(measured.map((launch) => launch.readyMs - launch.rendererReadyMs)),
				rendererReadyMs: summaryOf(measured.map((launch) => launch.rendererReadyMs)),
				firstContentfulPaintMs: summaryOf(measured.map((launch) => launch.firstContentfulPaintMs)),
				privateBytes: summaryOf(measured.map((launch) => launch.memory.privateBytes)),
				workingSetBytes: summaryOf(measured.map((launch) => launch.memory.workingSetBytes)),
			};
		}
		report.pairedReadyDifferenceMs = summaryOf(
			Array.from({ length: runs }, (_, index) => {
				const pair = report.launches.filter((launch) => launch.round === index + 1);
				return (
					pair.find((launch) => launch.label === "tauri").readyMs -
					pair.find((launch) => launch.label === "electron").readyMs
				);
			}),
		);
		const runtime = report.launches
			.flatMap((launch) => launch.memory.processes)
			.find((process) => process.name.toLowerCase() === "msedgewebview2.exe");
		if (runtime?.executable) {
			const installation = path.dirname(runtime.executable);
			report.sharedWebview2Installation = {
				directory: installation,
				unpackedBytes: await bytesOf(installation),
				attribution: "Shared system installation, not added to each app download",
			};
		}
	}
} catch (error) {
	report.failures.push(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(reportPath, JSON.stringify(report, null, 2));
	await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ report: reportPath, summaries: report.summaries, failures: report.failures }, null, 2));
}
