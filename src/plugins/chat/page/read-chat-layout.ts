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
  compaction: true,
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
  working: true,
  workingLine: true,
  queuedMessage: true,
  composer: true,
  statusLine: true,
  attachments: true,
  pickerRow: true,
  signIn: true,
  reasonBox: true,
  closeConfirm: true,
  imageViewer: true,
  rowClock: true,
  sideSection: true,
  sessionFacts: true,
};

// The chat layout a user's `layout.js` module exports as its default. Every
// part, the `activityInTranscript` flag and every entry builder may be left
// out. Throws naming `composerBar`, with the `statusLine` part it became, then
// the first key that is no part, then the first part that is not a function,
// then `activityInTranscript` when it is not a boolean, then `entries` when it
// is not an object, then the first `entries.<key>` that is no entry kind or
// not a function.
export function readChatLayout(module: unknown, name: string): ChatLayout {
  const layout = readLayoutModule(module, name);
  const { entries, activityInTranscript, ...parts } = layout;
  if (Object.hasOwn(parts, 'composerBar')) {
    throw new Error(
      `layout ${name}: composerBar is not a layout part; it became the statusLine part`,
    );
  }
  requireLayoutParts(parts, name, PART_SET);
  if (
    activityInTranscript !== undefined &&
    typeof activityInTranscript !== 'boolean'
  ) {
    throw new Error(`layout ${name}: activityInTranscript is not a boolean`);
  }
  if (entries !== undefined) {
    if (!isRecord(entries)) {
      throw new Error(`layout ${name}: entries is not an object`);
    }
    requireLayoutParts(entries, name, KIND_SET, 'entries.');
  }
  return layout as ChatLayout;
}
