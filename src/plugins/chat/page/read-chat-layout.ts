import type {
  ChatEntry,
  ChatEntryKind,
  HarnessEntryKind,
} from '../../../contracts/agent';
import {
  isRecord,
  readLayoutModule,
  requireLayoutParts,
} from '../../../shared/page/layout-host/read-layout-module';
import type {
  AnyEntryKind,
  ChatLayout,
  EntryInput,
  EntryKind,
  HarnessEntryInput,
  HarnessEntryKind as LayoutHarnessEntryKind,
} from '../layouts/layout';
import { type ChatPartName, isHarnessKind } from './chat-layouts';

// A `Record` over every known kind, so a kind left out fails to compile.
const KIND_SET: Record<EntryKind, true> = {
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
// input, the contract's kinds and the layout's kinds are one set, the two
// harness kind types are one type, and no known kind is a harness kind. A
// variant missing or renaming an input's field, or a drifted kind, makes a
// member `never`, which `true` cannot fill. Without strictNullChecks a field
// turning nullable is not caught. A result's input also holds the step count
// the entry list adds, and a user's the latest delivery flag it adds.
type InputAddition<K extends EntryKind> = K extends 'result'
  ? { stepCount: number }
  : K extends 'user'
    ? { isLatestDelivery: boolean }
    : unknown;
type VariantFitsInput = {
  [K in EntryKind]: Extract<ChatEntry, { kind: K }> &
    InputAddition<K> extends EntryInput<K>
    ? true
    : never;
};
const VARIANTS_FIT_INPUTS: VariantFitsInput = { ...KIND_SET };
const HARNESS_VARIANT_FITS_INPUT: Extract<
  ChatEntry,
  { kind: HarnessEntryKind }
> extends HarnessEntryInput
  ? true
  : never = true;
const CHAT_KINDS_ARE_LAYOUT_KINDS: [ChatEntryKind] extends [AnyEntryKind]
  ? true
  : never = true;
const LAYOUT_KINDS_ARE_CHAT_KINDS: [AnyEntryKind] extends [ChatEntryKind]
  ? true
  : never = true;
const CHAT_HARNESS_KINDS_ARE_LAYOUT_HARNESS_KINDS: [HarnessEntryKind] extends [
  LayoutHarnessEntryKind,
]
  ? true
  : never = true;
const LAYOUT_HARNESS_KINDS_ARE_CHAT_HARNESS_KINDS: [
  LayoutHarnessEntryKind,
] extends [HarnessEntryKind]
  ? true
  : never = true;
const KNOWN_KINDS_ARE_NOT_HARNESS_KINDS: [
  EntryKind & HarnessEntryKind,
] extends [never]
  ? true
  : never = true;
void [
  VARIANTS_FIT_INPUTS,
  HARNESS_VARIANT_FITS_INPUT,
  CHAT_KINDS_ARE_LAYOUT_KINDS,
  LAYOUT_KINDS_ARE_CHAT_KINDS,
  CHAT_HARNESS_KINDS_ARE_LAYOUT_HARNESS_KINDS,
  LAYOUT_HARNESS_KINDS_ARE_CHAT_HARNESS_KINDS,
  KNOWN_KINDS_ARE_NOT_HARNESS_KINDS,
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
  pickerHeading: true,
  completionDescription: true,
  signIn: true,
  reasonBox: true,
  closeConfirm: true,
  dialogFrame: true,
  imageViewer: true,
  rowClock: true,
  rowProfile: true,
  sideSection: true,
  sessionFacts: true,
};

// The chat layout a user's `layout.js` module exports as its default. Every
// part, the `activityInTranscript` flag and every entry builder may be left
// out. Throws naming `composerBar`, with the `statusLine` part it became, then
// the first key that is no part, then the first part that is not a function,
// then `activityInTranscript` when it is not a boolean, then `entries` when it
// is not an object, then the first `entries.<key>` that is no entry kind or
// not a function. Any key holding `:` is a harness's own kind
// (`<harness id>:<kind>`) and an entry kind.
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
    requireLayoutParts(entries, name, entryKindsOf(entries), 'entries.');
  }
  return layout as ChatLayout;
}

// The entry kinds a layout's `entries` may name: every known kind, and each of
// its keys that is a harness kind.
function entryKindsOf(
  entries: Record<string, unknown>,
): Readonly<Record<string, true>> {
  const harnessKinds = Object.keys(entries).filter(isHarnessKind);
  return {
    ...KIND_SET,
    ...Object.fromEntries(harnessKinds.map((kind) => [kind, true as const])),
  };
}
