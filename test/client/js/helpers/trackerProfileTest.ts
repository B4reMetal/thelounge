import {expect} from "chai";
import {getTrackerProfileUrl} from "../../../../client/js/helpers/trackerProfile.js";
import {ChanType} from "../../../../shared/types/chan.js";
import type {TorrentSiteInfo} from "../../../../shared/types/network.js";

const seedpool: TorrentSiteInfo = {
	abbreviation: "SP",
	name: "Seedpool",
	domain: "seedpool.org",
	profileUrl: "https://seedpool.org/users/",
};

const blutopia: TorrentSiteInfo = {
	abbreviation: "BLU",
	name: "Blutopia",
	domain: "blutopia.cc",
	channels: ["#Blutopia"],
	profileUrl: "https://blutopia.cc/users/",
};

const channel = (name: string) => ({type: ChanType.CHANNEL, name});

describe("getTrackerProfileUrl", function () {
	it("returns null when the network has no tracker", function () {
		expect(getTrackerProfileUrl({}, channel("#seedpool"), "alice")).to.equal(null);
	});

	it("builds the profile URL for a site without a channel list", function () {
		expect(
			getTrackerProfileUrl({torrentSites: [seedpool]}, channel("#seedpool"), "alice")
		).to.equal("https://seedpool.org/users/alice");
	});

	it("matches a site's channel list case-insensitively", function () {
		const network = {torrentSites: [blutopia]};
		expect(getTrackerProfileUrl(network, channel("#blutopia"), "bob")).to.equal(
			"https://blutopia.cc/users/bob"
		);
		expect(getTrackerProfileUrl(network, channel("#other"), "bob")).to.equal(null);
	});

	it("picks the site whose channels match when several share a network", function () {
		const other: TorrentSiteInfo = {...seedpool, channels: ["#seedpool"]};
		const network = {torrentSites: [other, blutopia]};
		expect(getTrackerProfileUrl(network, channel("#BLUTOPIA"), "bob")).to.equal(
			"https://blutopia.cc/users/bob"
		);
	});

	it("only uses sites without a channel list outside channels", function () {
		const query = {type: ChanType.QUERY, name: "bob"};
		expect(getTrackerProfileUrl({torrentSites: [blutopia]}, query, "bob")).to.equal(null);
		expect(getTrackerProfileUrl({torrentSites: [seedpool]}, query, "bob")).to.equal(
			"https://seedpool.org/users/bob"
		);
		expect(getTrackerProfileUrl({torrentSites: [seedpool]}, undefined, "bob")).to.equal(
			"https://seedpool.org/users/bob"
		);
	});

	it("URL-encodes nicks with special characters", function () {
		expect(getTrackerProfileUrl({torrentSites: [seedpool]}, channel("#sp"), "[a]b|c")).to.equal(
			"https://seedpool.org/users/%5Ba%5Db%7Cc"
		);
	});

	it("skips sites without a profile link", function () {
		const noLink: TorrentSiteInfo = {...seedpool, profileUrl: null};
		expect(getTrackerProfileUrl({torrentSites: [noLink]}, channel("#sp"), "bob")).to.equal(
			null
		);
		expect(
			getTrackerProfileUrl({torrentSites: [noLink, blutopia]}, channel("#blutopia"), "bob")
		).to.equal("https://blutopia.cc/users/bob");
	});
});
