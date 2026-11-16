import {expect} from "chai";

import {
	leaveHistorySlice,
	liveMessageLimit,
	prependMessages,
	receiveLiveMessage,
	showMessagesAfter,
	showMessagesAround,
	trimMessages,
} from "../../client/js/chan.js";
import type {ClientChan} from "../../client/js/types";
import type {SharedMsg} from "../../shared/types/msg";

// One message a second, id n was sent at second n
const msg = (n: number) => ({id: n, time: new Date(n * 1000), text: `m${n}`}) as unknown as SharedMsg;
const range = (from: number, to: number) =>
	Array.from({length: to - from + 1}, (_, i) => msg(from + i));
const ids = (channel: ClientChan) => channel.messages.map((m) => m.id);

function channelWith(messages: SharedMsg[]) {
	return {id: 1, messages, moreHistoryAvailable: true, historyLoading: false} as ClientChan;
}

describe("History slices (jump to message)", function () {
	it("adds history that connects to what is loaded in front of it", function () {
		const channel = channelWith(range(900, 1000));

		showMessagesAround(channel, {
			messages: range(850, 910),
			hasMoreBefore: true,
			hasMoreAfter: true,
		});

		expect(channel.historySlice).to.equal(undefined);
		expect(ids(channel)).to.deep.equal(range(850, 1000).map((m) => m.id));
		expect(channel.moreHistoryAvailable).to.equal(true);
	});

	it("replaces what is loaded when the history doesn't connect to it", function () {
		const channel = channelWith(range(900, 1000));

		showMessagesAround(channel, {
			messages: range(100, 300),
			hasMoreBefore: false,
			hasMoreAfter: true,
		});

		expect(channel.historySlice?.hasNewer).to.equal(true);
		expect(ids(channel)).to.deep.equal(range(100, 300).map((m) => m.id));
		expect(channel.moreHistoryAvailable).to.equal(false);
	});

	it("tells a reused id apart by its time", function () {
		// id 950 again, from an earlier run of the server
		const old = {...msg(950), time: new Date(200 * 1000)} as SharedMsg;
		const channel = channelWith(range(900, 1000));

		showMessagesAround(channel, {
			messages: [msg(199), old, msg(201)],
			hasMoreBefore: true,
			hasMoreAfter: true,
		});

		expect(channel.historySlice).to.not.equal(undefined);
		expect(channel.messages).to.have.lengthOf(3);
	});

	it("keeps a reused id when adding connected history in front", function () {
		// id 950 again, from an earlier run of the server, next to messages that connect
		const old = {...msg(950), time: new Date(899500)} as SharedMsg;
		const channel = channelWith(range(900, 1000));

		showMessagesAround(channel, {
			messages: [msg(899), old, msg(900)],
			hasMoreBefore: true,
			hasMoreAfter: true,
		});

		expect(channel.historySlice).to.equal(undefined);
		expect(channel.messages.slice(0, 3)).to.deep.equal([msg(899), old, msg(900)]);
		expect(channel.messages).to.have.lengthOf(103);
	});

	it("prepends older pages by id and time", function () {
		const channel = channelWith(range(900, 1000));
		const old = {...msg(950), time: new Date(100 * 1000)} as SharedMsg;

		// a page the client already has part of, plus a different message reusing an id
		const added = prependMessages(channel, [old, ...range(890, 905)]);

		expect(added).to.equal(11);
		expect(channel.messages[0]).to.equal(old);
		expect(ids(channel).slice(1)).to.deep.equal(range(890, 1000).map((m) => m.id));
	});

	it("keeps live messages out of a slice and adds them once it reaches the present", function () {
		const channel = channelWith(range(900, 1000));

		showMessagesAround(channel, {
			messages: range(100, 300),
			hasMoreBefore: true,
			hasMoreAfter: true,
		});

		expect(receiveLiveMessage(channel, msg(1001))).to.equal(false);
		expect(ids(channel)).to.not.include(1001);

		showMessagesAfter(channel, {messages: range(300, 600), hasMore: true});
		expect(channel.historySlice?.hasNewer).to.equal(true);
		expect(ids(channel)).to.deep.equal(range(100, 600).map((m) => m.id));

		// the last page: storage already has 1001, and 1002 arrives meanwhile
		expect(receiveLiveMessage(channel, msg(1002))).to.equal(false);
		showMessagesAfter(channel, {messages: range(600, 1001), hasMore: false});

		expect(channel.historySlice).to.equal(undefined);
		expect(ids(channel)).to.deep.equal(range(100, 1002).map((m) => m.id));

		expect(receiveLiveMessage(channel, msg(1003))).to.equal(true);
		expect(ids(channel).slice(-1)).to.deep.equal([1003]);
	});

	it("goes back to storage when too many live messages piled up", function () {
		const channel = channelWith([]);

		showMessagesAround(channel, {
			messages: range(100, 300),
			hasMoreBefore: true,
			hasMoreAfter: true,
		});

		for (const live of range(2000, 2600)) {
			receiveLiveMessage(channel, live);
		}

		expect(channel.historySlice?.liveDropped).to.equal(true);

		// a "last" page read before those were dropped can't close the gap
		showMessagesAfter(channel, {messages: range(300, 400), hasMore: false});
		expect(channel.historySlice).to.not.equal(undefined);
		expect(channel.historySlice?.hasNewer).to.equal(true);

		// the next request does: the list clears the flag when it asks
		channel.historySlice!.liveDropped = false;
		showMessagesAfter(channel, {messages: range(400, 2600), hasMore: false});
		expect(channel.historySlice).to.equal(undefined);
		expect(new Set(ids(channel)).size).to.equal(channel.messages.length);
		expect(ids(channel).slice(-1)).to.deep.equal([2600]);
	});

	it("treats history that reaches the newest stored message as the present", function () {
		const channel = channelWith([msg(5000)]); // only in memory, e.g. not logged

		showMessagesAround(channel, {
			messages: range(100, 300),
			hasMoreBefore: true,
			hasMoreAfter: false,
		});

		expect(channel.historySlice).to.equal(undefined);
		expect(ids(channel)).to.deep.equal([...range(100, 300).map((m) => m.id), 5000]);
	});

	it("stops asking when a full page brings nothing new", function () {
		const channel = channelWith([]);

		showMessagesAround(channel, {
			messages: range(100, 300),
			hasMoreBefore: true,
			hasMoreAfter: true,
		});
		showMessagesAfter(channel, {messages: range(250, 300), hasMore: true});

		expect(channel.historySlice?.hasNewer).to.equal(false);
	});

	it("empties the channel when the slice is left", function () {
		const channel = channelWith(range(900, 1000));

		leaveHistorySlice(channel);
		expect(channel.messages).to.have.lengthOf(101); // not a slice: untouched

		showMessagesAround(channel, {
			messages: range(100, 300),
			hasMoreBefore: false,
			hasMoreAfter: true,
		});
		leaveHistorySlice(channel);

		expect(channel.historySlice).to.equal(undefined);
		expect(channel.messages).to.have.lengthOf(0);
		expect(channel.moreHistoryAvailable).to.equal(true);
	});
});

