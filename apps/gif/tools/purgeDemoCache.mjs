export async function purgeDemoCache({ repository, fetch_ = fetch, warn = console.warn }) {
	try {
		const readme = await fetch_(`https://api.github.com/repos/${repository}/readme`, {
			headers: {
				Accept: "application/vnd.github.html+json",
				Authorization: `Bearer ${process.env.GH_TOKEN}`,
			},
			signal: AbortSignal.timeout(10_000),
		});

		if (!readme.ok) throw new Error(`README request returned ${readme.status}`);

		const html = await readme.text();
		const source = `https://raw.githubusercontent.com/${repository}/media/demo.gif`;

		for (const [image] of html.matchAll(/<img\b[^>]*>/giu)) {
			const canonical = /\sdata-canonical-src="([^"]+)"/iu.exec(image)?.[1];
			const address = /\ssrc="([^"]+)"/iu.exec(image)?.[1];

			if (canonical !== source || !address) continue;

			const url = new URL(address);

			if (url.origin !== "https://camo.githubusercontent.com") continue;

			const response = await fetch_(url.href, {
				method: "PURGE",
				redirect: "error",
				signal: AbortSignal.timeout(10_000),
			});

			if (!response.ok) throw new Error(`Image cache request returned ${response.status}`);

			return "purged";
		}

		return "not proxied";
	} catch (error) {
		warn(`Demo published; image cache refresh was unavailable: ${error.message}`);

		return "unavailable";
	}
}
