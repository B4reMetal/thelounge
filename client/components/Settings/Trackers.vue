<template>
	<div id="tracker-settings">
		<h2>
			Trackers
			<span
				class="tooltipped tooltipped-n tooltipped-no-delay"
				aria-label='Trackers give users a "Tracker Profile" link in their
context menu. Changes here only apply to you.'
			>
				<button type="button" class="extra-help" />
			</span>
		</h2>

		<template v-if="serverTrackers.length > 0">
			<h3>From the server</h3>
			<ul class="tracker-list">
				<li v-for="item in serverTrackers" :key="item.key" class="tracker-item">
					<div class="tracker-item-info">
						<strong>{{ item.tracker.name }}</strong>
						<span class="tracker-item-detail">{{ item.network.name }}</span>
						<span v-if="item.entry?.hidden" class="tracker-item-detail">
							Profile link hidden
						</span>
						<span v-else-if="item.entry?.profileUrl" class="tracker-item-detail">
							Your link: {{ item.entry.profileUrl }}
						</span>
						<span v-else-if="item.tracker.profileUrl" class="tracker-item-detail">
							{{ item.tracker.profileUrl }}
						</span>
						<span v-else class="tracker-item-detail">No profile link</span>
					</div>
					<div class="tracker-item-btn">
						<button type="button" class="btn" @click="editOverride(item)">
							Change link
						</button>
						<button
							v-if="item.entry"
							type="button"
							class="btn"
							@click="removeEntry(item.entry)"
						>
							Reset
						</button>
						<button v-else type="button" class="btn" @click="hide(item)">Hide</button>
					</div>
				</li>
			</ul>
		</template>

		<h3>Your trackers</h3>
		<p v-if="ownTrackers.length === 0" class="tracker-item-detail">
			You have not added any trackers.
		</p>
		<ul v-else class="tracker-list">
			<li v-for="entry in ownTrackers" :key="entry.network + entry.id" class="tracker-item">
				<div class="tracker-item-info">
					<strong>{{ entry.name ?? entry.id }}</strong>
					<span class="tracker-item-detail">
						{{ networkLabel(entry.network) }}
						<template v-if="entry.channels">
							· {{ entry.channels.join(", ") }}</template
						>
					</span>
					<span v-if="entry.hidden" class="tracker-item-detail">
						Hides the server's profile link
					</span>
					<span v-else-if="entry.profileUrl" class="tracker-item-detail">
						{{ entry.profileUrl }}
					</span>
					<span v-else class="tracker-item-detail error">No usable profile address</span>
				</div>
				<div class="tracker-item-btn">
					<button v-if="!entry.hidden" type="button" class="btn" @click="editOwn(entry)">
						Edit
					</button>
					<button type="button" class="btn" @click="removeEntry(entry)">Remove</button>
				</div>
			</li>
		</ul>

		<div v-if="form" class="tracker-form" @keydown.enter.prevent="save">
			<h3 v-if="form.mode === 'override'">Profile link for {{ form.name }}</h3>
			<h3 v-else-if="form.mode === 'edit'">Edit tracker</h3>
			<h3 v-else>Add a tracker</h3>

			<template v-if="form.mode !== 'override'">
				<label for="tracker-name" class="opt">Name</label>
				<input
					id="tracker-name"
					v-model="form.name"
					type="text"
					class="input"
					autocomplete="off"
					:maxlength="limits.text"
					placeholder="e.g. My Tracker"
				/>

				<label for="tracker-network" class="opt">Network</label>
				<select id="tracker-network" v-model="form.network" class="input">
					<option v-if="!hostIsListed(form.network)" :value="form.network">
						{{ form.network || "Choose a network" }}
					</option>
					<option v-for="host in networkHosts" :key="host.host" :value="host.host">
						{{ host.label }}
					</option>
				</select>

				<label for="tracker-channels" class="opt">
					Channels
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						aria-label="Leave empty for the whole network."
					>
						<button type="button" class="extra-help" />
					</span>
				</label>
				<input
					id="tracker-channels"
					v-model="form.channels"
					type="text"
					class="input"
					autocomplete="off"
					placeholder="Comma-separated, e.g.: #tracker, #tracker-help"
				/>
			</template>

			<label for="tracker-profile-url" class="opt">
				Profile address
				<span
					class="tooltipped tooltipped-n tooltipped-no-delay"
					aria-label="{nick} is replaced with the user's nick. Use {ident} instead
