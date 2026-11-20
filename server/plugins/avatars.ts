import crypto from "crypto";
import fs from "fs";
import path from "path";

import Config from "../config.js";
import log from "../log.js";
import {isUsableAvatarUrl, trackerNickPlaceholder} from "../../shared/trackers.js";

/**
 * Avatars for tracker users (trackers with an `avatarUrl`).
 *
 * Tracker avatars need a login, so the server never fetches them itself. A
 * browser that is logged in to the tracker registers as a "fetcher" (through
 * the avatar userscript a theme provides). The server decides who to look up,
 * hands the fetcher one job at a time within the rate limit, checks what comes
 * back, and caches the images on disk for every client of every user.
 *
 * Who is looked up: people who speak in a tracker's channels (low priority)
 * and nicks someone opens (high priority). Never whole user lists.
 */

export type AvatarStatus = "ok" | "none";

type Entry = {
	status: AvatarStatus;
	file?: string;
	lastModified?: string;
	fetchedAt: number;
	seenAt: number;
};

type Job = {key: string; tracker: string; nick: string; priority: number; queuedAt: number};

export type AvatarJob = {id: string; url: string; ifModifiedSince?: string};

export type AvatarResult = {
	id: string;
	status: number;
	contentType?: string;
	lastModified?: string;
	finalUrl?: string;
	data?: Buffer | ArrayBuffer | Uint8Array;
};

export type AvatarUpdate = {tracker: string; nick: string; url: string | null};

// Where someone spoke or was opened: a channel (by name) or a private message
export type AvatarScope = {channel?: string; query?: boolean};

type Fetcher = {
	socketId: string;
	userName: string;
	hosts: Set<string>;
	busy: boolean;
	emit: (job: AvatarJob) => void;
};

type Pending = {job: Job; socketId: string; timer: NodeJS.Timeout};

// What the server needs to know about users and their networks
export type AvatarUser = {
	name: string;
	networks: {host: string; irc?: {network?: {server?: string}}}[];
	emit: (event: "avatars:update", data: AvatarUpdate[]) => void;
};

export const avatarLimits = {
	maxBytes: 512 * 1024, // socket.io's default frame limit is ~1 MB
	maxQueue: 200,
	maxLowPriorityQueue: 100,
	lowPriorityMaxAgeMs: 60 * 60 * 1000,
	jobTimeoutMs: 60 * 1000,
	loginPauseMs: 30 * 60 * 1000,
	maxBackoffMs: 15 * 60 * 1000,
	maxNickLength: 64,
	maxHosts: 16,
};

const imageTypes: {ext: string; type: string; test: (b: Buffer) => boolean}[] = [
	{ext: "png", type: "image/png", test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47},
	{
		ext: "jpg",
		type: "image/jpeg",
		test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	},
	{
		ext: "gif",
		type: "image/gif",
		test: (b) => b.length > 6 && b.toString("ascii", 0, 4) === "GIF8",
	},
	{
		ext: "webp",
		type: "image/webp",
		test: (b) =>
			b.length > 12 &&
			b.toString("ascii", 0, 4) === "RIFF" &&
			b.toString("ascii", 8, 12) === "WEBP",
	},
];

export const avatarContentTypes: Record<string, string> = Object.fromEntries(
	imageTypes.map((t) => [t.ext, t.type])
);

export const avatarFileRegex = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;

const nickRegex = /^[^\s,*?!@:]+$/;

class Avatars {
	private dir = "";
	private secret = "";
	private entries = new Map<string, Entry>();
	private queue = new Map<string, Job>();
	private pending = new Map<string, Pending>();
	private fetchers = new Map<string, Fetcher>();
	private lastAssignAt = new Map<string, number>();
	private pausedUntil = new Map<string, number>();
	private backoffMs = new Map<string, number>();
	private saveTimer: NodeJS.Timeout | null = null;
	private tickTimer: NodeJS.Timeout | null = null;
	private users: () => AvatarUser[] = () => [];
	private now: () => number = Date.now;

