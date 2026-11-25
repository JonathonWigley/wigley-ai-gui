import type { EntryDraft } from '../../../shared/entry-stamp';
import { toolSummary } from '../../../shared/tool-summary';
import { asArray, asJson, asString, type Json } from './json-fields';

export type ToolEntry = Extract<EntryDraft, { kind: 'tool' }>;

// The entry for a `tool_use` block made by agent `agentId`, with no result yet.
export function toolUseEntry(
  id: string,
  block: Json,
  raw: unknown,
  agentId: string,
): ToolEntry {
  const name = asString(block.name);
  return {
    kind: 'tool',
    id,
    agentId,
    toolUseId: asString(block.id),
    name,
    input: block.input,
    summary: toolSummary(name, block.input),
    result: null,
    raw: [raw],
  };
}

// Joins a `tool_result` block to the entry of the call it answers, keyed in
// `toolEntries` by tool use id: the entry, or undefined when no call matches.
export function pairToolResult(
  toolEntries: ReadonlyMap<string, ToolEntry>,
  block: Json,
  raw: unknown,
): ToolEntry | undefined {
  const entry = toolEntries.get(asString(block.tool_use_id));
  if (entry === undefined) {
    return undefined;
  }
  entry.result = {
    text: toolResultText(block.content),
    isError: block.is_error === true,
  };
  entry.raw.push(raw);
  return entry;
}

// A tool result's content as text: a string as it stands, a block array as
// its text blocks' texts, each other block written `[<type>]`.
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return asArray(content)
    .map((block) => {
      const fields = asJson(block);
      return fields.type === 'text'
        ? asString(fields.text)
        : `[${asString(fields.type)}]`;
    })
    .join('\n');
}
