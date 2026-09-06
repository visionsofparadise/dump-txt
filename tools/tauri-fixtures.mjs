import { createHash } from "node:crypto";
import { probeText } from "../src/renderer/desktop/probeText.ts";

export const fixture = {
	text: probeText,
	pages: probeText.split("\n\f\n"),
	bytes: Buffer.byteLength(probeText),
	sha256: createHash("sha256").update(probeText).digest("hex"),
};

export const pendingObservations = [
	"Physical wheel notch, precision trackpad momentum and reverse gesture",
	"Native CJK IME and dead-key composition, candidate acceptance and cancellation",
	"Native text drag/drop and OS editing-menu focus",
	"Physical clipboard shortcuts and OS clipboard ownership",
	"First themed native display and system appearance changes",
];