	/** Loads the cache and starts handing out jobs. */
	init(options: {users: () => AvatarUser[]; dir?: string; now?: () => number; tick?: boolean}) {
		this.users = options.users;
		this.now = options.now || Date.now;
		this.dir = options.dir || path.join(Config.getHomePath(), "cache", "avatars");
		this.entries.clear();
		this.queue.clear();
		this.lastAssignAt.clear();
		this.pausedUntil.clear();
		this.backoffMs.clear();

		for (const p of this.pending.values()) {
			clearTimeout(p.timer);
		}

		this.pending.clear();

		fs.mkdirSync(this.dir, {recursive: true, mode: 0o700});
		this.secret = this.loadSecret();
		this.loadIndex();

		if (options.tick !== false && !this.tickTimer) {
			this.tickTimer = setInterval(() => this.tick(), 1000);
			this.tickTimer.unref();
		}
	}

	stop() {
		if (this.tickTimer) {
			clearInterval(this.tickTimer);
			this.tickTimer = null;
		}

		for (const p of this.pending.values()) {
			clearTimeout(p.timer);
		}

		this.pending.clear();
		this.flush();
	}

	get enabled() {
		return Boolean(Config.values.avatars?.enable) && this.dir !== "";
	}

	getDir() {
		return this.dir;
	}

	/** The avatar address for a tracker and nick, from config.js. */
	avatarUrlFor(tracker: string, nick: string): string | null {
		const t = Config.values.trackers?.[tracker];

		if (!t || t.disabled || !isUsableAvatarUrl(t.avatarUrl)) {
			return null;
		}

		return t.avatarUrl.replace(trackerNickPlaceholder, encodeURIComponent(nick));
	}

	/**
	 * Trackers with avatars whose users chat on this network. With a scope,
	 * only those that apply there: in a channel, trackers without a channel
	 * list or that list it; in a private message, only trackers without a
	 * channel list (the same rule as tracker profile links).
	 */
	trackersFor(network: AvatarUser["networks"][number], scope?: AvatarScope): string[] {
		const trackers =
			Config.getTrackersForHost(network.host, network.irc?.network?.server) || [];
		const chan = scope?.channel?.toLowerCase();

		return trackers
			.filter((t) => t.avatars)
			.filter((t) => {
				if (!t.channels || !scope) {
					return true;
				}

				return !scope.query && !!chan && t.channels.some((c) => c.toLowerCase() === chan);
			})
			.map((t) => t.id);
	}

	/** Someone spoke: look them up if we don't know their avatar yet. */
	noteSpeaker(network: AvatarUser["networks"][number], nick: string, scope: AvatarScope) {
		if (!this.enabled) {
			return;
		}

		for (const tracker of this.trackersFor(network, scope)) {
			this.want(tracker, nick, 0);
		}
	}

	/** Queue a lookup unless the cache is still fresh. Priority 1 = someone opened this nick. */
	want(tracker: string, nick: string, priority: 0 | 1) {
		if (!this.enabled || typeof nick !== "string" || !this.avatarUrlFor(tracker, nick)) {
			return;
		}

		if (
			nick.length === 0 ||
			nick.length > avatarLimits.maxNickLength ||
			!nickRegex.test(nick)
		) {
			return;
		}

		const key = `${tracker}:${nick.toLowerCase()}`;
		const now = this.now();
		const entry = this.entries.get(key);

		if (entry) {
			entry.seenAt = now;

			if (this.isFresh(entry, now)) {
				return;
			}
		}

		if ([...this.pending.values()].some((p) => p.job.key === key)) {
			return;
		}

		const existing = this.queue.get(key);

		if (existing) {
			existing.priority = Math.max(existing.priority, priority);
			return;
		}

		const low = [...this.queue.values()].filter((j) => j.priority === 0).length;

		if (
			this.queue.size >= avatarLimits.maxQueue ||
			(priority === 0 && low >= avatarLimits.maxLowPriorityQueue)
		) {
			return;
		}

		this.queue.set(key, {key, tracker, nick, priority, queuedAt: now});
	}

