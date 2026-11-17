import { type SharedMsg } from "../../../../../shared/types/msg";
import { type MessageEdit } from "./parser";

interface BaseMatcher {
	type: "basic" | "advanced";
	name: string;
	description: string;
	/**
	 * Id of the tracker's entry in config.js `trackers`. The matcher then
	 * only applies on the network (and in the channels) of that tracker, and
	 * the users it finds get a link to their profile there. Matchers without
	 * `tracker` are unscoped: they apply in every channel on every network,
	 * so set it as soon as the tracker's IRC host is known.
	 */
	tracker?: string;
	/**
	 * Turns the matcher off. For matchers that have no tracker to be limited
	 * to and whose bot nick couldn't be confirmed: anyone using that nick, on
	 * any network, would be shown as whoever they claim to be.
	 */
	disabled?: boolean;
	transform: (message: SharedMsg) => MessageEdit | undefined;
};

interface BasicMatcher extends BaseMatcher {
	type: "basic";
	matches: string[];
	regex: RegExp;
};

interface AdvancedMatcher extends BaseMatcher {
	type: "advanced";
	matches: (nick: string) => boolean;
};

export type Matcher = BasicMatcher | AdvancedMatcher;
