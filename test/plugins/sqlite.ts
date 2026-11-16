import fs from "fs";
import path from "path";
import {expect} from "chai";
import util from "../util.ts";
import Msg from "../../dist/server/models/msg.js";
import {MessageType} from "../../dist/shared/types/msg.js";
import Config from "../../dist/server/config.js";
import MessageStorage, {
	currentSchemaVersion,
	migrations,
	necessaryMigrations,
	rollbacks,
	searchLimits,
	trigramQuery,
} from "../../dist/server/plugins/messageStorage/sqlite.js";
import Database from "better-sqlite3";
import type {DeletionRequest} from "../../server/plugins/messageStorage/types.js";
import type Network from "../../server/models/network.js";
import type {Channel} from "../../server/models/chan.js";

// Test-specific types for SQLite message storage tests
type SqlValue = string | number | boolean | null | Buffer;
type TestNetwork = Pick<Network, "uuid">;
type TestChannel = Pick<Channel, "name">;

const orig_schema = [
	// Schema version #1
	// DO NOT CHANGE THIS IN ANY WAY, it's needed to properly test migrations
	"CREATE TABLE IF NOT EXISTS options (name TEXT, value TEXT, CONSTRAINT name_unique UNIQUE (name))",
	"CREATE TABLE IF NOT EXISTS messages (network TEXT, channel TEXT, time INTEGER, type TEXT, msg TEXT)",
	"CREATE INDEX IF NOT EXISTS network_channel ON messages (network, channel)",
	"CREATE INDEX IF NOT EXISTS time ON messages (time)",
];

const v1_schema_version = 1520239200;

const v1_dummy_messages = [
	{
		network: "8f650427-79a2-4950-b8af-94088b61b37c",
		channel: "##linux",
		time: 1594845354280,
		type: "message",
		msg: '{"from":{"mode":"","nick":"rascul"},"text":"db on a flash drive doesn\'t sound very nice though","self":false,"highlight":false,"users":[]}',
	},
	{
		network: "8f650427-79a2-4950-b8af-94088b61b37c",
		channel: "##linux",
		time: 1594845357234,
		type: "message",
		msg: '{"from":{"mode":"","nick":"GrandPa-G"},"text":"that\'s the point of changing to make sure.","self":false,"highlight":false,"users":[]}',
	},
	{
		network: "8f650427-79a2-4950-b8af-94088b61b37c",
		channel: "#pleroma-dev",
		time: 1594845358464,
		type: "message",
		msg: '{"from":{"mode":"@","nick":"rinpatch"},"text":"it\'s complicated","self":false,"highlight":false,"users":[]}',
	},
];

describe("SQLite migrations", function () {
	let db: Database.Database;

	function serialize_run(stmt: string, ...params: SqlValue[]): Promise<void> {
		try {
			db.prepare(stmt).run(...params);
			return Promise.resolve();
		} catch (err) {
			return Promise.reject(err instanceof Error ? err : new Error(String(err)));
		}
	}

	before(async function () {
		db = new Database(":memory:");

		for (const stmt of orig_schema) {
			await serialize_run(stmt);
		}

		for (const msg of v1_dummy_messages) {
			await serialize_run(
				"INSERT INTO messages(network, channel, time, type, msg) VALUES(?, ?, ?, ?, ?)",
				msg.network,
				msg.channel,
				msg.time,
				msg.type,
				msg.msg
			);
		}
	});

	after(function () {
		db.close();
	});

	it("has a down migration for every migration", function () {
		expect(migrations.length).to.eq(rollbacks.length);
		expect(migrations.map((m) => m.version)).to.have.ordered.members(
			rollbacks.map((r) => r.version)
		);
	});

	it("has working up-migrations", async function () {
		const to_execute = necessaryMigrations(v1_schema_version);
		expect(to_execute.length).to.eq(migrations.length);
		await serialize_run("BEGIN EXCLUSIVE TRANSACTION");

		for (const stmt of to_execute.map((m) => m.stmts).flat()) {
			await serialize_run(stmt);
		}

		await serialize_run("COMMIT TRANSACTION");
	});

	it("has working down-migrations", async function () {
		await serialize_run("BEGIN EXCLUSIVE TRANSACTION");

		for (const rollback of rollbacks.slice().reverse()) {
			if (rollback.rollback_forbidden) {
				throw Error(
					"Try to write a down migration, if you really can't, flip this to a break"
				);
			}

			for (const stmt of rollback.stmts) {
				await serialize_run(stmt);
			}
		}

		await serialize_run("COMMIT TRANSACTION");
	});
});

