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
 * Key that stands for an IRC server host in the trackers users add in their
 * settings. The client gets this instead of the host, which it isn't told
 * (with lockNetwork it is meant to stay hidden). The same host always gives
 * the same key, on every device, but the host can't be told from the key
 * without the server's secret.
 */
export function trackerNetworkKey(host: string) {
	return crypto
		.createHmac("sha256", secret)
		.update(host.toLowerCase())
		.digest("hex")
		.slice(0, 32);
}
