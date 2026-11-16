import type Network from "../models/network.js";

export type UserIdent = {ident: string; hostname: string};

type Pending = {
	timer: NodeJS.Timeout;
	resolve: ((result: UserIdent | null) => void)[];
	// Cleared when the user asks for a WHOIS of the same nick themself
	// meanwhile, so that reply is shown as usual
	silent: boolean;
};

// How long a WHOIS sent from here may take to be answered
const timeoutMs = 5000;

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

	private key(network: Network, nick: string) {
		return `${network.uuid}:${nick.toLowerCase()}`;
	}

	lookup(network: Network, nick: string): Promise<UserIdent | null> {
		for (const chan of network.channels) {
			const user = chan.findUser(nick);

			if (user?.ident && user.hostname) {
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

			this.pending.set(key, {
				timer: setTimeout(() => this.finish(key, null), timeoutMs),
				resolve: [resolve],
				silent: true,
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
	}

	/**
	 * Takes a WHOIS reply. Returns true if it answered a lookup and nothing
	 * else was waiting for it, in which case it must not be shown.
	 */
	handleWhois(
		network: Network,
		data: {nick: string; error?: boolean; ident?: unknown; hostname?: unknown}
	): boolean {
		const key = this.key(network, data.nick);
		const waiting = this.pending.get(key);

		if (!waiting) {
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

		this.finish(key, known);

		return waiting.silent;
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
	}
}

export default UserIdentLookup;