describe("SQLite unit tests", function () {
	let store: MessageStorage;

	beforeEach(async function () {
		store = new MessageStorage("testUser");
		await store._enable(":memory:");
		store.initDone.resolve();
	});

	afterEach(async function () {
		await store.close();
	});

	it("deletes messages when asked to", async function () {
		const baseDate = new Date();

		const net: TestNetwork = {uuid: "testnet"};
		const chan: TestChannel = {name: "#channel"};

		for (let i = 0; i < 14; ++i) {
			await store.index(
				net,
				chan,
				new Msg({
					time: dateAddDays(baseDate, -i),
					text: `msg ${i}`,
				})
			);
		}

		const limit = 1;
		const delReq: DeletionRequest = {
			messageTypes: [MessageType.MESSAGE],
			limit: limit,
			olderThanDays: 2,
		};

		let deleted = await store.deleteMessages(delReq);
		expect(deleted).to.equal(limit, "number of deleted messages doesn't match");

		let id = 0;
		let messages = await store.getMessages(net, chan, () => id++);
		expect(messages.find((m) => m.text === "msg 13")).to.equal(undefined); // oldest gets deleted first

		// let's test if it properly cleans now
		delReq.limit = 100;
		deleted = await store.deleteMessages(delReq);
		expect(deleted).to.equal(11, "number of deleted messages doesn't match");
		messages = await store.getMessages(net, chan, () => id++);
		expect(messages.map((m) => m.text)).to.have.ordered.members(["msg 1", "msg 0"]);
	});

	it("deletes only the types it should", async function () {
		const baseDate = new Date();

		const net: TestNetwork = {uuid: "testnet"};
		const chan: TestChannel = {name: "#channel"};

		for (let i = 0; i < 6; ++i) {
			await store.index(
				net,
				chan,
				new Msg({
					time: dateAddDays(baseDate, -i),
					text: `msg ${i}`,
					type: [
						MessageType.ACTION,
						MessageType.AWAY,
						MessageType.JOIN,
						MessageType.PART,
						MessageType.KICK,
						MessageType.MESSAGE,
					][i],
				})
			);
		}

		const delReq: DeletionRequest = {
			messageTypes: [MessageType.ACTION, MessageType.JOIN, MessageType.KICK],
			limit: 100, // effectively no limit
			olderThanDays: 0,
		};

		let deleted = await store.deleteMessages(delReq);
		expect(deleted).to.equal(3, "number of deleted messages doesn't match");

		let id = 0;
		let messages = await store.getMessages(net, chan, () => id++);
		expect(messages.map((m) => m.type)).to.have.ordered.members([
			MessageType.MESSAGE,
			MessageType.PART,
			MessageType.AWAY,
		]);

		delReq.messageTypes = [
			MessageType.JOIN, // this is not in the remaining set, just here as a dummy
			MessageType.PART,
			MessageType.MESSAGE,
		];
		deleted = await store.deleteMessages(delReq);
		expect(deleted).to.equal(2, "number of deleted messages doesn't match");
		messages = await store.getMessages(net, chan, () => id++);
		expect(messages.map((m) => m.type)).to.have.ordered.members([MessageType.AWAY]);
	});
});

