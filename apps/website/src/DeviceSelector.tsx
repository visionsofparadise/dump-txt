import type { Platform } from "./utils/platformOf";

interface DeviceSelectorProps {
	readonly isMobile: boolean;
	readonly onPlatformChange: (platform: Platform) => void;
}

export function DeviceSelector({ isMobile, onPlatformChange }: DeviceSelectorProps) {
	return (
		<span className="radio-group device-group" role="radiogroup" aria-label="Device">
			{[false, true].map((mobile) => (
				<button
					key={String(mobile)}
					className="radio radio-device"
					type="button"
					role="radio"
					aria-label={mobile ? "Mobile" : "Desktop"}
					title={mobile ? "Mobile" : "Desktop"}
					aria-checked={mobile === isMobile}
					onClick={() => {
						if (mobile !== isMobile) onPlatformChange(mobile ? "ios" : "windows");
					}}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						{mobile ? (
							<>
								<rect x="6" y="2" width="12" height="20" rx="2.5" />
								<path d="M11 18h2" />
							</>
						) : (
							<>
								<rect x="2" y="4" width="20" height="13" rx="2" />
								<path d="M8 21h8M12 17v4" />
							</>
						)}
					</svg>
				</button>
			))}
		</span>
	);
}
