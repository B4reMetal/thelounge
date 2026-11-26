import {EventEmitter} from "events";
import {expect} from "chai";
import type Client from "../../../server/client.js";
import Config from "../../../server/config.js";
import Chan from "../../../server/models/chan.js";
import Msg from "../../../server/models/msg.js";
import Network from "../../../server/models/network.js";
import message from "../../../server/plugins/irc-events/message.js";
import {ChanState} from "../../../shared/types/chan.js";

type Pushed = {title: string; body: string};

const wasPublic = Config.values.public;

function setup(notifyAllMessages?: boolean) {
	const irc = Object.assign(new EventEmitter(), {user: {nick: "me"}});
	const chan = new Chan({name: "#test", state: ChanState.JOINED});
	const network = new Network({host: "example.com", channels: [chan]});
	network.highlightRegex = /\bme\b/i;

	const pushed: Pushed[] = [];
	const emitted: {msg: Msg}[] = [];
	const client = {
		idMsg: 1,
		attachedClients: {},
		messageStorage: [],
		mentions: [],
		config: {clientSettings: {notifyAllMessages}},
		manager: {
			webPush: {
				push(_client: unknown, payload: Pushed) {
					pushed.push(payload);
				},
			},
		},
		emit(event: string, data: {msg: Msg}) {
			if (event === "msg") {
				emitted.push(data);
			}
		},
	};

	message.call(
		client as unknown as Client,
		irc as unknown as Parameters<typeof message>[0],
		network as Parameters<typeof message>[1]
	);

	const say = (text: string, extra: Record<string, unknown> = {}) =>
		irc.emit("privmsg", {nick: "bob", target: "#test", message: text, ...extra});

	return {irc, chan, pushed, emitted, say};
}

describe("message event web push", function () {
	it("pushes highlights only by default", function () {
		const {pushed, say} = setup();

		say("hello everyone");
		say("hello me");

		expect(pushed.map((p) => p.body)).to.deep.equal(["bob: hello me"]);
	});

	it("pushes every message when notify for all messages is on", function () {
		const {pushed, say} = setup(true);

		say("hello everyone");

		expect(pushed).to.have.lengthOf(1);
		expect(pushed[0]).to.include({title: "#test", body: "bob: hello everyone"});
	});

	it("still leaves out own, muted, old and non-message lines", function () {
		const {irc, chan, pushed, say} = setup(true);

		say("my own line", {nick: "me"});
		say("from the bouncer buffer", {time: Date.now() - 60 * 60 * 1000});
		irc.emit("notice", {nick: "bob", target: "#test", message: "a notice"});
		chan.muted = true;
		say("in a muted channel");

		expect(pushed).to.have.lengthOf(0);
	});
});

describe("message event msgid", function () {
	it("keeps the id the server tagged the message with", function () {
		const {chan, say, irc} = setup();
		Config.values.public = false;

		try {
			say("tagged", {tags: {msgid: "abc123", time: "2026-01-01T00:00:00.000Z"}});
			say("untagged", {tags: {}});
			say("empty id", {tags: {msgid: ""}});
			say("no tags at all");
			irc.emit("notice", {
				nick: "bob",
				target: "#test",
				message: "a notice",
				tags: {msgid: "notice1"},
			});
			irc.emit("action", {
				nick: "bob",
				target: "#test",
				message: "waves",
				tags: {msgid: "action1"},
			});
		} finally {
			Config.values.public = wasPublic;
		}

		expect(chan.messages.map((m) => m.msgid)).to.deep.equal([
			"abc123",
			undefined,
			undefined,
			undefined,
			"notice1",
			"action1",
		]);
	});

	it("sends it to the browser with the message", function () {
		const {say, emitted} = setup();

		say("tagged", {tags: {msgid: "abc123"}});

		expect(emitted.map((e) => e.msg.msgid)).to.deep.equal(["abc123"]);
	});
});