describe("SQLite Message Storage", function () {
	// Increase timeout due to unpredictable I/O on CI services
	this.timeout(util.isRunningOnCI() ? 25000 : 5000);
	this.slow(300);

	const expectedPath = path.join(Config.getHomePath(), "logs", "testUser.sqlite3");
	let store: MessageStorage;

	function db_get_one(stmt: string, ...params: SqlValue[]): Promise<Record<string, SqlValue>> {
		try {
			const row = store.database.prepare(stmt).get(...params);
			return Promise.resolve(row);
		} catch (err) {
			return Promise.reject(err instanceof Error ? err : new Error(String(err)));
		}
	}

	before(function (done) {
		store = new MessageStorage("testUser");

		// Delete database file from previous test run
		if (fs.existsSync(expectedPath)) {
			fs.unlink(expectedPath, done);
		} else {
			done();
		}
	});

	after(function (done) {
		// After tests run, remove the logs folder
		// so we return to the clean state
		fs.unlinkSync(expectedPath);
		fs.rmdir(path.join(Config.getHomePath(), "logs"), done);
	});

	it("should create database file", async function () {
		expect(store.isEnabled).to.equal(false);
		expect(fs.existsSync(expectedPath)).to.equal(false);

		await store.enable();
		expect(store.isEnabled).to.equal(true);
	});

	it("should resolve an empty array when disabled", async function () {
		store.isEnabled = false;
		// When disabled, getMessages returns empty array without using params
		const dummyNet: TestNetwork = {uuid: "disabled-test"};
		const dummyChan: TestChannel = {name: "#disabled-test"};
		const messages = await store.getMessages(dummyNet, dummyChan, () => 0);
		expect(messages).to.have.lengthOf(0);
		store.isEnabled = true;
	});

	it("should insert schema version to options table", async function () {
		const row = await db_get_one("SELECT value FROM options WHERE name = 'schema_version'");
		expect(row.value).to.equal(currentSchemaVersion.toString());
	});

	it("should insert migrations", async function () {
		const row = await db_get_one(
			"SELECT id, version FROM migrations WHERE version = ?",
			currentSchemaVersion
		);
		expect(row).to.not.equal(undefined);
	});

	it("should store a message", async function () {
		await store.index(
			{uuid: "this-is-a-network-guid"} as Network,
			{name: "#thisISaCHANNEL"} as Channel,
			new Msg({
				time: 123456789,
				text: "Hello from sqlite world!",
			})
		);
	});

	it("should retrieve previously stored message", async function () {
		let msgid = 0;
		const messages = await store.getMessages(
			{
				uuid: "this-is-a-network-guid",
			} as Network,
			{
				name: "#thisisaCHANNEL",
			} as Channel,
			() => msgid++
		);
		expect(messages).to.have.lengthOf(1);
		const msg = messages[0];
		expect(msg.text).to.equal("Hello from sqlite world!");
		expect(msg.type).to.equal(MessageType.MESSAGE);
		expect(msg.time.getTime()).to.equal(123456789);
	});

	it("should retrieve latest LIMIT messages in order", async function () {
		const originalMaxHistory = Config.values.maxHistory;

		try {
			Config.values.maxHistory = 2;

			for (let i = 0; i < 200; ++i) {
				await store.index(
					{uuid: "retrieval-order-test-network"} as Network,
					{name: "#channel"} as Channel,
					new Msg({
						time: 123456789 + i,
						text: `msg ${i}`,
					})
				);
			}

			let msgId = 0;
			const messages = await store.getMessages(
				{uuid: "retrieval-order-test-network"} as Network,
				{name: "#channel"} as Channel,
				() => msgId++
			);
			expect(messages).to.have.lengthOf(2);
			expect(messages.map((i_1) => i_1.text)).to.deep.equal(["msg 198", "msg 199"]);
		} finally {
			Config.values.maxHistory = originalMaxHistory;
		}
	});

	it("should search messages", async function () {
		const originalMaxHistory = Config.values.maxHistory;

		try {
			Config.values.maxHistory = 2;

			const search = await store.search({
				searchTerm: "msg",
				networkUuid: "retrieval-order-test-network",
				channelName: "",
				offset: 0,
			});
			expect(search.results).to.have.lengthOf(100);
			const expectedMessages: string[] = [];

			for (let i = 100; i < 200; ++i) {
				expectedMessages.push(`msg ${i}`);
			}

			expect(search.results.map((i_1) => i_1.text)).to.deep.equal(expectedMessages);
		} finally {
			Config.values.maxHistory = originalMaxHistory;
		}
	});

	it("should search messages with escaped wildcards", async function () {
		async function assertResults(query: string, expected: string[]) {
			const search = await store.search({
				searchTerm: query,
				networkUuid: "this-is-a-network-guid2",
				channelName: "",
				offset: 0,
			});
			expect(search.results.map((i) => i.text)).to.deep.equal(expected);
		}

		const originalMaxHistory = Config.values.maxHistory;

		try {
			Config.values.maxHistory = 3;

			await store.index(
				{uuid: "this-is-a-network-guid2"} as Network,
				{name: "#channel"} as Channel,
				new Msg({
					time: 123456790,
					text: `foo % bar _ baz`,
				})
			);

			await store.index(
				{uuid: "this-is-a-network-guid2"} as Network,
				{name: "#channel"} as Channel,
				new Msg({
					time: 123456791,
					text: `foo bar x baz`,
				})
			);

			await store.index(
				{uuid: "this-is-a-network-guid2"} as Network,
				{name: "#channel"} as Channel,
				new Msg({
					time: 123456792,
					text: `bar @ baz`,
				})
			);

			await assertResults("foo", ["foo % bar _ baz", "foo bar x baz"]);
			await assertResults("%", ["foo % bar _ baz"]);
			await assertResults("foo % bar ", ["foo % bar _ baz"]);
			await assertResults("_", ["foo % bar _ baz"]);
			await assertResults("bar _ baz", ["foo % bar _ baz"]);
			await assertResults("%%", []);
			await assertResults("@%", []);
			await assertResults("@", ["bar @ baz"]);
		} finally {
			Config.values.maxHistory = originalMaxHistory;
		}
	});

	it("should serve channel history from the composite index", function () {
		const plan = store.database
			.prepare(
				"EXPLAIN QUERY PLAN SELECT id FROM messages WHERE network = ? AND channel = ? ORDER BY time DESC, id DESC LIMIT ?"
			)
			.all("a", "b", 1)
			.map((row) => (row as {detail: string}).detail)
			.join(" | ");

		expect(plan).to.include("network_channel_time");
		expect(plan).to.not.include("TEMP B-TREE"); // i.e. no sort of the whole channel
	});

	it("should page older messages without losing same-millisecond rows", async function () {
		const net = {uuid: "paging-network"} as Network;
		const chan = {name: "#paging"} as Channel;

		// ids are set the way Chan.pushMessage() would, three rows share time 2000
		for (const [id, time] of [
			[101, 1000],
			[102, 2000],
			[103, 2000],
			[104, 2000],
			[105, 3000],
		]) {
			const msg = new Msg({time: time as unknown as Date, text: `paged ${id}`});
			msg.id = id;
			await store.index(net, chan, msg);
		}

		const strict = await store.getMessagesBefore(net.uuid, chan.name, 2000, 10);
		expect(strict.map((m) => m.id)).to.deep.equal([101]);

		const inclusive = await store.getMessagesBefore(net.uuid, chan.name, 2000, 10, true);
		expect(inclusive.map((m) => m.id)).to.deep.equal([101, 102, 103, 104]);

		// newest rows win when the limit cuts the page short, oldest first
		const limited = await store.getMessagesBefore(net.uuid, chan.name, 3000, 2, true);
		expect(limited.map((m) => m.id)).to.deep.equal([104, 105]);
	});

	it("should report the highest id it has stored", async function () {
		const msg = new Msg({time: 4000 as unknown as Date, text: "high id"});
		msg.id = 987654;
		await store.index({uuid: "paging-network"} as Network, {name: "#paging"} as Channel, msg);

		expect(await store.getMaxMessageId()).to.equal(987654);
	});

	it("should build index queries out of trigrams", function () {
		expect(trigramQuery("ab")).to.equal(null);
		expect(trigramQuery("abc")).to.equal('"abc"');
		expect(trigramQuery("abcd")).to.equal('"abc" AND "bcd"');
		expect(trigramQuery("aaaa")).to.equal('"aaa"');
		expect(trigramQuery('a"b c')).to.equal('"a""b" AND """b " AND "b c"');
		// counted by character, not by UTF-16 unit
		expect(trigramQuery("a😀b")).to.equal('"a😀b"');
		expect(trigramQuery("😀b")).to.equal(null);
	});

	// The tests below share these messages and run in order
	const ftsNet = {uuid: "fts-network"} as Network;
	const ftsChan = {name: "#fts"} as Channel;
	const ftsOther = {name: "#fts-other"} as Channel;
	const defaultLimits = {...searchLimits};

	async function find(searchTerm: string, channelName: string) {
		const {results} = await store.search({
			searchTerm,
			networkUuid: ftsNet.uuid,
			channelName,
			offset: 0,
		});

		return results.map((m) => m.text);
	}

	// Runs a search through all three strategies and insists they agree
	async function findEveryWay(searchTerm: string, channelName = ftsChan.name) {
		const found: (string | undefined)[][] = [];

		try {
			for (const limits of [defaultLimits, {direct: 0, filter: 1000}, {direct: 0, filter: 0}]) {
				Object.assign(searchLimits, limits);
				found.push(await find(searchTerm, channelName));
			}
		} finally {
			Object.assign(searchLimits, defaultLimits);
		}

		expect(found[1]).to.deep.equal(found[0], `filtered walk differs for "${searchTerm}"`);
		expect(found[2]).to.deep.equal(found[0], `plain walk differs for "${searchTerm}"`);

		return found[0];
	}

	function indexHits(term: string) {
		return store.database
			.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?")
			.all(trigramQuery(term)).length;
	}

	it("should find the same messages whichever search strategy runs", async function () {
		const texts = [
			"The quick brown fox",
			"quick thinking saves the day",
			'she said "quick" twice',
			"Grüße aus München",
			"100% sure_thing @home",
			"ok",
			"quick quick quick",
		];

		for (const [i, text] of texts.entries()) {
			await store.index(ftsNet, ftsChan, new Msg({time: new Date(5000 + i), text}));
		}

		await store.index(
			ftsNet,
			ftsOther,
			new Msg({time: new Date(6000), text: "quick, elsewhere"})
		);
		await store.index(
			ftsNet,
			ftsChan,
			new Msg({time: new Date(6001), text: "quick join", type: MessageType.JOIN})
		);

		expect(await findEveryWay("quick")).to.deep.equal([
			"The quick brown fox",
			"quick thinking saves the day",
			'she said "quick" twice',
			"quick quick quick",
		]);
		expect(await findEveryWay("QUICK BROWN")).to.deep.equal(["The quick brown fox"]);
		expect(await findEveryWay('"quick"')).to.deep.equal(['she said "quick" twice']);
		expect(await findEveryWay("München")).to.deep.equal(["Grüße aus München"]);
		expect(await findEveryWay("100%")).to.deep.equal(["100% sure_thing @home"]);
		expect(await findEveryWay("sure_thing @h")).to.deep.equal(["100% sure_thing @home"]);
		expect(await findEveryWay("sureXthing")).to.deep.equal([]);
		expect(await findEveryWay("nowhere to be found")).to.deep.equal([]);
		// too short for the index, still found
		expect(await findEveryWay("ok")).to.deep.equal(["ok"]);
	});

	it("should keep searches inside their channel", async function () {
		expect(await findEveryWay("elsewhere")).to.deep.equal([]);
		expect(await findEveryWay("elsewhere", ftsOther.name)).to.deep.equal(["quick, elsewhere"]);
	});

	it("should only index plain messages", async function () {
		expect(await findEveryWay("quick join")).to.deep.equal([]);
		expect(indexHits("quick join")).to.equal(0);
	});

	it("should narrow a search down with the index", function () {
		expect(indexHits("brown fox")).to.equal(1);
		expect(indexHits("nowhere to be found")).to.equal(0);
	});

	it("should drop deleted messages from the index", async function () {
		const before = indexHits("quick");
		await store.deleteChannel(ftsNet, ftsOther);

		expect(indexHits("quick")).to.equal(before - 1);
		expect(await findEveryWay("elsewhere", ftsOther.name)).to.deep.equal([]);
	});

	it("should index existing messages when migrating", async function () {
		// Take the index away the way an older build rolling back would
		const previous = migrations[migrations.length - 2].version;
		await store.downgrade_to(previous);
		store.database
			.prepare("UPDATE options SET value = ? WHERE name = 'schema_version'")
			.run(previous.toString());

		expect(
			store.database.prepare("SELECT name FROM sqlite_master WHERE name = 'messages_fts'").all()
		).to.have.lengthOf(0);

		await store.run_migrations();

		expect(indexHits("brown fox")).to.equal(1);
		expect(await findEveryWay("brown fox")).to.deep.equal(["The quick brown fox"]);
	});

	it("should be able to downgrade", async function () {
		for (const rollback of rollbacks.slice().reverse()) {
			if (rollback.rollback_forbidden) {
				throw Error(
					"Try to write a down migration, if you really can't, flip this to a break"
				);
			}

			const new_version = await store.downgrade_to(rollback.version);
			expect(new_version).to.equal(rollback.version);
		}
	});

	it("should close database", async function () {
		await store.close();
		expect(fs.existsSync(expectedPath)).to.equal(true);
	});
});

function dateAddDays(date: Date, days: number) {
	const ret = new Date(date.valueOf());
	ret.setDate(date.getDate() + days);
	return ret;
}
