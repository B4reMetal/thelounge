import {expect} from "chai";
import _ from "lodash";

import Config from "../../server/config.js";

describe("Config.getTorrentSitesForHost", function () {
	let saved: Pick<typeof Config.values, "torrentSites" | "defaultTorrentSiteInfo">;

	beforeEach(function () {
		saved = _.cloneDeep({
			torrentSites: Config.values.torrentSites,
			defaultTorrentSiteInfo: Config.values.defaultTorrentSiteInfo,
		});
		Config.values.defaultTorrentSiteInfo = {profileUrl: "/users/"};
		Config.values.torrentSites = [
			{
				abbreviation: "SP",
				name: "Seedpool",
				host: "irc.seedpool.org",
				domain: "seedpool.org",
			},
			{
				abbreviation: "BLU",
				name: "Blutopia",
				host: "irc.p2p-network.net",
				domain: "blutopia.cc",
				channels: ["#blutopia"],
			},
			{
				abbreviation: "OTH",
				name: "Other",
				host: "irc.p2p-network.net",
				domain: "other.example",
				profileUrl: "profile/",
			},
			{
				abbreviation: "NOL",
				name: "No link",
				host: "irc.nolink.example",
				domain: "nolink.example",
				profileLink: false,
			},
			{
				disabled: true,
				abbreviation: "OFF",
				name: "Off",
				host: "irc.off.example",
				domain: "off.example",
			},
		];
	});

	afterEach(function () {
		Object.assign(Config.values, saved);
	});

	it("returns undefined for unknown hosts, a missing host, or a null list", function () {
		expect(Config.getTorrentSitesForHost("irc.unknown.example")).to.equal(undefined);
		expect(Config.getTorrentSitesForHost(undefined)).to.equal(undefined);
		Config.values.torrentSites = null;
		expect(Config.getTorrentSitesForHost("irc.seedpool.org")).to.equal(undefined);
	});

	it("matches the host case-insensitively and makes profileUrl absolute", function () {
		expect(Config.getTorrentSitesForHost("IRC.SeedPool.org")).to.deep.equal([
			{
				abbreviation: "SP",
				name: "Seedpool",
				domain: "seedpool.org",
				channels: undefined,
				profileUrl: "https://seedpool.org/users/",
			},
		]);
	});

	it("returns every site sharing a host, honouring per-site profileUrl", function () {
		const sites = Config.getTorrentSitesForHost("irc.p2p-network.net")!;
		expect(sites.map((s) => s.profileUrl)).to.deep.equal([
			"https://blutopia.cc/users/",
			"https://other.example/profile/",
		]);
		expect(sites[0].channels).to.deep.equal(["#blutopia"]);
	});

	it("skips disabled sites", function () {
		expect(Config.getTorrentSitesForHost("irc.off.example")).to.equal(undefined);
	});

	it("keeps sites with profileLink: false, without a profile URL", function () {
		const sites = Config.getTorrentSitesForHost("irc.nolink.example");
		expect(sites?.map((s) => [s.abbreviation, s.profileUrl])).to.deep.equal([["NOL", null]]);
	});

	it("ships defaults that load and resolve", function () {
		Object.assign(Config.values, saved);
		const sites = Config.getTorrentSitesForHost("irc.seedpool.org");
		expect(sites?.[0].profileUrl).to.equal("https://seedpool.org/users/");
	});
});
