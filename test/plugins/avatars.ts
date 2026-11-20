import {expect} from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import _ from "lodash";

import Config, {ConfigType} from "../../server/config.js";
import log from "../../server/log.js";
import avatars, {AvatarJob, AvatarUpdate, avatarLimits} from "../../server/plugins/avatars.js";

const png = Buffer.concat([
	Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
	Buffer.alloc(64, 1),
]);
const png2 = Buffer.concat([
	Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
	Buffer.alloc(64, 2),
]);

describe("Avatars", function () {
	let dir: string;
	let now: number;
	let savedTrackers: ConfigType["trackers"];
	let savedAvatars: ConfigType["avatars"];
	let warn: typeof log.warn;
	let jobs: {socket: string; job: AvatarJob}[];
	let updates: AvatarUpdate[][];

	const user = {
		name: "alice",
		networks: [{host: "irc.seedpool.org"}],
		emit: (_event: "avatars:update", data: AvatarUpdate[]) => updates.push(data),
	};
	const stranger = {
		name: "bob",
		networks: [{host: "irc.example.org"}],
		emit() {
			throw new Error("bob has no Seedpool network");
		},
	};

	const register = (socket = "s1", name = "alice", hosts: unknown = ["seedpool.org"]) =>
		avatars.registerFetcher(socket, name, hosts, (job) => jobs.push({socket, job}));

	const tick = (advanceMs = 0) => {
		now += advanceMs;
		avatars.tick();
	};

	beforeEach(function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "avatars-test-"));
		now = 1_800_000_000_000;
		jobs = [];
		updates = [];
		savedTrackers = _.cloneDeep(Config.values.trackers);
		savedAvatars = _.cloneDeep(Config.values.avatars);
		// eslint-disable-next-line @typescript-eslint/unbound-method
		warn = log.warn;

		log.warn = () => {};

		Config.values.trackers = {
			SP: {
				name: "Seedpool",
				network: "irc.seedpool.org",
				profileUrl: "https://seedpool.org/users/{nick}",
				avatarUrl: "https://seedpool.org/authenticated-images/user-avatars/{nick}",
			},
			NOAV: {name: "No avatars", network: "irc.example.org"},
		};
		Config.values.avatars = {enable: true, ratePerMinute: 5, refreshDays: 30, notFoundDays: 7};

		avatars.init({dir, now: () => now, tick: false, users: () => [user, stranger]});
	});

	afterEach(function () {
		avatars.stop();
		avatars.unregisterFetcher("s1");
		avatars.unregisterFetcher("s2");
		Config.values.trackers = savedTrackers;
		Config.values.avatars = savedAvatars;
		log.warn = warn;
		fs.rmSync(dir, {recursive: true, force: true});
	});

	it("marks trackers with an avatar address for the client", function () {
		const trackers = Config.getTrackersForHost("irc.seedpool.org");
		expect(trackers?.[0]).to.include({id: "SP", avatars: true});
		expect(Config.getTrackersForHost("irc.example.org")?.[0].avatars).to.equal(undefined);
	});

	it("queues people who speak, only on networks of a tracker with avatars", function () {
		avatars.noteSpeaker({host: "irc.seedpool.org"}, "Iroha", "#seedpool");
		avatars.noteSpeaker({host: "irc.example.org"}, "Someone", "#example");
		expect(avatars.getQueue().map((j) => j.nick)).to.deep.equal(["Iroha"]);
	});

	it("ignores odd nicks", function () {
		avatars.want("SP", "has space", 0);
		avatars.want("SP", "a".repeat(avatarLimits.maxNickLength + 1), 0);
		avatars.want("SP", "", 0);
		expect(avatars.getQueue()).to.have.length(0);
	});

	it("hands out jobs only to a fetcher of a user on the tracker's network, within the rate", function () {
		avatars.want("SP", "Iroha", 0);
		avatars.want("SP", "Hori", 0);

		tick();
		expect(jobs).to.have.length(0); // no fetcher yet

		register("s2", "bob");
		tick();
		expect(jobs).to.have.length(0); // bob isn't on Seedpool

		register("s1", "alice", ["example.org"]);
		tick();
		expect(jobs).to.have.length(0); // can't reach seedpool.org

		register("s1", "alice");
		tick();
		expect(jobs).to.have.length(1);
		expect(jobs[0].job.url).to.equal(
			"https://seedpool.org/authenticated-images/user-avatars/Iroha"
		);

		// Answer it, then the next one waits for the rate interval (12 s at 5/min)
		avatars.handleResult("s1", {id: jobs[0].job.id, status: 404});
		tick(11_000);
		expect(jobs).to.have.length(1);
		tick(1_000);
		expect(jobs).to.have.length(2);
		expect(jobs[1].job.url).to.match(/Hori$/);
	});

	it("puts nicks someone opened ahead of speakers", function () {
		avatars.want("SP", "Speaker", 0);
		now += 1;
		avatars.want("SP", "Opened", 1);
		register();
		tick();
		expect(jobs[0].job.url).to.match(/Opened$/);
	});

	it("stores an image, tells users on the tracker's network, and serves it from the cache", function () {
		avatars.want("SP", "Iroha", 1);
		register();
		tick();
		avatars.handleResult("s1", {
			id: jobs[0].job.id,
			status: 200,
			contentType: "image/png",
			lastModified: "Wed, 28 Jan 2026 22:07:56 GMT",
			data: png,
		});

		const entry = avatars.getEntry("SP", "iroha");
		expect(entry?.status).to.equal("ok");
		expect(fs.readFileSync(path.join(dir, entry!.file!))).to.deep.equal(png);
		expect(updates).to.deep.equal([
			[{tracker: "SP", nick: "iroha", url: `avatars/${entry!.file}`}],
		]);
		expect(avatars.listFor(user)).to.deep.equal([
			{tracker: "SP", nick: "iroha", url: `avatars/${entry!.file}`},
		]);
		expect(avatars.listFor(stranger)).to.deep.equal([]);
	});

	it("ignores results from another socket", function () {
		avatars.want("SP", "Iroha", 1);
		register();
		tick();
		avatars.handleResult("s2", {id: jobs[0].job.id, status: 200, data: png});
		expect(avatars.getEntry("SP", "Iroha")).to.equal(undefined);
	});

	it("doesn't look up a cached avatar again until it's due, then asks whether it changed", function () {
		avatars.want("SP", "Iroha", 1);
		register();
		tick();
		avatars.handleResult("s1", {
			id: jobs[0].job.id,
			status: 200,
			lastModified: "LM1",
			data: png,
		});

		tick(60_000);
		avatars.want("SP", "Iroha", 0);
		expect(avatars.getQueue()).to.have.length(0);

		now += 31 * 24 * 3600 * 1000;
		avatars.want("SP", "Iroha", 0);
		tick();
		expect(jobs[1].job.ifModifiedSince).to.equal("LM1");

		const fetchedBefore = avatars.getEntry("SP", "Iroha")!.fetchedAt;
		avatars.handleResult("s1", {id: jobs[1].job.id, status: 304});
		expect(avatars.getEntry("SP", "Iroha")!.fetchedAt).to.be.greaterThan(fetchedBefore);
	});

	it("replaces the file when the avatar changed", function () {
		avatars.want("SP", "Iroha", 1);
		register();
		tick();
		avatars.handleResult("s1", {id: jobs[0].job.id, status: 200, data: png});
		const first = avatars.getEntry("SP", "Iroha")!.file!;

		now += 31 * 24 * 3600 * 1000;
		avatars.want("SP", "Iroha", 1);
		tick();
		avatars.handleResult("s1", {id: jobs[1].job.id, status: 200, data: png2});
		const second = avatars.getEntry("SP", "Iroha")!.file!;

		expect(second).to.not.equal(first);
		expect(fs.existsSync(path.join(dir, second))).to.equal(true);
	});

	it("remembers that a user has no avatar", function () {
		avatars.want("SP", "Nobody", 1);
		register();
		tick();
		avatars.handleResult("s1", {id: jobs[0].job.id, status: 404});
		expect(avatars.getEntry("SP", "Nobody")?.status).to.equal("none");

		now += 6 * 24 * 3600 * 1000;
		avatars.want("SP", "Nobody", 0);
		expect(avatars.getQueue()).to.have.length(0);

		now += 2 * 24 * 3600 * 1000;
		avatars.want("SP", "Nobody", 0);
		expect(avatars.getQueue()).to.have.length(1);
	});

	it("rejects things that aren't images, and images that are too big", function () {
		avatars.want("SP", "Text", 1);
		avatars.want("SP", "Huge", 1);
		register();
		tick();
		avatars.handleResult("s1", {
			id: jobs[0].job.id,
			status: 200,
			contentType: "image/png",
			data: Buffer.from("<svg/>"),
		});
		tick(12_000);
		const huge = Buffer.concat([png, Buffer.alloc(avatarLimits.maxBytes)]);
		avatars.handleResult("s1", {
			id: jobs[1].job.id,
			status: 200,
			contentType: "image/png",
			data: huge,
		});

		expect(avatars.getEntry("SP", "Text")?.status).to.equal("none");
		expect(avatars.getEntry("SP", "Huge")?.status).to.equal("none");
		expect(
			fs.readdirSync(dir).filter((f) => !["secret", "index.json"].includes(f))
		).to.deep.equal([]);
	});

	it("pauses the tracker when the browser isn't logged in, and keeps the job", function () {
		avatars.want("SP", "Iroha", 1);
		register();
		tick();
		avatars.handleResult("s1", {
			id: jobs[0].job.id,
			status: 200,
			contentType: "text/html",
			finalUrl: "https://seedpool.org/login",
		});

		expect(avatars.getEntry("SP", "Iroha")).to.equal(undefined);
		expect(avatars.getQueue().map((j) => j.nick)).to.deep.equal(["Iroha"]);

		tick(29 * 60 * 1000);
		expect(jobs).to.have.length(1);
		tick(2 * 60 * 1000);
		expect(jobs).to.have.length(2);
	});

	it("backs off when the tracker is busy", function () {
		avatars.want("SP", "Iroha", 1);
		register();
		tick();
		avatars.handleResult("s1", {id: jobs[0].job.id, status: 429});
		tick(30_000);
		expect(jobs).to.have.length(1);
		tick(31_000);
		expect(jobs).to.have.length(2);
	});

	it("gives a fetcher's jobs back when it disconnects", function () {
		avatars.want("SP", "Iroha", 1);
		register();
		tick();
		avatars.unregisterFetcher("s1");
		expect(avatars.getQueue().map((j) => j.nick)).to.deep.equal(["Iroha"]);
	});

	it("keeps the cache across restarts", function () {
		avatars.want("SP", "Iroha", 1);
		register();
		tick();
		avatars.handleResult("s1", {id: jobs[0].job.id, status: 200, data: png});
		const file = avatars.getEntry("SP", "Iroha")!.file;
		avatars.stop();

		avatars.init({dir, now: () => now, tick: false, users: () => [user]});
		expect(avatars.getEntry("SP", "Iroha")?.file).to.equal(file);
	});

	it("does nothing when turned off", function () {
		Config.values.avatars.enable = false;
		avatars.noteSpeaker({host: "irc.seedpool.org"}, "Iroha", "#seedpool");
		expect(avatars.getQueue()).to.have.length(0);
		expect(avatars.listFor(user)).to.deep.equal([]);
	});
});
