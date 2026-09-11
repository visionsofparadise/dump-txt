import { motion, MotionConfig, type Variants } from "motion/react";
import { useState } from "react";
import { AppBox } from "./AppBox";
import background1280 from "./assets/background-1280.webp";
import background1920 from "./assets/background-1920.webp";
import background3840 from "./assets/background-3840.webp";
import { DownloadControl } from "./DownloadControl";
import { downloadOptionsOf } from "./utils/downloadOptionsOf";
import { platformOf, type Platform } from "./utils/platformOf";

const EASE = [0.16, 1, 0.3, 1] as const;

function appVariantsOf(isMobile: boolean): Variants {
	return {
		hidden: isMobile ? { opacity: 0, y: 40 } : { opacity: 0, x: 96 },
		visible: { opacity: 1, x: 0, y: 0, transition: { duration: 1.1, ease: EASE } },
	};
}

function buttonsVariantsOf(isMobile: boolean): Variants {
	return {
		hidden: { opacity: 0, y: isMobile ? 20 : 40 },
		visible: { opacity: 1, y: 0, transition: { duration: 0.9, delay: 0.3, ease: EASE } },
	};
}

const headlineVariants: Variants = {
	hidden: { opacity: 0 },
	visible: { opacity: 1, transition: { duration: 2, delay: 0.65, ease: EASE } },
};

function firstOptionIdOf(platform: Platform): string {
	return downloadOptionsOf(releaseManifest, platform).options[0]?.id ?? "";
}

export function Website() {
	const [platform, setPlatform] = useState(() => platformOf(navigator));

	const [optionId, setOptionId] = useState(() => firstOptionIdOf(platform));

	const [{ appVariants, buttonsVariants }] = useState(() => {
		const isMobile = matchMedia("(max-width: 999px)").matches;

		return { appVariants: appVariantsOf(isMobile), buttonsVariants: buttonsVariantsOf(isMobile) };
	});

	const selectPlatform = (next: Platform) => {
		setPlatform(next);
		setOptionId(firstOptionIdOf(next));
	};

	return (
		<MotionConfig reducedMotion="user">
			<div className="page">
				<img
					id="bg"
					src={background1920}
					srcSet={`${background1280} 1280w, ${background1920} 1920w, ${background3840} 3840w`}
					sizes="100vw"
					fetchPriority="high"
					alt=""
				/>
				<main id="hero">
					<motion.h1
						id="headline"
						variants={headlineVariants}
						initial="hidden"
						whileInView="visible"
						viewport={{ once: true }}
					>
						<span className="headline-dump">
							Dump te<span className="headline-x">x</span>
							<span className="headline-t">t,</span>
						</span>
						<em className="headline-think">
							think <span className="headline-less">less.</span>
						</em>
					</motion.h1>
					<DownloadControl
						manifest={releaseManifest}
						platform={platform}
						optionId={optionId}
						onPlatformChange={selectPlatform}
						onOptionChange={setOptionId}
						variants={buttonsVariants}
					/>
					<motion.a
						id="github"
						href="https://github.com/visionsofparadise/dump-txt"
						aria-label="GitHub"
						variants={buttonsVariants}
						initial="hidden"
						whileInView="visible"
						viewport={{ once: true }}
					>
						<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
							<path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
						</svg>
					</motion.a>
					<AppBox platform={platform} variants={appVariants} />
				</main>
			</div>
		</MotionConfig>
	);
}
