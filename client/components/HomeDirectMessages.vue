<template>
	<!-- Hidden unless a theme shows it: a "home" with the direct messages of every network -->
	<div class="home" :class="{open: store.state.homeOpen}">
		<button
			type="button"
			class="home-button"
			:class="{'has-unread': unreadCount > 0}"
			:aria-pressed="store.state.homeOpen ? 'true' : 'false'"
			aria-label="Direct messages"
			title="Direct messages"
			@click="openHome"
		>
			<span v-if="unreadCount > 0" class="home-unread badge highlight">{{
				unreadCount
			}}</span>
		</button>
		<div class="home-dms" role="region" aria-label="Direct messages of all networks">
			<div class="home-dms-header">Direct Messages</div>
			<input
				v-if="rows.length > 5"
				v-model="filterText"
				type="text"
				class="home-dms-filter input"
				placeholder="Find a conversation"
				aria-label="Find a conversation"
			/>
			<div
				v-for="row in shown"
				:key="row.channel.id"
				class="home-dm-row"
				:data-network="row.network.uuid"
				:data-network-name="row.network.name"
			>
				<Channel
					:data-item="row.channel.id"
					:channel="row.channel"
					:network="row.network"
					:active="
						store.state.activeChannel &&
						row.channel === store.state.activeChannel.channel
					"
				/>
			</div>
			<p v-if="rows.length === 0" class="home-dms-empty">
				No direct messages yet. They show up here when someone messages you.
			</p>
		</div>
	</div>
</template>

<style>
.home {
	display: none;
}
</style>

<script lang="ts">
import {computed, defineComponent, ref} from "vue";
import {useStore} from "../js/store";
import {ChanType} from "../../shared/types/chan";
import Channel from "./Channel.vue";

export default defineComponent({
	name: "HomeDirectMessages",
	components: {Channel},
	setup() {
		const store = useStore();
		const filterText = ref("");

		const lastTime = (c: {messages: {time: Date | string | number}[]}) => {
			const last = c.messages[c.messages.length - 1];
			return last ? new Date(last.time).getTime() || 0 : 0;
		};

		// Every network's private messages, most recent conversation first
		const rows = computed(() =>
			store.state.networks
				.flatMap((network) =>
					network.channels
						.filter((channel) => channel.type === ChanType.QUERY)
						.map((channel) => ({network, channel, time: lastTime(channel)}))
				)
				.sort((a, b) => b.time - a.time || a.channel.name.localeCompare(b.channel.name))
		);

		const shown = computed(() => {
			const needle = filterText.value.trim().toLowerCase();
			return needle
				? rows.value.filter((r) => r.channel.name.toLowerCase().includes(needle))
				: rows.value;
		});

		const unreadCount = computed(
			() => rows.value.filter((r) => r.channel.unread > 0 && !r.channel.muted).length
		);

		const openHome = () => store.commit("homeOpen", true);

		return {store, filterText, rows, shown, unreadCount, openHome};
	},
});
</script>
