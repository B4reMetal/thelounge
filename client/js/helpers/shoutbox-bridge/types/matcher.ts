import { type SharedMsg } from "../../../../../shared/types/msg";
import { type MessageEdit } from "./parser";

interface BaseMatcher {
	type: "basic" | "advanced";
	name: string;
	description: string;
	/**
	 * `abbreviation` of the tracker's entry in config.js `torrentSites`. The
	 * matcher then only applies on networks (and in channels) configured for
	 * that tracker. Matchers without `site` are unscoped: they apply in every
	 * channel on every network, so set it as soon as the tracker's IRC host is
	 * known.
	 */
	site?: string;
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
