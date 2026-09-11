import {
	motion,
	MotionConfig,
	type MotionProps,
	type TargetAndTransition,
	type Transition,
	type Variants,
} from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppBox } from "./AppBox";
import hills1280 from "./assets/hills-1280.webp";
import hills1920 from "./assets/hills-1920.webp";
import hills3840 from "./assets/hills-3840.webp";
import sky1280 from "./assets/sky-1280.webp";
import sky1920 from "./assets/sky-1920.webp";
import sky3840 from "./assets/sky-3840.webp";
import { DownloadControl } from "./DownloadControl";
import { downloadOptionsOf } from "./utils/downloadOptionsOf";
import { platformOf, type Platform } from "./utils/platformOf";

const easeOut = [0.16, 1, 0.3, 1] as const;

const headlineEase = [0.3, 0.6, 0.2, 1] as const;

const instant: Transition = { duration: 0 };

const entranceViewport = { once: true, amount: 0.15 } as const;

const skyTiles = [0, 1, 2, 3] as const;

const skySources = `${sky1280} 1280w, ${sky1920} 1920w, ${sky3840} 3840w`;

const hillsSources = `${hills1280} 1280w, ${hills1920} 1920w, ${hills3840} 3840w`;

const backgroundSizes = "calc(100vh * 5504 / 3072)";

interface Entrance {
	readonly app: Variants;
	readonly tilt: Variants;
	readonly controls: Variants;
	readonly github: Variants;
	readonly headline: Variants;
}

function variantsOf(hidden: TargetAndTransition, visible: TargetAndTransition, transition: Transition): Variants {
	return { hidden, visible: { ...visible, transition } };
}

function entranceOf(isMobile: boolean, isReducedMotion: boolean): Entrance {
	const timingOf = (transition: Transition) => (isReducedMotion ? instant : transition);
	const riseOf = (distance: number, delay: number, duration: number) =>
		variantsOf({ opacity: 0, y: distance }, { opacity: 1, y: 0 }, timingOf({ duration, delay, ease: easeOut }));
	const fadeOf = (delay: number) =>
		variantsOf({ opacity: 0 }, { opacity: 1 }, timingOf({ duration: 1.8, delay, ease: headlineEase }));

	if (isMobile)
		return {
			app: riseOf(28, 0.15, 1.2),
			tilt: {},
			controls: riseOf(20, 0.2, 1),
			github: riseOf(20, 0.35, 1),
			headline: fadeOf(0.1),
		};

	return {
		app: variantsOf({ opacity: 0, x: -160 }, { opacity: 1, x: 0 }, timingOf({ duration: 1.2, ease: easeOut })),
		tilt: variantsOf(
			{ transform: "perspective(2400px) rotateY(0deg)" },
			{ transform: "perspective(2400px) rotateY(-9deg)" },
			timingOf({ duration: 1.2, ease: easeOut }),
		),
		controls: riseOf(40, 0.35, 1),
		github: riseOf(40, 0.5, 1),
		headline: fadeOf(0.65),
	};
}

function sectionOf(variants: Variants, isEntranceReady: boolean): MotionProps {
	return {
		variants,
		initial: "hidden",
		whileInView: isEntranceReady ? "visible" : undefined,
		viewport: entranceViewport,
	};
}

function firstOptionIdOf(platform: Platform): string {
	return downloadOptionsOf(releaseManifest, platform).options[0]?.id ?? "";
}

export function Website() {
	const background = useRef<HTMLDivElement>(null);

	const [platform, setPlatform] = useState(() => platformOf(navigator));

	const [optionId, setOptionId] = useState(() => firstOptionIdOf(platform));

	const [entrance] = useState(() =>
		entranceOf(matchMedia("(max-width: 999px)").matches, matchMedia("(prefers-reduced-motion: reduce)").matches),
	);

	const [isPageReady, setPageReady] = useState(false);

	const [isApplicationReady, setApplicationReady] = useState(false);

	const isEntranceReady = isPageReady && isApplicationReady;

	const sections = useMemo(
		() => ({
			app: sectionOf(entrance.app, isEntranceReady),
			controls: sectionOf(entrance.controls, isEntranceReady),
			github: sectionOf(entrance.github, isEntranceReady),
			headline: sectionOf(entrance.headline, isEntranceReady),
		}),
		[entrance, isEntranceReady],
	);

	const markApplicationReady = useCallback(() => {
		setApplicationReady(true);
	}, []);

	useEffect(() => {
		const images = background.current?.querySelectorAll("img") ?? [];

		let isMounted = true;

		void Promise.all([
			document.fonts.ready,
			...Array.from(images, async (image) => image.decode().catch(() => undefined)),
		]).then(() => {
			if (isMounted) setPageReady(true);
		});

		return () => {
			isMounted = false;
		};
	}, []);

	const selectPlatform = (next: Platform) => {
		setPlatform(next);
		setOptionId(firstOptionIdOf(next));
	};

	return (
		<MotionConfig reducedMotion="user">
			<div className="page">
				<div id="bg" ref={background}>
					<div id="sky">
						{skyTiles.map((tile) => (
							<img
								key={tile}
								src={sky1920}
								srcSet={skySources}
								sizes={backgroundSizes}
								fetchPriority="high"
								alt=""
							/>
						))}
					</div>
					<img
						id="hills"
						src={hills1920}
						srcSet={hillsSources}
						sizes={backgroundSizes}
						fetchPriority="high"
						alt=""
					/>
				</div>
				<main id="hero">
					<motion.h1 id="headline" {...sections.headline}>
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
						entrance={sections.controls}
					/>
					<motion.a
						id="github"
						href="https://github.com/visionsofparadise/dump-txt"
						aria-label="GitHub"
						{...sections.github}
					>
						<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
							<path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
						</svg>
					</motion.a>
					<AppBox
						platform={platform}
						entrance={sections.app}
						tiltVariants={entrance.tilt}
						onApplicationReady={markApplicationReady}
					/>
				</main>
			</div>
		</MotionConfig>
	);
}
