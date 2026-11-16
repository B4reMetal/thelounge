import {SharedChan} from "./chan";

export type SharedPrefixObject = {
	symbol: string;
	mode: string;
};

export type SharedNetworkChan = SharedChan & {
	totalMessages: number;
	// False until the server has read this channel's stored history, which
	// happens the first time the channel is opened.
	historyLoaded: boolean;
};

export type SharedPrefix = {
	prefix: SharedPrefixObject[];
	modeToSymbol: {[mode: string]: string};
	symbols: string[];
};

export type SharedServerOptions = {
	CHANTYPES: string[];
	PREFIX: SharedPrefix;
	NETWORK: string;
};

export type SharedNetworkStatus = {
	connected: boolean;
	secure: boolean;
};

export type SharedNetwork = {
	uuid: string;
	name: string;
	nick: string;
	serverOptions: SharedServerOptions;
	status: SharedNetworkStatus;
	channels: SharedNetworkChan[];
	// Trackers configured for this network's host, if any
	torrentSites?: TorrentSiteInfo[];
};

// A tracker whose users chat on an IRC network. Used to build "Tracker Profile"
// links in the user context menu, and to limit shoutbox bridge matchers to the
// tracker's own network and channels.
export type TorrentSite = {
	disabled?: boolean;
	abbreviation: string;
	name: string;
	// IRC server hostname, compared case-insensitively against the network host
	host: string;
	// Tracker web domain, e.g. "seedpool.org"
	domain: string;
	// Only offer the link in these channels (case-insensitive). Omit for all channels.
	channels?: string[];
	// Path on the tracker that the nick is appended to. Defaults to defaultTorrentSiteInfo.profileUrl.
	profileUrl?: string;
	// Set to false when profile URLs aren't based on the nick. The site is still
	// sent to the client (for shoutbox bridge scoping), without a profile link.
	profileLink?: boolean;
};

export type DefaultTorrentSiteInfo = {
	profileUrl: string;
};

// A configured site after defaults are applied. profileUrl is absolute
// (https://domain/path/), ready for an encoded nick to be appended, or null
// when the site has `profileLink: false`.
export type TorrentSiteInfo = {
	abbreviation: string;
	name: string;
	domain: string;
	channels?: string[];
	profileUrl: string | null;
};
