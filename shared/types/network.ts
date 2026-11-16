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
// links in the user context menu.
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
};

export type DefaultTorrentSiteInfo = {
	profileUrl: string;
};

// A configured site after defaults are applied. profileUrl is absolute
// (https://domain/path/), ready for an encoded nick to be appended.
export type TorrentSiteInfo = {
	abbreviation: string;
	name: string;
	domain: string;
	channels?: string[];
	profileUrl: string;
};
