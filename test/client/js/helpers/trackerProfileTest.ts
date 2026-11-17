import {expect} from "chai";
import {getTrackerProfileUrl} from "../../../../client/js/helpers/trackerProfile.js";
import {ChanType} from "../../../../shared/types/chan.js";
import type {TrackerInfo} from "../../../../shared/types/network.js";

const seedpool: TrackerInfo = {
	id: "SP",
	name: "Seedpool",
	profileUrl: "https://seedpool.org/users/{nick}",
};

const blutopia: TrackerInfo = {
	id: "BLU",
	name: "Blutopia",
	channels: ["#Blutopia"],
	profileUrl: "https://blutopia.cc/users/{nick}",
};

const channel = (name: string) => ({type: ChanType.CHANNEL, name});

describe("getTrackerProfileUrl", function () {
	it("returns null when the network has no tracker", function () {
		expect(getTrackerProfileUrl({}, channel("#seedpool"), "alice")).to.equal(null);
	});

	it("builds the profile URL for a site without a channel list", function () {
		expect(
			getTrackerProfileUrl({trackers: [seedpool]}, channel("#seedpool"), "alice")
		).to.equal("https://seedpool.org/users/alice");
	});

	it("matches a site's channel list case-insensitively", function () {
		const network = {trackers: [blutopia]};
		expect(getTrackerProfileUrl(network, channel("#blutopia"), "bob")).to.equal(
			"https://blutopia.cc/users/bob"
		);
		expect(getTrackerProfileUrl(network, channel("#other"), "bob")).to.equal(null);
	});

	it("picks the site whose channels match when several share a network", function () {
		const other: TrackerInfo = {...seedpool, channels: ["#seedpool"]};
		const network = {trackers: [other, blutopia]};
		expect(getTrackerProfileUrl(network, channel("#BLUTOPIA"), "bob")).to.equal(
			"https://blutopia.cc/users/bob"
		);
	});

	it("only uses sites without a channel list outside channels", function () {
		const query = {type: ChanType.QUERY, name: "bob"};
		expect(getTrackerProfileUrl({trackers: [blutopia]}, query, "bob")).to.equal(null);
		expect(getTrackerProfileUrl({trackers: [seedpool]}, query, "bob")).to.equal(
			"https://seedpool.org/users/bob"
		);
		expect(getTrackerProfileUrl({trackers: [seedpool]}, undefined, "bob")).to.equal(
			"https://seedpool.org/users/bob"
		);
	});

	it("URL-encodes nicks with special characters", function () {
		expect(getTrackerProfileUrl({trackers: [seedpool]}, channel("#sp"), "[a]b|c")).to.equal(
			"https://seedpool.org/users/%5Ba%5Db%7Cc"
		);
	});

	it("skips sites without a profile link", function () {
		const noLink: TrackerInfo = {id: "SP", name: "Seedpool"};
		expect(getTrackerProfileUrl({trackers: [noLink]}, channel("#sp"), "bob")).to.equal(null);
		expect(
			getTrackerProfileUrl({trackers: [noLink, blutopia]}, channel("#blutopia"), "bob")
		).to.equal("https://blutopia.cc/users/bob");
	});

	it("puts the nick wherever the address has its placeholder", function () {
		const tracker: TrackerInfo = {
			id: "EX",
			name: "Example",
			profileUrl: "https://example.org/user/{nick}/profile?name={nick}",
		};
		expect(getTrackerProfileUrl({trackers: [tracker]}, channel("#ex"), "a b")).to.equal(
			"https://example.org/user/a%20b/profile?name=a%20b"
		);
	});

	it("looks a bridged user up on their own tracker only", function () {
		const shared = {
			trackers: [
				{...seedpool, channels: ["#shout"]},
				{...blutopia, channels: ["#shout"]},
			],
		};

		expect(getTrackerProfileUrl(shared, channel("#shout"), "bob", "blu")).to.equal(
			"https://blutopia.cc/users/bob"
		);
		// not on this network, not in this channel, or without profiles by nick
		expect(getTrackerProfileUrl(shared, channel("#shout"), "bob", "DP")).to.equal(null);
		expect(getTrackerProfileUrl(shared, channel("#other"), "bob", "BLU")).to.equal(null);
		expect(
			getTrackerProfileUrl(
				{trackers: [{id: "ANT", name: "Anthelion"}, seedpool]},
				channel("#ant"),
				"bob",
				"ANT"
			)
		).to.equal(null);
	});
});
