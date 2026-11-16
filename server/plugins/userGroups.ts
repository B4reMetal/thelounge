import {UserGroup} from "../../shared/types/chan.js";

// Limits for the user groups sent by seedpool/enhanced capable servers
// (SPGROUPS / SPJOIN). The payload comes straight from the IRC server, so
// anything outside of these limits is dropped instead of trusted.
export const MAX_GROUPS = 64;
export const MAX_USERS_PER_GROUP = 10000;
export const MAX_GROUP_NAME_LENGTH = 64;
export const MAX_NICK_LENGTH = 64;

export function isValidGroupName(name: unknown): name is string {
	return (
		typeof name === "string" && name.trim().length > 0 && name.length <= MAX_GROUP_NAME_LENGTH
	);
}

export function isValidNick(nick: unknown): nick is string {
	return typeof nick === "string" && nick.length > 0 && nick.length <= MAX_NICK_LENGTH;
}

// Keep only well-formed groups: a non-empty string name, a finite numeric
// position and an array of string users. Duplicate group names keep the first
// occurrence, and duplicate users within a group are removed. Returns null if
// the payload is not an array at all.
export function normaliseGroups(input: unknown): UserGroup[] | null {
	if (!Array.isArray(input)) {
		return null;
	}

	const groups: UserGroup[] = [];
	const seenNames = new Set<string>();

	for (const entry of input) {
		if (groups.length >= MAX_GROUPS) {
			break;
		}

		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			continue;
		}

		const {name, position, users} = entry as Record<string, unknown>;

		if (
			!isValidGroupName(name) ||
			typeof position !== "number" ||
			!Number.isFinite(position) ||
			!Array.isArray(users) ||
			seenNames.has(name)
		) {
			continue;
		}

		const seenUsers = new Set<string>();
		const cleanUsers: string[] = [];

		for (const user of users) {
			if (cleanUsers.length >= MAX_USERS_PER_GROUP) {
				break;
			}

			if (!isValidNick(user)) {
				continue;
			}

			const lower = user.toLowerCase();

			if (seenUsers.has(lower)) {
				continue;
			}

			seenUsers.add(lower);
			cleanUsers.push(user);
		}

		seenNames.add(name);
		groups.push({name, position, users: cleanUsers});
	}

	return sortGroups(groups);
}

// Sort groups by position, highest first
export function sortGroups(groups: UserGroup[]): UserGroup[] {
	return groups.sort((a, b) => b.position - a.position);
}
