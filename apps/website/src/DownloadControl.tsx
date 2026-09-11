import { motion, type MotionProps } from "motion/react";
import { downloadOptionsOf, megabytesOf } from "./utils/downloadOptionsOf";
import { platformIds, platforms } from "./utils/platforms";
import type { Platform } from "./utils/platformOf";

interface DownloadControlProps {
	readonly manifest: ReleaseManifest;
	readonly platform: Platform;
	readonly optionId: string;
	readonly onPlatformChange: (platform: Platform) => void;
	readonly onOptionChange: (optionId: string) => void;
	readonly entrance: MotionProps;
}

interface PlatformIconProps {
	readonly path: string;
}

function PlatformIcon({ path }: PlatformIconProps) {
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
