import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTauriPackages } from "./normalizeTauriPackages.mjs";

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL("../", import.meta.url));
const [command, ...arguments_] = process.argv.slice(2);
const probe = arguments_.includes("--probe");
const automation = arguments_.includes("--automation");
const supported = new Set(["dev", "build", "check", "fix", "test-native"]);

if (!supported.has(command) || arguments_.some((argument) => !["--probe", "--automation"].includes(argument))) {
	throw new Error("Use dev [--probe] [--automation], build [--probe] [--automation], check, fix or test-native");
}

const environment = { ...process.env };
const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
const cargoDirectory = join(homedir(), ".cargo", "bin");

if (existsSync(cargoDirectory)) {
	environment[pathKey] = `${cargoDirectory}${delimiter}${environment[pathKey] ?? ""}`;
}

const options = { cwd: directory, env: environment, stdio: "inherit", windowsHide: true };
environment.TAURI_TEST_AUTOMATION = automation ? "true" : "false";
if (command === "dev" && !probe) environment.DUMP_TXT_PROFILE ??= join(directory, ".scratch", "tauri-dev-profile");
const cargoManifest = join(directory, "Cargo.toml");

function run(executable, arguments_) {
	const result = spawnSync(executable, arguments_, options);
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (command === "check" || command === "fix") {
	const fixing = command === "fix";
	if (!fixing) run("cargo", ["fmt", "--manifest-path", cargoManifest, "--check"]);
	run("cargo", [
		"clippy",
		...(fixing ? ["--fix", "--allow-dirty", "--allow-staged"] : []),
		"--manifest-path",
		cargoManifest,
		"--all-targets",
		"--features",
		"automation",
		"--",
		"-D",
		"warnings",
	]);
	if (fixing) run("cargo", ["fmt", "--manifest-path", cargoManifest]);
} else if (command === "test-native") {
	run("cargo", ["test", "--manifest-path", cargoManifest, "--features", "probe"]);
} else {
	const vite = join(directory, "node_modules", "vite", "bin", "vite.js");
	const frontendArguments = ["--config", "vite.tauri.config.ts", "--mode", probe ? "probe" : "production"];
	const nativeArguments = [command];
	if (probe)
		nativeArguments.push(
			"--config",
			"tauri.probe.conf.json",
			"--features",
			automation ? "probe,automation" : "probe",
		);
	else if (command === "dev" || automation)
		nativeArguments.push(
			"--config",
			JSON.stringify({ identifier: `com.visionsofparadise.dump-txt.${automation ? "test" : "dev"}` }),
		);
	if (automation) {
		if (!probe) nativeArguments.push("--features", "automation");
		const automationConfig = JSON.parse(readFileSync(join(directory, "tauri.automation.conf.json"), "utf8"));
		automationConfig.app.security.capabilities[0] = probe ? "probe" : "main";
		nativeArguments.push("--config", JSON.stringify(automationConfig));
	}
	if (command === "build") {
		const source = {
			commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim(),
			dirty: execFileSync("git", ["status", "--porcelain"], { cwd: directory, encoding: "utf8" }).trim(),
		};
		run(process.execPath, [vite, "build", ...frontendArguments]);
		nativeArguments.push("--ci");
		if (probe || automation) nativeArguments.push("--no-bundle");
		run(process.execPath, [require.resolve("@tauri-apps/cli/tauri.js"), ...nativeArguments]);
		if (!probe && !automation) {
			const { version } = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
			console.log("Packages:", normalizeTauriPackages(directory, version));
		}
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
					probe,
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
	} else {
		const frontend = spawn(process.execPath, [vite, ...frontendArguments], options);
		const native = spawn(
			process.execPath,
			[require.resolve("@tauri-apps/cli/tauri.js"), ...nativeArguments],
			options,
		);
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
}
