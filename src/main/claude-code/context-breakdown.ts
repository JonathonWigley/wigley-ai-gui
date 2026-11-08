import {
  type ContextBreakdownAgentEvent,
  type ContextSource,
  type ContextSourceItem,
  MAIN_AGENT_ID,
} from '../../contracts/agent';
import {
  asArray,
  asJson,
  asString,
  type Json,
  numberOrNull,
} from './json-fields';

// A `get_context_usage` reply's `categories[].id` whose items the reply lists beside it.
const MEMORY_FILES = 'memory_files';
const SKILLS = 'skills';
const MCP_TOOLS = 'mcp_tools';
const MCP_INSTRUCTIONS = 'mcp_instructions';
const CUSTOM_AGENTS = 'custom_agents';
const MESSAGES = 'messages';

const numberOr0 = (value: unknown): number => numberOrNull(value) ?? 0;

const byTokens = <T extends { tokens: number }>(list: readonly T[]): T[] =>
  list.filter(({ tokens }) => tokens > 0).sort((a, b) => b.tokens - a.tokens);

// Each entry's `label` field and `tokens`, adding up entries that share a label.
function itemsOf(
  entries: readonly unknown[],
  labelOf: (entry: Json) => string,
  tokensOf: (entry: Json) => number = (entry) => numberOr0(entry.tokens),
  isPath = false,
): ContextSourceItem[] {
  const totals = new Map<string, number>();
  for (const entry of entries.map(asJson)) {
    const label = labelOf(entry);
    totals.set(label, (totals.get(label) ?? 0) + tokensOf(entry));
  }
  return byTokens(
    [...totals].map(([label, tokens]) => ({ label, isPath, tokens })),
  );
}

// The items Claude lists for the category `id`; [] for one it lists none for.
function categoryItems(id: string, reply: Json): ContextSourceItem[] {
  if (id === MEMORY_FILES) {
    return itemsOf(
      asArray(reply.memoryFiles),
      (file) => asString(file.path),
      (file) => numberOr0(file.tokens),
      true,
    );
  }
  if (id === SKILLS) {
    return itemsOf(asArray(asJson(reply.skills).skillFrontmatter), (skill) =>
      asString(skill.name),
    );
  }
  if (id === MCP_TOOLS) {
    const loaded = asArray(reply.mcpTools).filter(
      (tool) => asJson(tool).isLoaded === true,
    );
    return itemsOf(loaded, (tool) => asString(tool.serverName));
  }
  if (id === MCP_INSTRUCTIONS) {
    return itemsOf(asArray(reply.mcpInstructions), (server) =>
      asString(server.serverName),
    );
  }
  if (id === CUSTOM_AGENTS) {
    return itemsOf(asArray(reply.agents), (agent) => asString(agent.agentType));
  }
  return [];
}

// The parts `messageBreakdown` splits the conversation into, before scaling.
function messageParts(breakdown: Json): ContextSource[] {
  const toolCalls = asArray(breakdown.toolCallsByType);
  const named = (entry: Json) => asString(entry.name);
  return [
    {
      id: 'messages.attachments',
      label: 'Attachments',
      tokens: numberOr0(breakdown.attachmentTokens),
      items: itemsOf(asArray(breakdown.attachmentsByType), named),
    },
    {
      id: 'messages.tool-results',
      label: 'Tool results',
      tokens: numberOr0(breakdown.toolResultTokens),
      items: itemsOf(toolCalls, named, (call) => numberOr0(call.resultTokens)),
    },
    {
      id: 'messages.tool-calls',
      label: 'Tool calls',
      tokens: numberOr0(breakdown.toolCallTokens),
      items: itemsOf(toolCalls, named, (call) => numberOr0(call.callTokens)),
    },
    {
      id: 'messages.replies',
      label: 'Agent replies',
      tokens: numberOr0(breakdown.assistantMessageTokens),
      items: [],
    },
    {
      id: 'messages.user',
      label: 'User messages',
      tokens: numberOr0(breakdown.userMessageTokens),
      items: [],
    },
    {
      id: 'messages.other',
      label: 'Other messages',
      tokens:
        numberOr0(breakdown.redirectedContextTokens) +
        numberOr0(breakdown.unattributedTokens),
      items: [],
    },
  ];
}

// The Messages category split by `messageBreakdown`, each part and item scaled to the category's size and the largest
// part taking the rounding's remainder; one Messages source when the reply carries no breakdown. Claude's parts add up
// to more than the category: 136k of parts against a 127k category, measured on 2.1.318.
function splitMessages(source: ContextSource, reply: Json): ContextSource[] {
  const parts = messageParts(asJson(reply.messageBreakdown));
  const partsTotal = parts.reduce((sum, part) => sum + part.tokens, 0);
  if (partsTotal === 0) {
    return [source];
  }
  const scale = source.tokens / partsTotal;
  const scaled = byTokens(
    parts.map((part) => ({
      ...part,
      tokens: Math.round(part.tokens * scale),
      items: byTokens(
        part.items.map((item) => ({
          ...item,
          tokens: Math.round(item.tokens * scale),
        })),
      ),
    })),
  );
  const remainder =
    source.tokens - scaled.reduce((sum, part) => sum + part.tokens, 0);
  const [largest, ...rest] = scaled;
  return largest === undefined
    ? [source]
    : [{ ...largest, tokens: largest.tokens + remainder }, ...rest];
}

// The `contextBreakdown` event a `get_context_usage` reply's data makes: each `used` category a source, Messages split
// into its parts, `deferred` categories counted apart, and `free` and `buffer` left out. `configuredLimit` is the
// profile's own autocompact limit, which the reply does not show; the reply's limit stands when it is null. Null when
// the reply has no categories.
export function contextBreakdownOf(
  reply: Json,
  at: number,
  configuredLimit: number | null,
): ContextBreakdownAgentEvent | null {
  const categories = asArray(reply.categories).map(asJson);
  if (categories.length === 0) {
    return null;
  }
  const sources: ContextSource[] = [];
  let deferredTokens = 0;
  for (const category of categories) {
    const id = asString(category.id) || asString(category.name);
    const tokens = numberOr0(category.tokens);
    if (category.kind === 'deferred') {
      deferredTokens += tokens;
    } else if (category.kind === 'used') {
      const source = {
        id,
        label: asString(category.name),
        tokens,
        items: categoryItems(id, reply),
      };
      sources.push(
        ...(id === MESSAGES ? splitMessages(source, reply) : [source]),
      );
    }
  }
  const sum = sources.reduce((total, source) => total + source.tokens, 0);
  return {
    type: 'contextBreakdown',
    agentId: MAIN_AGENT_ID,
    at,
    totalTokens: numberOrNull(reply.totalTokens) ?? sum,
    contextWindow: numberOrNull(reply.maxTokens),
    autocompactAt: configuredLimit ?? numberOrNull(reply.autoCompactThreshold),
    deferredTokens,
    sources: byTokens(sources),
  };
}
