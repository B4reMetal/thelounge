import {Agent, fetch as undiciFetch} from "undici";

import Config from "../config.js";

let boundAgent: {address: string; agent: Agent} | null = null;

function getBoundAgent(address: string) {
	if (boundAgent?.address !== address) {
		// The bind address changed (config reload), stop reusing the old connections
		void boundAgent?.agent.close();

		// `localAddress` has to be a top level option: undici passes its own
		// (empty) localAddress to the connector, overriding `connect.localAddress`
		boundAgent = {address, agent: new Agent({localAddress: address})};
	}

	return boundAgent.agent;
}

/**
 * fetch() for requests The Lounge makes on its own behalf (link prefetch,
 * update checks). When `bind` is set in the config, the connection is made from
 * that local address, as all other outgoing connections are.
 *
 * The bound request goes through undici's own fetch together with its Agent:
 * mixing Node's bundled undici (global fetch) with an Agent from a different
 * undici release is not guaranteed to work.
 */
export default function outgoingFetch(url: string, init: RequestInit = {}): Promise<Response> {
	const bind = Config.values.bind;

	if (!bind) {
		return globalThis.fetch(url, init);
	}

	return undiciFetch(url, {
		...(init as Parameters<typeof undiciFetch>[1]),
		dispatcher: getBoundAgent(bind),
	}) as unknown as Promise<Response>;
}
