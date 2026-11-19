import {type Matcher} from "./types/matcher";

/**
 * Matchers for shoutbox messages. `tracker` ties a matcher to its tracker's entry
 * in config.js `trackers` (by id); see `Matcher.tracker`.
 */
export const matchers: Matcher[] = [
	{
		type: "basic",
		name: "Aither",
		tracker: "ATH",
		description: "[nick] message",
		matches: ["chatbot"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "Anthelion",
		tracker: "ANT",
		description: "[ SB ] (<nick>): <message>",
		matches: ["sauron"],
		regex: /^0 \[2 SB0 \] \((?<nick>[^):]+)\): (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "Aura4K",
		tracker: "A4K",
		description: "[nick] message",
		matches: ["aurarelay"],
		regex: /^11\[04(?<nick>[^:\]]+?)11\] (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "BeyondHD",
		description: "[SB] <nick>: <message>",
		matches: ["willie"],
		regex: /^09\[SB\] (?<nick>[^:]+): (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "DarkPeers",
		tracker: "DP",
		description: "[nick] message",
		matches: ["darkpeers", "dp"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "DigitalCore",
		description: "<<nick>> <message>",
		matches: ["endor"],
		regex: /^<(?<nick>[^>]+?)> (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "DreadVault",
		disabled: true, // no known IRC host to limit it to
		description: "<<nick>> <message>",
		matches: ["dreadvaultbot"],
		regex: /^<(?<nick>[^>]+?)> (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "HomiesHelpDesk",
		tracker: "HHD",
		description: "[username] (platform): message",
		matches: ["bbot"],
		regex: /^\[(?<nick>[^\]]+)\] \([^)]+\): (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "HUNO (Discord)",
		description: "»<nick> (<rank>)« <message> | »<nick>« <message>",
		matches: ["mellos"],
		regex: /^»(?<nick>[^«]+?)(?: (?:\p{RGI_Emoji}+|\(.+?\)))?« (?<content>.*)/v,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "advanced",
		name: "HUNO (Web)",
		disabled: true, // no known IRC host to limit it to
		description: "Nicks in the format '<nick>-web'",
		matches(nick) {
			return nick.endsWith("-web") || nick.endsWith("-web", nick.length - 2);
		},
		transform(message) {
			return {
				nick: message.from!.nick!.slice(0, -4),
				content: message.text,
			};
		},
	},
	{
		type: "basic",
		name: "LST",
		tracker: "LST",
		description: "[nick] message",
		matches: ["bot"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "Luminarr",
		tracker: "LUME",
		description: "[nick] message",
		matches: ["luminarr"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "MidnightScene",
		tracker: "MNS",
		description: "[nick]: message",
		matches: ["msbridge"],
		regex: /^\[(?<nick>[^:\]]+)\]: (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "OnlyEncodes+",
		tracker: "OE+",
		description: "[nick] message",
		matches: ["bridgebot"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "ReelFliX",
		tracker: "RFX",
		description: "[Chatbox] <nick>: <message>",
		matches: ["wall-e"],
		regex: /^04\[Chatbox\] (?<nick>[^:]+): (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "RocketHD",
		tracker: "RHD",
		description: "🛰️<nick>: <message>",
		matches: ["rocketnouncer"],
		regex: /^🛰️(?<nick>[^:]+?): (?<content>.*)/v,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "SkipTheCommercial",
		tracker: "STC",
		description: "nick: message",
		matches: ["unit3dbridge"],
		// A nick has no spaces or colons, so it ends at the first ": "
		regex: /^(?<nick>[^\s:]+?): (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "UploadCX",
		tracker: "ULCX",
		description: "[nick]: message",
		matches: ["ulcx"],
		regex: /^\[(?<nick>[^:\]]+)\]: (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "YUSCENE",
		tracker: "YUS",
		description: "[nick] message",
		matches: ["yus"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
	{
		type: "basic",
		name: "Zenith",
		tracker: "ZNTH",
		description: "[nick]: message",
		matches: ["zenith"],
		regex: /^\[(?<nick>[^:\]]+)\]: (?<content>.*)/,
		transform(message) {
			return typedGroups(message.text!.match(this.regex));
		},
	},
];

/**
 * Helper to get regex match groups with inferd types from return of parent
 */
function typedGroups<T = RegExpMatchArray["groups"]>(regexMatch: RegExpMatchArray | null) {
	return regexMatch?.groups as T;
}