	private isFresh(entry: Entry, now: number) {
		const avatars = Config.values.avatars;
		const days = entry.status === "ok" ? avatars.refreshDays : avatars.notFoundDays;
		return now - entry.fetchedAt < Math.max(0, Number(days) || 0) * 24 * 3600 * 1000;
	}

	/** A browser that can fetch from these hosts (logged in there) offers to help. */
	registerFetcher(
		socketId: string,
		userName: string,
		hosts: unknown,
		emit: (job: AvatarJob) => void
	) {
		if (!Array.isArray(hosts)) {
			return;
		}

		const clean = hosts
			.filter((h): h is string => typeof h === "string" && /^[a-z0-9.-]{1,253}$/i.test(h))
			.slice(0, avatarLimits.maxHosts)
			.map((h) => h.toLowerCase());

		if (clean.length === 0) {
			this.unregisterFetcher(socketId);
			return;
		}

		const existing = this.fetchers.get(socketId);

		if (!existing) {
			log.info(
				`Avatars: a browser of ${userName} can fetch avatars from ${clean.join(", ")}`
			);
		}

		this.fetchers.set(socketId, {
			socketId,
			userName,
			hosts: new Set(clean),
			busy: existing?.busy || false,
			emit,
		});
	}

	unregisterFetcher(socketId: string) {
		this.fetchers.delete(socketId);

		for (const [id, p] of this.pending) {
			if (p.socketId === socketId) {
				clearTimeout(p.timer);
				this.pending.delete(id);
				this.requeue(p.job);
			}
		}
	}

	/** Hands out at most one job per tracker per rate interval. Called every second. */
	tick() {
		if (!this.enabled || this.queue.size === 0 || this.fetchers.size === 0) {
			return;
		}

		const now = this.now();
		const rate = Math.max(1, Number(Config.values.avatars.ratePerMinute) || 1);
		const interval = 60000 / rate;

		// Drop speaker lookups that waited too long
		for (const [key, job] of this.queue) {
			if (job.priority === 0 && now - job.queuedAt > avatarLimits.lowPriorityMaxAgeMs) {
				this.queue.delete(key);
			}
		}

		const trackers = new Set([...this.queue.values()].map((j) => j.tracker));

		for (const tracker of trackers) {
			if (now < (this.pausedUntil.get(tracker) || 0)) {
				continue;
			}

			if (now - (this.lastAssignAt.get(tracker) ?? -Infinity) < interval) {
				continue;
			}

			const job = this.nextJob(tracker);

			if (!job) {
				continue;
			}

			const url = this.avatarUrlFor(tracker, job.nick);

			if (!url) {
				this.queue.delete(job.key);
				continue;
			}

			const fetcher = this.pickFetcher(tracker, new URL(url).hostname.toLowerCase());

			if (!fetcher) {
				continue;
			}

			this.queue.delete(job.key);
			this.lastAssignAt.set(tracker, now);
			fetcher.busy = true;

			const id = crypto.randomBytes(12).toString("hex");
			const entry = this.entries.get(job.key);
			const timer = setTimeout(() => this.timeout(id), avatarLimits.jobTimeoutMs);
			timer.unref();
			this.pending.set(id, {job, socketId: fetcher.socketId, timer});

			fetcher.emit({
				id,
				url,
				ifModifiedSince: entry?.status === "ok" ? entry.lastModified : undefined,
			});
		}
	}

	private nextJob(tracker: string) {
		let best: Job | undefined;

		for (const job of this.queue.values()) {
			if (job.tracker !== tracker) {
				continue;
			}

			if (
				!best ||
				job.priority > best.priority ||
				(job.priority === best.priority && job.queuedAt < best.queuedAt)
			) {
				best = job;
			}
		}

		return best;
	}

