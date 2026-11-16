import {PluginInputHandler} from "./index.js";
import Msg from "../../models/msg.js";
import {MessageType} from "../../../shared/types/msg.js";
import {ChanType} from "../../../shared/types/chan.js";

const commands = ["rainbow", "rgb"];

// Formatting characters and spaces are passed through without a colour
const skipChars = [" ", "\x03", "\x02", "\x1F", "\x1D", "\x0F", "\x1e", "\x11"];
const colorCodes = [4, 7, 8, 9, 3, 10, 11, 12, 2, 6, 13];

const segmenter =
	typeof Intl.Segmenter === "function"
		? new Intl.Segmenter(undefined, {granularity: "grapheme"})
		: null;

// Split by user-perceived character, so emoji, combining marks and other
// astral characters are coloured as a whole instead of being cut in half
function splitGraphemes(text: string): string[] {
	if (segmenter) {
		return Array.from(segmenter.segment(text), (s) => s.segment);
	}

	// Fall back to code points
	return Array.from(text);
}

export function rainbow(text: string) {
	return splitGraphemes(text)
		.map((char, index) => {
			if (skipChars.includes(char)) {
				return char;
			}

			// A colour code followed by a digit must be two digits, otherwise the
			// digit is read as part of the colour code ("\x034" + "2" is colour 42).
			// Check the first code unit, which also covers keycap emoji like "1️⃣".
			const startsWithDigit = /^[0-9]/.test(char);
			const color = String(colorCodes[index % colorCodes.length]).padStart(
				startsWithDigit ? 2 : 1,
				"0"
			);

			return `\x03${color}${char}`;
		})
		.join("");
}

const input: PluginInputHandler = function ({irc}, chan, cmd, args) {
	if (chan.type !== ChanType.CHANNEL && chan.type !== ChanType.QUERY) {
		chan.pushMessage(
			this,
			new Msg({
				type: MessageType.ERROR,
				text: `${cmd} command can only be used in channels and queries.`,
			})
		);

		return;
	}

	if (args.length === 0) {
		return true;
	}

	const text = rainbow(args.join(" "));
	irc.say(chan.name, text);

	// If the IRCd does not support echo-message, simulate the message
	// being sent back to us.
	if (!irc.network.cap.isEnabled("echo-message")) {
		irc.emit("privmsg", {
			nick: irc.user.nick,
			ident: irc.user.username,
			hostname: irc.user.host,
			target: chan.name,
			message: text,
		});
	}

	return true;
};

export default {
	commands,
	input,
};
