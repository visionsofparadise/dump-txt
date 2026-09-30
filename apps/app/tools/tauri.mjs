import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTauriPackages } from "./normalizeTauriPackages.mjs";

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL("../", import.meta.url));
const arguments_ = process.argv.slice(2);
const platform = ["android", "ios"].includes(arguments_[0]) ? arguments_.shift() : undefined;
const command = arguments_.shift();
const nativeScript =
	(platform === "ios" && command === "xcode-script") ||
	(platform === "android" && command === "android-studio-script");
const automation = arguments_.includes("--automation");
const supported = new Set(["dev", "build"]);

if (
	(!supported.has(command) && !nativeScript) ||
	(!nativeScript && arguments_.some((argument) => argument !== "--automation")) ||
	(platform && automation)
) {
	throw new Error("Use [android|ios] dev [--automation] or [android|ios] build [--automation]");
}

const environment = { ...process.env };
const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
const cargoDirectory = join(homedir(), ".cargo", "bin");

if (existsSync(cargoDirectory)) {
	environment[pathKey] = `${cargoDirectory}${delimiter}${environment[pathKey] ?? ""}`;
}

const options = { cwd: directory, env: environment, stdio: "inherit", windowsHide: true };
if (command === "dev" && !platform)
	environment.DUMP_TXT_PROFILE ??= fileURLToPath(new URL("../../../.scratch/tauri-dev-profile", import.meta.url));

function run(executable, arguments_) {
	const result = spawnSync(executable, arguments_, options);
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (nativeScript) {
	run(process.execPath, [require.resolve("@tauri-apps/cli/tauri.js"), platform, command, ...arguments_]);
	process.exit(0);
}

async function freePort(host, port) {
	const free = await new Promise((resolve) => {
		const server = createServer()
			.once("error", () => resolve(false))
			.listen(port, host, () => server.close(() => resolve(true)));
	});

	return free ? port : freePort(host, port + 1);
}

const vite = join(require.resolve("vite/package.json"), "..", "bin", "vite.js");
const frontendArguments = ["--config", "vite.tauri.config.ts", "--mode", "production"];
const nativeArguments = platform ? [platform, command] : [command];
if (command === "dev") {
	const host = platform ? "0.0.0.0" : "127.0.0.1";
	const port = await freePort(host, 5173);
	frontendArguments.push("--host", host, "--port", String(port));
	nativeArguments.push("--config", JSON.stringify({ build: { devUrl: `http://127.0.0.1:${port}` } }));
}
if (!platform && (command === "dev" || automation))
	nativeArguments.push(
		"--config",
		JSON.stringify({ identifier: `com.visionsofparadise.dump-txt.${automation ? "test" : "dev"}` }),
	);
if (automation) nativeArguments.push("--features", "automation", "--config", "tauri.automation.conf.json");
if (command === "build") {
	const source = {
		commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim(),
		dirty: execFileSync("git", ["status", "--porcelain"], { cwd: directory, encoding: "utf8" }).trim(),
	};
	run(process.execPath, [vite, "build", ...frontendArguments]);
	nativeArguments.push("--ci");
	if (platform === "android") nativeArguments.push("--debug", "--apk");
	if (platform === "ios") nativeArguments.push("-t", "aarch64-sim");
	if (automation) nativeArguments.push("--no-bundle");
	run(process.execPath, [require.resolve("@tauri-apps/cli/tauri.js"), ...nativeArguments]);
	if (platform === "android") {
		const { version } = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
		console.log("Packages:", normalizeTauriPackages(directory, version, "android", "universal"));
	}
	if (!platform && !automation) {
		const { version } = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
		console.log("Packages:", normalizeTauriPackages(directory, version));
	}
	if (!platform) {
		const executable = join(
			directory,
			"target",
			"release",
			process.platform === "win32" ? "dump-txt.exe" : "dump-txt",
		);
		const bytes = readFileSync(executable);
		mkdirSync(join(directory, ".scratch"), { recursive: true });
		writeFileSync(
			join(directory, ".scratch", "tauri-build.json"),
			JSON.stringify(
				{
					...source,
					automation,
					executable,
					bytes: bytes.length,
					sha256: createHash("sha256").update(bytes).digest("hex"),
					builtAt: new Date().toISOString(),
				},
				null,
				2,
			),
		);
	}
} else {
	const frontend = spawn(process.execPath, [vite, ...frontendArguments], options);
	const native = spawn(process.execPath, [require.resolve("@tauri-apps/cli/tauri.js"), ...nativeArguments], options);
	let stopping = false;
	const stop = (status) => {
		if (stopping) return;
		stopping = true;
		for (const child of [native, frontend]) {
			if (!child.pid || child.exitCode !== null) continue;
			if (process.platform === "win32")
				spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
			else child.kill("SIGTERM");
		}
		process.exit(status);
	};
	for (const child of [native, frontend]) {
		child.on("error", (error) => {
			console.error(error);
			stop(1);
		});
		child.on("exit", (status) => stop(status ?? 1));
	}
	process.on("SIGINT", () => stop(130));
	process.on("SIGTERM", () => stop(143));
}
