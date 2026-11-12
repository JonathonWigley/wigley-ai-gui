import type { BacklogRow } from './rows';

// One follow-up a chunk's first message names.
export type ChunkItem = Pick<
  BacklogRow,
  'title' | 'oneLine' | 'body' | 'path' | 'line'
>;

// `parts` trimmed and joined by blank lines, empty ones left out.
function joinParts(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('\n\n');
}

function itemBlock(item: ChunkItem): string {
  return joinParts([
    `## ${item.title}`,
    item.oneLine,
    item.body,
    `From ${item.path}:${String(item.line)}`,
  ]);
}

// A chunk session's first message: `brief`, then one block per item in
// order, each its `## <title>` heading, one line, body and `From <path>:<line>`.
export function chunkMessage(
  brief: string,
  items: readonly ChunkItem[],
): string {
  return joinParts([brief, ...items.map(itemBlock)]);
}
