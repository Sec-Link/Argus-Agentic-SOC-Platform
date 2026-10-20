export const MAX_MENTIONED_AGENTS = 3;

export function parseAgentMentions(message: string): string[] {
  // Code examples and email addresses must not select an agent.
  const plain = message.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/(`+)[^\n]*?\1/g, ' ');
  const names = [...plain.matchAll(/(^|[^A-Za-z0-9_./@\\-])@([A-Za-z][A-Za-z0-9_-]*)(?![A-Za-z0-9_@-]|\.[A-Za-z0-9])/g)]
    .map((match) => match[2]);
  return [...new Set(names)];
}

export function validateAgentMentions(message: string, catalog: readonly { name: string }[]): string[] {
  const names = parseAgentMentions(message);
  if (names.length > MAX_MENTIONED_AGENTS) throw new Error(`Mention at most ${MAX_MENTIONED_AGENTS} agents per message.`);
  const available = new Set(catalog.map((agent) => agent.name));
  const missing = names.filter((name) => !available.has(name));
  if (missing.length) throw new Error(`These agents are unavailable: ${missing.map((name) => `@${name}`).join(', ')}. Remove the mention or enable the agent in AI Assistant > Agents.`);
  return names;
}
