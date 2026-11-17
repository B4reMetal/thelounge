import {expect} from "chai";
import {
	isUsableProfileUrl,
	parseUserTrackers,
	serializeUserTrackers,
	userTrackerLimits,
} from "../../shared/trackers.js";

describe("tracker profile address validation", function () {
	it("accepts http(s) addresses with {nick} or {ident}", function () {
		expect(isUsableProfileUrl("https://tracker.example/users/{nick}")).to.equal(true);
		expect(isUsableProfileUrl("http://tracker.example/user.php?id={ident}")).to.equal(true);
	});

	it("rejects anything else", function () {
		for (const url of [
			undefined,
			42,
			"",
			"https://tracker.example/users/",
			"javascript:alert(1)//{nick}",
			"data:text/html,{nick}",
			"ftp://tracker.example/{nick}",
			"//tracker.example/{nick}",
			"{nick}",
		]) {
			expect(isUsableProfileUrl(url), String(url)).to.equal(false);
		}
	});
});

describe("parseUserTrackers", function () {
	const good = {
		id: "user-1",
		network: "IRC.Example.net",
		name: "Example",
		channels: ["#example", 5, ""],
		profileUrl: "https://example.org/u/{nick}",
		userHost: "*.example.org",
	};

	it("reads a stored list", function () {
		expect(parseUserTrackers(JSON.stringify([good]))).to.deep.equal([
			{
				id: "user-1",
				network: "irc.example.net",
				name: "Example",
				channels: ["#example"],
				profileUrl: "https://example.org/u/{nick}",
				userHost: "*.example.org",
			},
		]);
	});

	it("treats unreadable values as no entries", function () {
		for (const stored of [undefined, null, 1, "", "{", "{}", '"x"', "null", true]) {
			expect(parseUserTrackers(stored), String(stored)).to.deep.equal([]);
		}
	});

	it("skips malformed entries and keeps the rest", function () {
		const list = [
			null,
			"x",
			[good],
			{id: "a"},
			{network: "irc.example.net"},
			{id: 5, network: "irc.example.net"},
			{id: "a".repeat(userTrackerLimits.text + 1), network: "irc.example.net"},
			good,
		];

		expect(parseUserTrackers(JSON.stringify(list)).map((t) => t.id)).to.deep.equal(["user-1"]);
	});

	it("drops a stored profile address that fails validation", function () {
		const [entry] = parseUserTrackers(
			JSON.stringify([{...good, profileUrl: "javascript:alert(document.cookie)//{nick}"}])
		);

		expect(entry.profileUrl).to.equal(undefined);
		// A users' hostname is only meaningful with a profile address
		expect(entry.userHost).to.equal(undefined);
	});

	it("only takes hidden: true", function () {
		const [a, b] = parseUserTrackers(
			JSON.stringify([
				{id: "A", network: "x", hidden: true},
				{id: "B", network: "x", hidden: "yes"},
			])
		);

		expect(a.hidden).to.equal(true);
		expect(b.hidden).to.equal(undefined);
	});

	it("keeps the first entry for the same tracker", function () {
		const list = [
			{id: "SP", network: "irc.example.net", hidden: true},
			{id: "sp", network: "IRC.example.net", profileUrl: "https://x.example/{nick}"},
		];

		expect(parseUserTrackers(JSON.stringify(list))).to.deep.equal([
			{id: "SP", network: "irc.example.net", hidden: true},
		]);
	});

	it("caps the number of entries", function () {
		const list = Array.from({length: userTrackerLimits.entries + 10}, (_, i) => ({
			id: `t${i}`,
			network: "irc.example.net",
		}));

		expect(parseUserTrackers(JSON.stringify(list))).to.have.length(userTrackerLimits.entries);
	});

	it("round-trips through serializeUserTrackers", function () {
		const entries = parseUserTrackers(JSON.stringify([good]));

		expect(parseUserTrackers(serializeUserTrackers(entries))).to.deep.equal(entries);
		expect(serializeUserTrackers([])).to.equal("");
	});
});