where the tracker's IRC server puts the user id in the ident."
				>
					<button type="button" class="extra-help" />
				</span>
			</label>
			<input
				id="tracker-profile-url"
				v-model="form.profileUrl"
				type="url"
				class="input"
				autocomplete="off"
				:maxlength="limits.url"
				placeholder="https://tracker.example/users/{nick}"
			/>

			<label for="tracker-user-host" class="opt">
				Users' hostname
				<span
					class="tooltipped tooltipped-n tooltipped-no-delay"
					aria-label="Optional, only used with {ident}: what the hostname of the
tracker's users looks like, * for any text."
				>
					<button type="button" class="extra-help" />
				</span>
			</label>
			<input
				id="tracker-user-host"
				v-model="form.userHost"
				type="text"
				class="input"
				autocomplete="off"
				:maxlength="limits.text"
				placeholder="e.g. *.users.tracker.example"
			/>

			<div v-if="formError" class="error">{{ formError }}</div>

			<div class="tracker-form-btn">
				<button type="button" class="btn" @click="save">Save</button>
				<button type="button" class="btn" @click="form = null">Cancel</button>
			</div>
		</div>
		<button
			v-else
			type="button"
			class="btn"
			:disabled="networkHosts.length === 0"
			@click="addNew"
		>
			Add a tracker
		</button>
	</div>
</template>

<style>
#tracker-settings h3 {
	font-size: 15px;
	margin: 16px 0 6px;
}

#tracker-settings .tracker-list {
	list-style: none;
	padding: 0;
	margin: 0 0 10px;
}

#tracker-settings .tracker-item {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	padding: 8px 0;
	font-size: 14px;
	border-bottom: 1px solid var(--window-heading-color, #ddd);
}

#tracker-settings .tracker-item-info {
	display: flex;
	flex-direction: column;
	flex: 1 1 220px;
	min-width: 0;
}

#tracker-settings .tracker-item-detail {
	color: var(--body-color-muted);
	overflow-wrap: anywhere;
}

#tracker-settings .tracker-item-btn,
#tracker-settings .tracker-form-btn {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: flex-start;
}

#tracker-settings .tracker-item-btn .btn,
#tracker-settings .tracker-form-btn .btn {
	margin: 0;
}

#tracker-settings .tracker-form {
	margin-top: 10px;
}

#tracker-settings .tracker-form-btn {
	margin-top: 10px;
}
</style>

<script lang="ts">
import {computed, defineComponent, ref} from "vue";
import {useStore} from "../../js/store";
import type {ClientNetwork} from "../../js/types";
import type {TrackerInfo} from "../../../shared/types/network";
import {
	isUsableProfileUrl,
	parseUserTracker,
	parseUserTrackers,
	serializeUserTrackers,
	type UserTracker,
	userTrackerLimits,
	userTrackersSetting,
} from "../../../shared/trackers";

type ServerTrackerItem = {
	key: string;
	network: ClientNetwork;
	host: string;
	tracker: TrackerInfo;
	entry?: UserTracker;
};

type Form = {
	mode: "new" | "edit" | "override";
	// The entry being edited, by network and id
	original?: {network: string; id: string};
	id: string;
	name: string;
	network: string;
	channels: string;
	profileUrl: string;
	userHost: string;
};

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isEntry = (entry: UserTracker, network: string, id: string) =>
	entry.network === network.toLowerCase() && sameId(entry.id, id);