describe("Trimming what the client holds in memory", function () {
	it("keeps only the newest messages and says there is more", function () {
		const channel = channelWith(range(1, 300));
		channel.moreHistoryAvailable = false;

		trimMessages(channel, 100);

		expect(ids(channel)).to.deep.equal(range(201, 300).map((m) => m.id));
		expect(channel.moreHistoryAvailable).to.equal(true);
	});

	it("leaves a channel under the limit, or without one, alone", function () {
		const channel = channelWith(range(1, 50));
		channel.moreHistoryAvailable = false;

		trimMessages(channel, 100);
		trimMessages(channel, 0);

		expect(channel.messages).to.have.lengthOf(50);
		expect(channel.moreHistoryAvailable).to.equal(false);
	});

	it("never cuts a history slice", function () {
		const channel = channelWith(range(900, 1000));

		showMessagesAround(channel, {
			messages: range(100, 300),
			hasMoreBefore: true,
			hasMoreAfter: true,
		});

		trimMessages(channel, 100);

		expect(ids(channel)).to.deep.equal(range(100, 300).map((m) => m.id));
	});

	it("holds on to everything while the user reads older messages", function () {
		const channel = channelWith(range(1, 3000));

		channel.scrolledToBottom = false;
		expect(liveMessageLimit(channel, true)).to.equal(0);

		// e.g. after a jump that added the history around a message
		trimMessages(channel, liveMessageLimit(channel, true));
		expect(channel.messages).to.have.lengthOf(3000);

		channel.scrolledToBottom = true;
		expect(liveMessageLimit(channel, true)).to.equal(1500);
		expect(liveMessageLimit(channel, false)).to.equal(100);
	});
});
