import { motion, type MotionProps } from "motion/react";
import { downloadOptionsOf, megabytesOf } from "./utils/downloadOptionsOf";
import type { Platform } from "./utils/platformOf";

interface DownloadControlProps {
	readonly manifest: ReleaseManifest;
	readonly platform: Platform;
	readonly optionId: string;
	readonly onPlatformChange: (platform: Platform) => void;
	readonly onOptionChange: (optionId: string) => void;
	readonly entrance: MotionProps;
}

const platformIds: ReadonlyArray<Platform> = ["windows", "macos", "linux"];

const platforms: Record<Platform, { readonly label: string; readonly icon: string }> = {
	windows: {
		label: "Windows",
		icon: "M3 5.5 11 4.4v7.1H3zM12.5 4.2 21 3v8.5h-8.5zM3 12.5h8v7.1L3 18.5zM12.5 12.5H21V21l-8.5-1.2z",
	},
	macos: {
		label: "macOS",
		icon: "M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.9-.8-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.1.8 1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.7-1-2.7-4.2zM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z",
	},
	linux: {
		label: "Linux",
		icon: "M12 2c-2.5 0-4 2-4 4.8 0 1.2-.3 2-1 3.2-1 1.5-2.3 3.3-2.3 5.4 0 .7.1 1.3.4 1.8-.8.3-1.6.8-1.6 1.6 0 1.1 1.6 1.5 3.3 1.9.9.2 1.6 1.3 3 1.3.8 0 1.4-.3 2.2-.3s1.4.3 2.2.3c1.4 0 2.1-1.1 3-1.3 1.7-.4 3.3-.8 3.3-1.9 0-.8-.8-1.3-1.6-1.6.3-.5.4-1.1.4-1.8 0-2.1-1.3-3.9-2.3-5.4-.7-1.2-1-2-1-3.2C16 4 14.5 2 12 2zm-1.5 4a.8 1 0 1 1 0 2 .8 1 0 0 1 0-2zm3 0a.8 1 0 1 1 0 2 .8 1 0 0 1 0-2zM12 8.5c1 0 2 .5 2 1.1 0 .6-1.2 1.2-2 1.4-.8-.2-2-.8-2-1.4 0-.6 1-1.1 2-1.1zm0 3.5c1.8 0 3.3 2.2 3.3 4.4 0 1.9-1.5 2.8-3.3 2.8s-3.3-.9-3.3-2.8c0-2.2 1.5-4.4 3.3-4.4z",
	},
};

function PlatformIcon({ path }: { readonly path: string }) {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d={path} />
		</svg>
	);
}

export function DownloadControl({
	manifest,
	platform,
	optionId,
	onPlatformChange,
	onOptionChange,
	entrance,
}: DownloadControlProps) {
	const { group, options } = downloadOptionsOf(manifest, platform);
	const option = options.find((candidate) => candidate.id === optionId) ?? options[0];

	if (!option) throw new Error(`No download is available for ${platform}.`);

	return (
		<motion.div id="controls" {...entrance}>
			<div className="download-group" role="group" aria-label={`Platform and ${group.toLowerCase()}`}>
				<span className="radio-group" role="radiogroup" aria-label="Platform">
					{platformIds.map((id) => (
						<button
							key={id}
							className="radio"
							type="button"
							role="radio"
							aria-checked={id === platform}
							onClick={() => onPlatformChange(id)}
						>
							<PlatformIcon path={platforms[id].icon} />
							{platforms[id].label}
						</button>
					))}
				</span>
				<span className="radio-divider" />
				<span className="radio-group" role="radiogroup" aria-label={group}>
					{options.map((candidate) => (
						<button
							key={`${platform}-${candidate.id}`}
							className="radio radio-option"
							type="button"
							role="radio"
							aria-checked={candidate.id === option.id}
							onClick={() => onOptionChange(candidate.id)}
						>
							{candidate.label}
						</button>
					))}
				</span>
			</div>
			<a className="download" href={option.download.url}>
				<span className="download-label">
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M12 15V3" />
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<path d="m7 10 5 5 5-5" />
					</svg>
					<span>Download for</span>
					<span className="download-platform">
						<PlatformIcon path={platforms[platform].icon} />
						{platforms[platform].label}
					</span>
				</span>
				<span className="download-meta">{`v${manifest.version} · ${megabytesOf(option.download.bytes)} MB`}</span>
			</a>
		</motion.div>
	);
}
