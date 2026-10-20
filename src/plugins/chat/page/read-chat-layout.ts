import type { ChatEntry, ChatEntryKind } from '../../../contracts/agent';
import type { ChatLayout, EntryInput, EntryKind } from '../layouts/layout';

// A `Record` over every kind, so a kind left out fails to compile.
const KIND_SET: Record<ChatEntryKind, true> = {
  user: true,
  assistant: true,
  thinking: true,
  tool: true,
  permission: true,
  result: true,
  notice: true,
  raw: true,
};

export const ENTRY_KINDS: readonly ChatEntryKind[] = Object.keys(
  KIND_SET,
) as ChatEntryKind[];

// Compile-time checks: each chat entry variant is assignable to its layout
// input, and the contract's kinds and the layout's kinds are one set. A
// variant missing or renaming an input's field, or a drifted kind, makes a
// member `never`, which `true` cannot fill. Without strictNullChecks a field
// turning nullable is not caught.
type VariantFitsInput = {
  [K in ChatEntryKind]: Extract<ChatEntry, { kind: K }> extends EntryInput<K>
    ? true
    : never;
};
const VARIANTS_FIT_INPUTS: VariantFitsInput = { ...KIND_SET };
const CHAT_KINDS_ARE_LAYOUT_KINDS: [ChatEntryKind] extends [EntryKind]
  ? true
  : never = true;
const LAYOUT_KINDS_ARE_CHAT_KINDS: [EntryKind] extends [ChatEntryKind]
  ? true
  : never = true;
void [
  VARIANTS_FIT_INPUTS,
  CHAT_KINDS_ARE_LAYOUT_KINDS,
  LAYOUT_KINDS_ARE_CHAT_KINDS,
];

// The chat layout a user's `layout.js` module exports as its default; throws
// naming the first entry builder it lacks.
export function readChatLayout(module: unknown, name: string): ChatLayout {
  const layout = isRecord(module) ? module.default : undefined;
  if (!isRecord(layout)) {
    throw new Error(
      `layout ${name}: the default export is missing or not an object`,
    );
  }
  const entries = isRecord(layout.entries) ? layout.entries : {};
  for (const kind of ENTRY_KINDS) {
    if (typeof entries[kind] !== 'function') {
      throw new Error(
        `layout ${name}: entries.${kind} is missing or not a function`,
      );
    }
  }
  return layout as unknown as ChatLayout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
