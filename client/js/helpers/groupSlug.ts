// Group names come from the IRC server (SPGROUPS / SPJOIN), so never use them
// as CSS class names directly: reduce them to lowercase letters, digits and
// dashes. "Sysop" -> "sysop", "Power Pool" -> "power-pool".
export default function groupSlug(name: string): string {
	const slug = String(name)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return slug || "unknown";
}
