import type { SharedMsg } from "../../../../shared/types/msg";
import { toRaw } from "vue";
import { matchers } from "./matchers";

/**
 * Parse message aganst `Matchers` and edit the Nick and Content based on `transform` results
 */
export function parser (originalMessage: SharedMsg) {
	const originalSender = originalMessage.from?.nick?.toLowerCase();

	if (!originalMessage.text || !originalSender) return originalMessage;

	const matcher = matchers.find(m => {
		if (m.type === "basic") return m.matches.includes(originalSender);
		if (m.type === "advanced") return m.matches(originalSender);
	});
	if (!matcher) return originalMessage;

	const edit = matcher.transform(originalMessage);
	if (!edit || !edit.nick) return originalMessage;

	// Shallow copy: only `text` and `from` are replaced below, and `previews`
	// has to stay the same reactive array the store updates
	const message = {...toRaw(originalMessage)};
	message.text = edit.content ?? message.text;
	message.from = {
		...message.from!,
		nick: sanitizeNick(edit.nick),
		mode: "",
		shoutbox: true,
		original_nick: originalSender
	};

	return message;
}

/**
 * Helper to remove invalid chars from nick string
 *
 * Keeps letters, digits and the IRC nick special characters
 * (underscore, hyphen, square brackets, backslash, backtick, caret, braces and
 * pipe). This is the same set `findNames` treats as part of a nick, so bridged
 * nicks added to the user list can still be matched as mentions.
 */
function sanitizeNick (nick: string) {
	return nick.replaceAll(/[^\p{Letter}\p{Number}_\-[\]\\`^{|}]/gu, "");
}
