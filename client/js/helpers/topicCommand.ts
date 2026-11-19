/**
 * The command that sets a channel's topic to what was typed in the topic bar.
 * "/topic" with nothing after it asks for the topic, so an emptied topic bar
 * removes the topic with "/cleartopic" instead.
 */
export default (topic: string) => (topic.trim() ? `/topic ${topic}` : "/cleartopic");
