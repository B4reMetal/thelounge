/**
 * Channels joined from the channel browser, which shouldn't take the user away
 * from it when the join arrives (see socket-events/join.ts).
 */

const quiet = new Map<string, number>(); // `${network uuid} ${channel lowercased}` → expiry

const key = (network: string, channel: string) => `${network} ${channel.toLowerCase()}`;

export function joinQuietly(network: string, channel: string) {
	quiet.set(key(network, channel), Date.now() + 30000);
}

/** Whether this join should stay in the background; forgets it either way. */
export function takeQuietJoin(network: string, channel: string): boolean {
	const k = key(network, channel);
	const expiry = quiet.get(k);
	quiet.delete(k);
	return expiry !== undefined && expiry > Date.now();
}
