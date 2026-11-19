import emojiRegExp from "emoji-regex";
import {Part} from "./merge";

const regExp = emojiRegExp();
const emojiPresentation = /\p{Emoji_Presentation}/u;

export type EmojiPart = Part & {
	emoji: string;
};

function findEmoji(text: string) {
	const result: EmojiPart[] = [];
	let match: RegExpExecArray | null;

	while ((match = regExp.exec(text))) {
		// A symbol that is text by default (©, ❤, ⚕) is only an emoji when
		// sent with the emoji selector U+FE0F, which the match then includes;
		// U+FE0E after it explicitly asks for text
		const single = [...match[0]].length === 1;

		if (
			text[match.index + match[0].length] === "\uFE0E" ||
			(single && !emojiPresentation.test(match[0]))
		) {
			continue;
		}

		result.push({
			start: match.index,
			end: match.index + match[0].length,
			emoji: match[0],
		});
	}

	return result;
}

export default findEmoji;
