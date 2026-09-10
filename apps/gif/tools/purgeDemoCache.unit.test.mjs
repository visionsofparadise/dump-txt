import assert from "node:assert/strict";
import { test } from "node:test";
import { purgeDemoCache } from "./purgeDemoCache.mjs";

const source = "https://raw.githubusercontent.com/example/dump-txt/media/demo.gif";
const proxy = "https://camo.githubusercontent.com/example/demo";

function fixture(html, failure = false) {
	const calls = [];
	const warnings = [];
	const fetch_ = async (url, options) => {
		calls.push({ url, options });

		return { ok: !failure, status: failure ? 503 : 200, text: async () => html };
	};

	return {
		calls,
		warnings,
		run: () => purgeDemoCache({ repository: "example/dump-txt", fetch_, warn: (message) => warnings.push(message) }),
	};
}

test("purges only the README demonstration proxy without forwarding credentials", async () => {
	const fixture_ = fixture(`<img src="${proxy}" data-canonical-src="${source}">`);

	assert.equal(await fixture_.run(), "purged");
	assert.equal(fixture_.calls[1].url, proxy);
	assert.equal(fixture_.calls[1].options.method, "PURGE");
	assert.equal(fixture_.calls[1].options.headers, undefined);
	assert.equal(fixture_.calls[1].options.redirect, "error");
});

test("leaves directly served images alone", async () => {
	const fixture_ = fixture(`<img src="${source}">`);

	assert.equal(await fixture_.run(), "not proxied");
	assert.equal(fixture_.calls.length, 1);
});

test("ignores unrelated images and non-Camo proxy addresses", async () => {
	const fixture_ = fixture(
		`<img src="${proxy}" data-canonical-src="https://example.com/other.gif"><img src="https://example.com/demo" data-canonical-src="${source}">`,
	);

	assert.equal(await fixture_.run(), "not proxied");
	assert.equal(fixture_.calls.length, 1);
});

test("reports cache service failures without invalidating a successful publication", async () => {
	const fixture_ = fixture("", true);

	assert.equal(await fixture_.run(), "unavailable");
	assert.equal(fixture_.warnings.length, 1);
});
