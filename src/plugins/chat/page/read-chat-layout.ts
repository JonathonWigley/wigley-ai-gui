import type { ChatEntry, ChatEntryKind } from '../../../contracts/agent';
import {
  isRecord,
  readLayoutModule,
} from '../../../shared/page/layout-host/read-layout-module';
import type { ChatLayout, EntryInput, EntryKind } from '../layouts/layout';
import type { ChatPartName } from './chat-layouts';

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

// A `Record` over every part beside the entries, so a part left out fails to
// compile.
const PART_SET: Record<ChatPartName, true> = {
  composer: true,
  composerBar: true,
  attachments: true,
  pickerRow: true,
  signIn: true,
  reasonBox: true,
  closeConfirm: true,
  imageViewer: true,
};
const PART_NAMES = Object.keys(PART_SET) as ChatPartName[];

// The chat layout a user's `layout.js` module exports as its default; throws
// naming the first entry builder it lacks, or the first part it holds that is
// not a function. Every part beside the entries may be left out.
export function readChatLayout(module: unknown, name: string): ChatLayout {
  const layout = readLayoutModule(module, name);
  const entries = isRecord(layout.entries) ? layout.entries : {};
  for (const kind of ENTRY_KINDS) {
    if (typeof entries[kind] !== 'function') {
      throw new Error(
        `layout ${name}: entries.${kind} is missing or not a function`,
      );
    }
  }
  for (const part of PART_NAMES) {
    const isPresent = layout[part] !== undefined;
    if (isPresent && typeof layout[part] !== 'function') {
      throw new Error(`layout ${name}: ${part} is not a function`);
    }
  }
  return layout as unknown as ChatLayout;
}
