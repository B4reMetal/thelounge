/**
 * The quick switcher dialog is for themes that ask for it by setting
 * `--tl-quick-switcher: 1` on :root (they also show its opener, core's
 * .quick-switcher-open, hidden by default). Only then does Ctrl+K open it;
 * elsewhere Ctrl+K keeps inserting the IRC colour code.
 */
export function quickSwitcherShown(): boolean {
	return (
		getComputedStyle(document.documentElement)
			.getPropertyValue("--tl-quick-switcher")
			.trim() === "1"
	);
}
