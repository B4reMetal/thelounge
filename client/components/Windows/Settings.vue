<template>
	<div id="settings" class="window" role="tabpanel" aria-label="Settings">
		<div class="header">
			<SidebarToggle />
		</div>
		<!-- Hidden unless a theme shows it (themes that lay settings over the whole app) -->
		<button
			ref="closeButton"
			type="button"
			class="window-close"
			aria-label="Close settings"
			@click="close"
		>
			<span class="window-close-key" aria-hidden="true">ESC</span>
		</button>
		<Navigation />

		<div class="container">
			<form ref="settingsForm" autocomplete="off" @change="onChange" @submit.prevent>
				<router-view></router-view>
			</form>
		</div>
	</div>
</template>

<style>
#settings .window-close {
	display: none;
}
</style>

<script lang="ts">
import {defineComponent, onBeforeUnmount, onMounted, ref} from "vue";
import SidebarToggle from "../SidebarToggle.vue";
import Navigation from "../Settings/Navigation.vue";
import {useStore} from "../../js/store";
import {switchToChannel} from "../../js/router";

export default defineComponent({
	name: "Settings",
	components: {
		SidebarToggle,
		Navigation,
	},
	setup() {
		const store = useStore();

		const onChange = (event: Event) => {
			const ignore = ["old_password", "new_password", "verify_password"];

			const name = (event.target as HTMLInputElement).name;

			if (ignore.includes(name)) {
				return;
			}

			let value: boolean | string;

			if ((event.target as HTMLInputElement).type === "checkbox") {
				value = (event.target as HTMLInputElement).checked;
			} else {
				value = (event.target as HTMLInputElement).value;
			}

			void store.dispatch("settings/update", {name, value, sync: true});
		};

		const closeButton = ref<HTMLButtonElement | null>(null);

		// Back to the channel shown before settings, or the first network
		const close = () => {
			const last = store.state.lastActiveChannel;
			const found = last && store.getters.findChannel(last.channel.id);
			const target = found?.channel || store.state.networks[0]?.channels[0];

			if (target) {
				switchToChannel(target);
			}
		};

		const onKeydown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented && closeButton.value?.offsetParent) {
				close();
			}
		};

		onMounted(() => document.addEventListener("keydown", onKeydown));
		onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));

		return {
			onChange,
			closeButton,
			close,
		};
	},
});
</script>
