import crypto from "node:crypto";

// Fixed label, so the key is derived from the secret for this use only
const label = "thelounge tracker network key v1";

// Until a persisted secret is given (see setTrackerKeySecret), keys are only
// stable for this process. That is enough for public mode, which keeps no
// settings.
let secret: crypto.BinaryLike = crypto.randomBytes(32);

/**
 * Sets the persisted secret network keys are derived from (the web push
 * VAPID private key, which lives in the data folder).
 */
export function setTrackerKeySecret(persisted: string) {
	secret = crypto.createHmac("sha256", persisted).update(label).digest();
}

/**
 * The network a bouncer login picks, lowercased, or undefined when the login
 * doesn't name one. Bouncers serve several IRC networks on one host and port
 * and tell them apart by the login: ZNC takes `user[@client]/network`, soju
 * `user/network[@client]`, either as the username or in front of the
 * password (`user/network:password`).
 */
export function bouncerNetworkName(username?: string, password?: string) {
	const fromLogin = (login: string) => {
		const slash = login.indexOf("/");

		if (slash < 1 || /\s/.test(login)) {
			return undefined;
		}

		// soju puts the client after the network
		const network = login.slice(slash + 1).split("@")[0];
		return network ? network.toLowerCase() : undefined;
	};

	if (username) {
		const network = fromLogin(username);

		if (network) {
			return network;
		}
	}

	const colon = password ? password.indexOf(":") : -1;
	return colon > 0 ? fromLogin(password!.slice(0, colon)) : undefined;
}

/**
 * Key that stands for an IRC network in the trackers users add in their
 * settings: its server host, plus the network the login picks when the host
 * is a bouncer (see bouncerNetworkName), as one bouncer serves many networks.
 * The client gets this instead of the host, which it isn't told (with
 * lockNetwork it is meant to stay hidden). The same network always gives the
 * same key, on every device, but the host can't be told from the key without
 * the server's secret.
 */
export function trackerNetworkKey(host: string, bouncerNetwork?: string) {
	const hmac = crypto.createHmac("sha256", secret).update(host.toLowerCase());

	// A plain host keeps the key it always had, so saved settings still apply.
	// "/" can't be part of a hostname, so the two kinds of key never collide.
	if (bouncerNetwork) {
		hmac.update("/" + bouncerNetwork.toLowerCase());
	}

	return hmac.digest("hex").slice(0, 32);
}
