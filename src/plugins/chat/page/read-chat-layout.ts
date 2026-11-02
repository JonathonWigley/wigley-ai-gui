import type { ChatEntry, ChatEntryKind } from '../../../contracts/agent';
import {
  isRecord,
  readLayoutModule,
  requireLayoutParts,
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
  activity: true,
  queuedMessage: true,
  composer: true,
  composerBar: true,
  attachments: true,
  pickerRow: true,
  signIn: true,
  reasonBox: true,
  closeConfirm: true,
  imageViewer: true,
};

// The chat layout a user's `layout.js` module exports as its default. Every
// part and every entry builder may be left out. Throws naming the first key
// that is no part (`entries.<key>` for an entry kind), then the first part or
// builder that is not a function, or `entries` when it is not an object.
export function readChatLayout(module: unknown, name: string): ChatLayout {
  const layout = readLayoutModule(module, name);
  const { entries, ...parts } = layout;
  requireLayoutParts(parts, name, PART_SET);
  if (entries !== undefined) {
    if (!isRecord(entries)) {
      throw new Error(`layout ${name}: entries is not an object`);
    }
    requireLayoutParts(entries, name, KIND_SET, 'entries.');
  }
  return layout as ChatLayout;
}
