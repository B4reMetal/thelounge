import {expect} from "chai";

import Chan from "../../server/models/chan.js";
import Client from "../../server/client.js";
import Msg from "../../server/models/msg.js";
import Config from "../../server/config.js";
import {ChanType} from "../../shared/types/chan.js";

// In-memory stand-in for SqliteMessageStorage, holding rows oldest first
function fakeProvider(stored: Msg[]) {
	return {
		isEnabled: true,
		reads: 0,
		canProvideMessages: () => true,
		getMessages(_network: unknown, _chan: unknown, ensureIdAbove: (maxId: number) => void) {
			this.reads++;
			const page = stored.slice(-Config.values.maxHistory);
			ensureIdAbove(Math.max(0, ...page.map((m) => m.id)));
			return Promise.resolve(page);
		},
		getMessagesBefore(
			_uuid: string,
			_name: string,
			beforeTime: number,
			limit: number,
			inclusive = false
		) {
			const older = stored.filter((m) =>
				inclusive ? m.time.getTime() <= beforeTime : m.time.getTime() < beforeTime
			);
			return Promise.resolve(older.slice(-limit));
		},
	};
}

function message(id: number) {
	const msg = new Msg({time: new Date(id * 1000), text: `message ${id}`});
	msg.id = id;
	return msg;
}

function setup(storedCount: number, clientSettings: Record<string, unknown> = {}) {
	const stored = Array.from({length: storedCount}, (_, i) => message(i + 1));
	const provider = fakeProvider(stored);
	const chan = new Chan({name: "#paging", type: ChanType.CHANNEL});
	const network = {uuid: "net", name: "net", irc: {network: {cap: {isEnabled: () => false}}}};
	const emitted: {event: string; data: any}[] = [];

	const client = Object.create(Client.prototype);
	Object.assign(client, {
		name: "tester",
		idMsg: 1,
		config: {clientSettings},
		messageProvider: provider,
		emit: (event: string, data: unknown) => emitted.push({event, data}),
		find: () => ({network, chan}),
	});

	return {stored, provider, chan, network, client: client as Client, emitted};
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("History paging", function () {
	let originalMaxHistory: number;

	before(function () {
		originalMaxHistory = Config.values.maxHistory;
		Config.values.maxHistory = 150;
	});

	after(function () {
		Config.values.maxHistory = originalMaxHistory;
	});

	it("reads stored history once, however often it is asked to", async function () {
		const {chan, network, client, provider, emitted} = setup(400);

		chan.loadMessages(client, network as any, true);
		chan.loadMessages(client, network as any, true);
		await settle();

		expect(provider.reads).to.equal(1);
		expect(chan.messages.map((m) => m.id)).to.deep.equal(
			Array.from({length: 150}, (_, i) => 251 + i)
		);
		expect(client.idMsg).to.equal(401);

		expect(emitted).to.have.lengthOf(1);
		expect(emitted[0].data.messages).to.have.lengthOf(100);
		expect(emitted[0].data.hasMore).to.equal(true);
	});

	it("does not duplicate messages that arrived before the first open", async function () {
		const {chan, network, client, stored} = setup(50);

		// arrived live since startup: already in memory and already logged
		chan.messages.push(stored[48], stored[49]);

		chan.loadMessages(client, network as any, true);
		await settle();

		expect(chan.messages.map((m) => m.id)).to.deep.equal(
			Array.from({length: 50}, (_, i) => i + 1)
		);
	});

	it("tells clients when a channel has no stored history", async function () {
		const {chan, network, client, emitted} = setup(0);

		chan.loadMessages(client, network as any, true);
		await settle();

		expect(emitted).to.have.lengthOf(1);
		expect(emitted[0].data.messages).to.have.lengthOf(0);
		expect(emitted[0].data.hasMore).to.equal(false);
	});

	it("pages through memory, then storage, down to the first message", async function () {
		const {chan, network, client} = setup(400);

		chan.loadMessages(client, network as any, true);
		await settle();

		// what a client does: start with the newest page, keep asking for older
		const seen: number[] = [];
		let lastId = -1;
		let hasMore = true;
		let requests = 0;

		while (hasMore) {
			const page = await client.more({
				target: chan.id,
				lastId,
				condensed: false,
				beforeTime: seen.length ? seen[0] * 1000 : undefined,
			});

			const fresh = page!.messages.map((m) => m.id).filter((id) => !seen.includes(id));
			seen.unshift(...fresh);
			lastId = seen[0];
			hasMore = page!.hasMore;

			expect(++requests).to.be.lessThan(20, "paging did not terminate");
		}

		expect(seen).to.deep.equal(Array.from({length: 400}, (_, i) => i + 1));
		// storage pages are served from disk, they must not pile up in memory
		expect(chan.messages).to.have.lengthOf(150);
	});

	it("pages by 100 whatever an old enableEnhancedSearch setting says", async function () {
		// user files written before the setting was removed still have it
		const {chan, network, client, emitted} = setup(400, {
			searchEnabled: true,
			enableEnhancedSearch: true,
		});

		chan.loadMessages(client, network as any, true);
		await settle();

		expect(emitted[0].data.messages).to.have.lengthOf(100);

		const page = await client.more({target: chan.id, lastId: 400, condensed: false});
		expect(page!.messages).to.have.lengthOf(100);
		expect(page!.hasMore).to.equal(true);

		const condensed = await client.more({target: chan.id, lastId: 400, condensed: true});
		expect(condensed!.messages).to.have.lengthOf(100);
	});

	it("reports no more history when memory holds everything", async function () {
		const {chan, network, client} = setup(60);

		chan.loadMessages(client, network as any, true);
		await settle();

		const page = await client.more({target: chan.id, lastId: -1, condensed: false});

		expect(page!.messages).to.have.lengthOf(60);
		expect(page!.hasMore).to.equal(false);
	});
});