export default defineComponent({
	name: "TrackerSettings",
	setup() {
		const store = useStore();
		const limits = userTrackerLimits;
		const form = ref<Form | null>(null);
		const formError = ref("");

		const entries = computed(() => parseUserTrackers(store.state.settings.userTrackers));

		// The user's networks by host; several networks can share one
		const networkHosts = computed(() => {
			const hosts = new Map<string, {host: string; label: string}>();

			for (const network of store.state.networks) {
				const host = network.host?.toLowerCase();

				if (host && !hosts.has(host)) {
					hosts.set(host, {host, label: `${network.name} (${host})`});
				}
			}

			return Array.from(hosts.values());
		});

		const serverTrackers = computed(() => {
			const items: ServerTrackerItem[] = [];
			const seen = new Set<string>();

			for (const network of store.state.networks) {
				const host = network.host?.toLowerCase();

				if (!host) {
					continue;
				}

				for (const tracker of network.trackers ?? []) {
					const key = `${host}\n${tracker.id.toLowerCase()}`;

					if (seen.has(key)) {
						continue;
					}

					seen.add(key);
					items.push({
						key,
						network,
						host,
						tracker,
						entry: entries.value.find((e) => isEntry(e, host, tracker.id)),
					});
				}
			}

			return items;
		});

		// Entries that aren't about one of the server's trackers shown above
		const ownTrackers = computed(() =>
			entries.value.filter((e) => !serverTrackers.value.some((item) => item.entry === e))
		);

		const hostIsListed = (host: string) => networkHosts.value.some((h) => h.host === host);

		const networkLabel = (host: string) =>
			networkHosts.value.find((h) => h.host === host)?.label ?? host;

		const saveEntries = (list: UserTracker[]) => {
			const value = serializeUserTrackers(list);

			if (value.length > userTrackerLimits.storedLength) {
				formError.value = "That is more than can be stored, remove some trackers first.";
				return false;
			}

			void store.dispatch("settings/update", {
				name: userTrackersSetting,
				value,
				sync: true,
			});
			return true;
		};

		const withoutEntry = (network: string, id: string) =>
			entries.value.filter((e) => !isEntry(e, network, id));

		const removeEntry = (entry: UserTracker) => {
			saveEntries(withoutEntry(entry.network, entry.id));
		};

		const hide = (item: ServerTrackerItem) => {
			saveEntries([
				...withoutEntry(item.host, item.tracker.id),
				{id: item.tracker.id, network: item.host, hidden: true},
			]);
		};

		const blankForm = {channels: "", profileUrl: "", userHost: ""};

		const addNew = () => {
			formError.value = "";
			form.value = {
				...blankForm,
				mode: "new",
				id: `user-${Date.now().toString(36)}`,
				name: "",
				network: networkHosts.value.length === 1 ? networkHosts.value[0].host : "",
			};
		};

		const editOwn = (entry: UserTracker) => {
			formError.value = "";
			form.value = {
				mode: "edit",
				original: {network: entry.network, id: entry.id},
				id: entry.id,
				name: entry.name ?? "",
				network: entry.network,
				channels: entry.channels?.join(", ") ?? "",
				profileUrl: entry.profileUrl ?? "",
				userHost: entry.userHost ?? "",
			};
		};

		const editOverride = (item: ServerTrackerItem) => {
			const current = item.entry?.hidden ? undefined : item.entry;
			formError.value = "";
			form.value = {
				...blankForm,
				mode: "override",
				original: item.entry ? {network: item.host, id: item.tracker.id} : undefined,
				id: item.tracker.id,
				name: item.tracker.name,
				network: item.host,
				profileUrl: current?.profileUrl ?? item.tracker.profileUrl ?? "",
				userHost: current?.userHost ?? item.tracker.userHost ?? "",
			};
		};

		const save = () => {
			const f = form.value;

			if (!f) {
				return;
			}

			const profileUrl = f.profileUrl.trim();

			if (f.mode !== "override" && !f.name.trim()) {
				formError.value = "Give the tracker a name.";
				return;
			}

			if (!f.network) {
				formError.value = "Choose the network the tracker is on.";
				return;
			}

			// The same check the server makes for the trackers in its config
			if (!isUsableProfileUrl(profileUrl) || profileUrl.length > userTrackerLimits.url) {
				formError.value =
					"The profile address has to start with http:// or https:// and contain {nick} or {ident}.";
				return;
			}

			const entry = parseUserTracker({
				id: f.id,
				network: f.network,
				name: f.mode === "override" ? undefined : f.name,
				channels:
					f.mode === "override"
						? undefined
						: f.channels.split(/[\s,]+/).filter((c) => c !== ""),
				profileUrl,
				userHost: f.userHost,
			});

			if (!entry?.profileUrl) {
				formError.value = "Some of the fields are too long.";
				return;
			}

			let list = entries.value;

			if (f.original) {
				list = list.filter((e) => !isEntry(e, f.original!.network, f.original!.id));
			}

			// Moving a tracker to a host where the same id is in use replaces it
			list = list.filter((e) => !isEntry(e, entry.network, entry.id));

			if (list.length >= userTrackerLimits.entries) {
				formError.value = `You can have at most ${userTrackerLimits.entries} entries.`;
				return;
			}

			if (saveEntries([...list, entry])) {
				form.value = null;
			}
		};

		return {
			limits,
			form,
			formError,
			networkHosts,
			serverTrackers,
			ownTrackers,
			hostIsListed,
			networkLabel,
			removeEntry,
			hide,
			addNew,
			editOwn,
			editOverride,
			save,
		};
	},
});
</script>
