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
};