	// A fetcher that can reach the host, belongs to a user on one of the tracker's networks, and is idle
	private pickFetcher(tracker: string, host: string) {
		const users = this.users();

		for (const f of this.fetchers.values()) {
			if (f.busy || !f.hosts.has(host)) {
				continue;
			}

			const user = users.find((u) => u.name === f.userName);

			if (user && user.networks.some((n) => this.trackersFor(n).includes(tracker))) {
				return f;
			}
		}

		return undefined;
	}

	private timeout(id: string) {
		const p = this.pending.get(id);

		if (!p) {
			return;
		}

		this.pending.delete(id);
		const f = this.fetchers.get(p.socketId);

		if (f) {
			f.busy = false;
		}

		this.requeue(p.job);
	}

	private requeue(job: Job) {
		if (!this.queue.has(job.key)) {
			this.queue.set(job.key, {...job, queuedAt: this.now()});
		}
	}

	/** What a fetcher got back. Only accepted from the socket the job went to. */
	handleResult(socketId: string, result: AvatarResult) {
		if (!result || typeof result.id !== "string") {
			return;
		}

		const p = this.pending.get(result.id);

		if (!p || p.socketId !== socketId) {
			return;
		}

		clearTimeout(p.timer);
		this.pending.delete(result.id);

		const fetcher = this.fetchers.get(socketId);

		if (fetcher) {
			fetcher.busy = false;
		}

		const {job} = p;
		const now = this.now();
		const status = Number(result.status) || 0;
		const type = String(result.contentType || "").toLowerCase();
		const finalUrl = String(result.finalUrl || "");
		const entry = this.entries.get(job.key);

		if (status === 304 && entry?.status === "ok") {
			entry.fetchedAt = now;
			this.resetBackoff(job.tracker);
			this.scheduleSave();
			return;
		}

		// Sent to the login page: this browser isn't logged in to the tracker
		if (
			/\/login(\/|\?|#|$)/.test(finalUrl) ||
			(status === 200 && type.startsWith("text/html"))
		) {
			this.pausedUntil.set(job.tracker, now + avatarLimits.loginPauseMs);
			this.requeue(job);
			log.warn(
				`Avatars: the browser fetching ${job.tracker} avatars isn't logged in there; pausing for 30 minutes.`
			);
			return;
		}

		if (status === 200) {
			const data = toBuffer(result.data);
			const kind =
				data && data.length <= avatarLimits.maxBytes
					? imageTypes.find((t) => t.test(data))
					: undefined;

			if (data && kind) {
				this.store(job, data, kind.ext, result.lastModified, now);
				this.resetBackoff(job.tracker);
				return;
			}

			this.markNone(job, now);
			return;
		}

		if (status === 429 || status >= 500 || status === 0) {
			const next = Math.min(
				Math.max((this.backoffMs.get(job.tracker) || 0) * 2, 60 * 1000),
				avatarLimits.maxBackoffMs
			);
			this.backoffMs.set(job.tracker, next);
			this.pausedUntil.set(job.tracker, now + next);
			this.requeue(job);
			return;
		}

		// 404 and other client errors: no avatar
		this.markNone(job, now);
	}

	private resetBackoff(tracker: string) {
		this.backoffMs.delete(tracker);
	}

	private store(
		job: Job,
		data: Buffer,
		ext: string,
		lastModified: string | undefined,
		now: number
	) {
		const contentHash = crypto.createHash("sha256").update(data).digest("hex");
		const file =
			crypto
				.createHash("sha256")
				.update(`${this.secret}|${job.key}|${contentHash}`)
				.digest("hex")
				.slice(0, 32) +
			"." +
			ext;
		const old = this.entries.get(job.key);

		const tmp = path.join(this.dir, `${file}.tmp`);
		fs.writeFileSync(tmp, data, {mode: 0o600});
		fs.renameSync(tmp, path.join(this.dir, file));

		if (old?.file && old.file !== file) {
			fs.rm(path.join(this.dir, old.file), {force: true}, () => {});
		}

		this.entries.set(job.key, {
			status: "ok",
			file,
			lastModified: typeof lastModified === "string" ? lastModified.slice(0, 64) : undefined,
			fetchedAt: now,
			seenAt: old?.seenAt || now,
		});
		this.scheduleSave();
		log.info(`Avatars: cached the ${job.tracker} avatar of ${job.nick}`);

		if (old?.file !== file) {
			this.broadcast(job.tracker, [
				{
					tracker: job.tracker,
					nick: job.key.slice(job.tracker.length + 1),
					url: `avatars/${file}`,
				},
			]);
		}
	}

	private markNone(job: Job, now: number) {
		const old = this.entries.get(job.key);

		if (old?.file) {
			fs.rm(path.join(this.dir, old.file), {force: true}, () => {});
			this.broadcast(job.tracker, [
				{tracker: job.tracker, nick: job.key.slice(job.tracker.length + 1), url: null},
			]);
		}

		this.entries.set(job.key, {status: "none", fetchedAt: now, seenAt: old?.seenAt || now});
		this.scheduleSave();
	}

	private broadcast(tracker: string, updates: AvatarUpdate[]) {
		for (const user of this.users()) {
			if (user.networks.some((n) => this.trackersFor(n).includes(tracker))) {
				user.emit("avatars:update", updates);
			}
		}
	}

	/** Every cached avatar for the trackers on this user's networks. */
	listFor(user: Pick<AvatarUser, "networks">): AvatarUpdate[] {
		if (!this.enabled) {
			return [];
		}

		const trackers = new Set(user.networks.flatMap((n) => this.trackersFor(n)));
		const result: AvatarUpdate[] = [];

		for (const [key, entry] of this.entries) {
			const sep = key.indexOf(":");
			const tracker = key.slice(0, sep);

			if (entry.status === "ok" && entry.file && trackers.has(tracker)) {
				result.push({tracker, nick: key.slice(sep + 1), url: `avatars/${entry.file}`});
			}
		}

		return result;
	}

	// For tests and diagnostics
	getEntry(tracker: string, nick: string) {
		return this.entries.get(`${tracker}:${nick.toLowerCase()}`);
	}

	getQueue() {
		return [...this.queue.values()];
	}

	private loadSecret() {
		const file = path.join(this.dir, "secret");

		try {
			const s = fs.readFileSync(file, "utf8").trim();

			if (/^[a-f0-9]{64}$/.test(s)) {
				return s;
			}
		} catch {
			// created below
		}

		const s = crypto.randomBytes(32).toString("hex");
		fs.writeFileSync(file, s, {mode: 0o600});
		return s;
	}

	private loadIndex() {
		try {
			const raw = JSON.parse(fs.readFileSync(path.join(this.dir, "index.json"), "utf8"));

			for (const [key, e] of Object.entries<Entry>(raw.entries || {})) {
				if (
					e &&
					(e.status === "ok" || e.status === "none") &&
					typeof e.fetchedAt === "number"
				) {
					if (
						e.status === "ok" &&
						!(typeof e.file === "string" && avatarFileRegex.test(e.file))
					) {
						continue;
					}

					this.entries.set(key, e);
				}
			}
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
				log.warn(`Avatars: could not read the cache index, starting empty: ${String(e)}`);
			}
		}
	}

	private scheduleSave() {
		if (this.saveTimer) {
			return;
		}

		this.saveTimer = setTimeout(() => this.flush(), 2000);
		this.saveTimer.unref();
	}

	flush() {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}

		if (!this.dir) {
			return;
		}

		const tmp = path.join(this.dir, "index.json.tmp");
		fs.writeFileSync(
			tmp,
			JSON.stringify({version: 1, entries: Object.fromEntries(this.entries)}),
			{mode: 0o600}
		);
		fs.renameSync(tmp, path.join(this.dir, "index.json"));
	}
}

function toBuffer(data: AvatarResult["data"]): Buffer | null {
	if (!data) {
		return null;
	}

	if (Buffer.isBuffer(data)) {
		return data;
	}

	if (data instanceof ArrayBuffer) {
		return Buffer.from(data);
	}

	if (data instanceof Uint8Array) {
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	}

	return null;
}

export default new Avatars();
