/**
 * Identifies a message for de-duplication.
 *
 * A message id alone is not unique: stored messages carry the id they were
 * given in memory, which used to restart with the server, or else their
 * storage row id, and the two ranges overlap. Id and time together don't
 * repeat for different messages.
 */
export function messageKey(message: {id: number; time: Date | string | number}): string {
	return `${message.id}:${new Date(message.time).getTime()}`;
}
