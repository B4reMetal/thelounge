import {EventEmitter} from "events";
import {expect} from "chai";
import sinon from "sinon";
import log from "../../../server/log.js";
import Chan from "../../../server/models/chan.js";
import Network from "../../../server/models/network.js";
import spgroups from "../../../server/plugins/irc-events/spgroups.js";
import spjoin from "../../../server/plugins/irc-events/spjoin.js";
import {
	MAX_GROUPS,
	MAX_GROUP_NAME_LENGTH,
	MAX_USERS_PER_GROUP,
	normaliseGroups,
} from "../../../server/plugins/userGroups.js";

type Emitted = {event: string; data: any};

function setup() {
	const irc = new EventEmitter();
	const chan = new Chan({name: "#test"});
	const network = new Network({host: "example.com", channels: [chan]});
	const emitted: Emitted[] = [];
	const client = {
		emit(event: string, data: any) {
			emitted.push({event, data});
		},
	};

	spgroups.apply(client as any, [irc as any, network as any]);
	spjoin.apply(client as any, [irc as any, network as any]);

	const send = (command: string, params: string[]) =>
		irc.emit("unknown command", {command, params});

	return {chan, emitted, send};
}

describe("SPGROUPS / SPJOIN", function () {
	let warnStub: sinon.SinonStub;
	let errorStub: sinon.SinonStub;

	beforeEach(function () {
		warnStub = sinon.stub(log, "warn");
		errorStub = sinon.stub(log, "error");
	});

	afterEach(function () {
		warnStub.restore();
		errorStub.restore();
	});

	describe("normaliseGroups", function () {
		it("returns null for a non-array", function () {
			expect(normaliseGroups(undefined)).to.equal(null);
			expect(normaliseGroups({})).to.equal(null);
			expect(normaliseGroups("x")).to.equal(null);
		});

		it("keeps well-formed groups sorted by position, highest first", function () {
			expect(
				normaliseGroups([
					{name: "User", position: 1, users: ["c"]},
					{name: "Sysop", position: 10, users: ["a", "b"]},
				])
			).to.deep.equal([
				{name: "Sysop", position: 10, users: ["a", "b"]},
				{name: "User", position: 1, users: ["c"]},
			]);
		});

		it("drops malformed groups and users", function () {
			expect(
				normaliseGroups([
					null,
					1,
					"Sysop",
					["Sysop", 1, []],
					{name: "NoUsers", position: 1},
					{name: "UsersNotArray", position: 1, users: "a"},
					{name: "BadPosition", position: "1", users: []},
					{name: "NaNPosition", position: NaN, users: []},
					{name: "InfPosition", position: Infinity, users: []},
					{name: 5, position: 1, users: []},
					{name: "", position: 1, users: []},
					{name: "x".repeat(MAX_GROUP_NAME_LENGTH + 1), position: 1, users: []},
					{name: "Good", position: 2, users: ["a", 1, null, {}, "", "A", "b"]},
					{name: "Good", position: 3, users: ["dup"]},
				])
			).to.deep.equal([{name: "Good", position: 2, users: ["a", "b"]}]);
		});

		it("caps the number of groups and users", function () {
			const many = Array.from({length: MAX_GROUPS + 10}, (_, i) => ({
				name: `g${i}`,
				position: i,
				users: [],
			}));
			expect(normaliseGroups(many)).to.have.length(MAX_GROUPS);

			const users = Array.from({length: MAX_USERS_PER_GROUP + 10}, (_, i) => `u${i}`);
			const result = normaliseGroups([{name: "big", position: 0, users}]);
			expect(result![0].users).to.have.length(MAX_USERS_PER_GROUP);
		});
	});

	describe("SPGROUPS", function () {
		it("stores normalised groups and emits them", function () {
			const {chan, emitted, send} = setup();

			send("SPGROUPS", [
				"#test",
				JSON.stringify({
					groups: [
						{name: "User", position: 1, users: ["bob"]},
						{name: "Broken", users: ["x"]},
						{name: "Sysop", position: 5, users: ["alice", 42]},
					],
				}),
			]);

			const expected = [
				{name: "Sysop", position: 5, users: ["alice"]},
				{name: "User", position: 1, users: ["bob"]},
			];
			expect(chan.groups).to.deep.equal(expected);
			expect(emitted).to.have.length(1);
			expect(emitted[0].event).to.equal("channel:groups");
			expect(emitted[0].data.groups).to.deep.equal(expected);
		});

		for (const payload of ["null", "42", '"groups"', "[]", '{"groups":{}}', "{not json"]) {
			it(`ignores payload ${payload}`, function () {
				const {chan, emitted, send} = setup();

				expect(() => send("SPGROUPS", ["#test", payload])).to.not.throw();
				expect(chan.groups).to.equal(undefined);
				expect(emitted).to.have.length(0);
			});
		}
	});

	describe("SPJOIN", function () {
		it("does not throw on groups that bypassed validation", function () {
			const {chan, emitted, send} = setup();

			// Simulate malformed data already stored on the channel
			chan.groups = [
				{name: "NoUsers", position: 1} as any,
				{name: "BadPos", position: "x", users: []} as any,
				null as any,
				{name: "Sysop", position: 5, users: ["alice", 7]} as any,
			];

			expect(() => send("SPJOIN", ["#test", "Bob", "New"])).to.not.throw();
			expect(chan.groups).to.deep.equal([
				{name: "Sysop", position: 5, users: ["alice"]},
				{name: "New", position: 4, users: ["Bob"]},
			]);
			expect(emitted).to.have.length(1);
		});

		it("moves a user between groups", function () {
			const {chan, send} = setup();

			send("SPGROUPS", [
				"#test",
				JSON.stringify({
					groups: [
						{name: "Sysop", position: 5, users: ["alice"]},
						{name: "User", position: 1, users: ["Bob"]},
					],
				}),
			]);
			send("SPJOIN", ["#test", "bob", "Sysop"]);

			expect(chan.groups).to.deep.equal([
				{name: "Sysop", position: 5, users: ["alice", "bob"]},
				{name: "User", position: 1, users: []},
			]);
		});

		it("creates the first group at position 0", function () {
			const {chan, send} = setup();
			send("SPJOIN", ["#test", "bob", "User"]);
			expect(chan.groups).to.deep.equal([{name: "User", position: 0, users: ["bob"]}]);
		});

		it("ignores over-long group names and nicks", function () {
			const {chan, emitted, send} = setup();
			send("SPJOIN", ["#test", "bob", "x".repeat(MAX_GROUP_NAME_LENGTH + 1)]);
			send("SPJOIN", ["#test", "b".repeat(1000), "User"]);
			expect(chan.groups).to.equal(undefined);
			expect(emitted).to.have.length(0);
		});

		it("does not add groups past the limit", function () {
			const {chan, emitted, send} = setup();
			chan.groups = Array.from({length: MAX_GROUPS}, (_, i) => ({
				name: `g${i}`,
				position: i,
				users: i === 0 ? ["bob"] : [],
			}));

			send("SPJOIN", ["#test", "bob", "Overflow"]);

			expect(chan.groups).to.have.length(MAX_GROUPS);
			expect(chan.groups.find((g) => g.name === "g0")!.users).to.deep.equal(["bob"]);
			expect(emitted).to.have.length(0);
		});
	});
});
