import type Network from "../models/network.js";

export type UserIdent = {ident: string; hostname: string};

type Pending = {
	timer: NodeJS.Timeout;
	resolve: ((result: UserIdent | null) => void)[];
	// Cleared when the user asks for a WHOIS of the same nick themself
	// meanwhile, so that reply is shown as usual
	silent: boolean;
	// Whether the "No such nick" error of the WHOIS has been hidden already
	noSuchNickHidden: boolean;
};

// How long a WHOIS sent from here may take to be answered (the client gives
// up after 8 s), and how long a reply that comes later is still kept out of
// the client
const defaultTimeouts = {answerMs: 5000, lateReplyMs: 30000};

type TimedOut = {timer: NodeJS.Timeout; noSuchNickHidden: boolean};

// Lookups that may wait for a WHOIS at once on one network
const maxPendingPerNetwork = 5;

// What could be a nick: no spaces, commas, control characters or wildcards,
// which would make the WHOIS about something else
const nickLike = /^[^\s,*?!@#&:\p{Cc}][^\s,*?!@\p{Cc}]{0,63}$/u;

/**
 * Finds out the ident and hostname of a user on a network, for tracker profile
 * links that are built from them.
 *
 * What the server has already said about the user (in the user list, when they
 * joined or changed host) is used when there is any. Otherwise a WHOIS is sent
 * whose reply is kept out of the client: without this it would open a query
 * window with the reply in it.
 */
class UserIdentLookup {
	private pending = new Map<string, Pending>();
	// Lookups that gave up waiting, whose reply may still come
	private timedOut = new Map<string, TimedOut>();

	constructor(private timeouts = defaultTimeouts) {}

	private key(network: Network, nick: string) {
		return `${network.uuid}:${nick.toLowerCase()}`;
	}

	lookup(network: Network, nick: string): Promise<UserIdent | null> {
		if (!nickLike.test(nick)) {
			return Promise.resolve(null);
		}

		for (const chan of network.channels) {
			const user = chan.findUser(nick);

			// Profile addresses take a numeric user id. Anything else may be
			// stale (an ident from before the user identified to the network),
			// so it is asked for again.
			if (user?.ident && user.hostname && /^\d+$/.test(user.ident)) {
				return Promise.resolve({ident: user.ident, hostname: user.hostname});
			}
		}

		if (!network.irc?.connected) {
			return Promise.resolve(null);
		}

		return new Promise((resolve) => {
			const key = this.key(network, nick);
			const waiting = this.pending.get(key);

			if (waiting) {
				waiting.resolve.push(resolve);
				return;
			}

			const networkPrefix = this.key(network, "");
			const pendingHere = Array.from(this.pending.keys()).filter((k) =>
				k.startsWith(networkPrefix)
			).length;

			if (pendingHere >= maxPendingPerNetwork) {
				resolve(null);
				return;
			}

			this.pending.set(key, {
				timer: setTimeout(() => this.timeOut(key), this.timeouts.answerMs),
				resolve: [resolve],
				silent: true,
				noSuchNickHidden: false,
			});

			network.irc!.raw("WHOIS", nick);
		});
	}

	/**
	 * The user asked for a WHOIS of `nick` themself. Its reply may be the one
	 * a lookup is waiting for, and has to be shown either way.
	 */
	shownWhoisRequested(network: Network, nick: string) {
		const waiting = this.pending.get(this.key(network, nick));

		if (waiting) {
			waiting.silent = false;
		}

		this.forgetTimedOut(this.key(network, nick));
	}

	/**
	 * Takes a "No such nick" error. Returns true if it must not be shown: a
	 * WHOIS of a nick that doesn't exist is answered with one ahead of the
	 * end of the reply, which belongs to the lookup as well. Only one is
	 * taken per lookup, others are about something else.
	 */
	hideNoSuchNick(network: Network, nick: string) {
		const key = this.key(network, nick);
		const waiting = this.pending.get(key) ?? this.timedOut.get(key);

		if (!waiting || ("silent" in waiting && !waiting.silent) || waiting.noSuchNickHidden) {
			return false;
		}

		waiting.noSuchNickHidden = true;
		return true;
	}

	/**
	 * Takes a WHOIS reply. Returns true if it answered a lookup and nothing
	 * else was waiting for it, in which case it must not be shown.
	 */
	handleWhois(
		network: Network,
		data: {
			nick: string;
			error?: boolean;
			whowas?: boolean;
			ident?: unknown;
			hostname?: unknown;
		}
	): boolean {
		// Not the answer to a WHOIS, and about someone who may be gone
		if (data.whowas) {
			return false;
		}

		const key = this.key(network, data.nick);
		const waiting = this.pending.get(key);
		const late = !waiting && this.timedOut.has(key);

		if (!waiting && !late) {
			return false;
		}

		const known =
			!data.error && typeof data.ident === "string" && typeof data.hostname === "string"
				? {ident: data.ident, hostname: data.hostname}
				: null;

		if (known) {
			// Remember it for the next time, where the user is in a channel
			for (const chan of network.channels) {
				const user = chan.findUser(data.nick);

				if (user) {
					user.ident = known.ident;
					user.hostname = known.hostname;
				}
			}
		}

		if (late) {
			// Answers a lookup that gave up, nobody asked to see it
			this.forgetTimedOut(key);
			return true;
		}

		this.finish(key, known);

		return waiting!.silent;
	}

	private timeOut(key: string) {
		const waiting = this.pending.get(key);

		if (waiting?.silent) {
			this.forgetTimedOut(key);
			this.timedOut.set(key, {
				timer: setTimeout(() => this.timedOut.delete(key), this.timeouts.lateReplyMs),
				noSuchNickHidden: waiting.noSuchNickHidden,
			});
		}

		this.finish(key, null);
	}

	private forgetTimedOut(key: string) {
		const timedOut = this.timedOut.get(key);

		if (timedOut) {
			clearTimeout(timedOut.timer);
			this.timedOut.delete(key);
		}
	}

	private finish(key: string, result: UserIdent | null) {
		const waiting = this.pending.get(key);

		if (!waiting) {
			return;
		}

		clearTimeout(waiting.timer);
		this.pending.delete(key);
		waiting.resolve.forEach((resolve) => resolve(result));
	}

	/**
	 * Drops everything that is waiting, answering it with nothing
	 */
	clear() {
		for (const key of Array.from(this.pending.keys())) {
			this.finish(key, null);
		}

		for (const key of Array.from(this.timedOut.keys())) {
			this.forgetTimedOut(key);
		}
	}
}

export default UserIdentLookup;
