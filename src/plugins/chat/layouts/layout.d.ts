import type { BaseKit, DotStatus } from '../../../shared/page/layout-host/kit';

// The status dot's states, for a layout's JSDoc to import from here.
export type { DotStatus };

export type EntryKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'permission'
  | 'result'
  | 'notice'
  | 'raw';

// `images` are the message's attached images, base64 with no `data:` prefix.
export interface UserInput {
  kind: 'user';
  id: string;
  text: string;
  images: { mediaType: string; data: string }[];
  raw: unknown[];
}
export interface AssistantInput {
  kind: 'assistant';
  id: string;
  text: string;
  streaming: boolean;
  raw: unknown[];
}
export interface ThinkingInput {
  kind: 'thinking';
  id: string;
  text: string;
  streaming: boolean;
  raw: unknown[];
}
export interface ToolInput {
  kind: 'tool';
  id: string;
  toolUseId: string;
  name: string;
  input: unknown;
  summary: string;
  result: { text: string; isError: boolean } | null;
  raw: unknown[];
}
export interface PermissionInput {
  kind: 'permission';
  id: string;
  toolName: string;
  input: unknown;
  answer: { allowed: boolean; reason: string | null } | null;
  raw: unknown[];
}
export interface ResultInput {
  kind: 'result';
  id: string;
  stopReason: string;
  costUsd: number | null;
  durationMs: number | null;
  raw: unknown[];
}
export interface NoticeInput {
  kind: 'notice';
  id: string;
  text: string;
  tone: 'info' | 'error';
  raw: unknown[];
}
export interface RawInput {
  kind: 'raw';
  id: string;
  raw: unknown[];
}

export interface EntryInputs {
  user: UserInput;
  assistant: AssistantInput;
  thinking: ThinkingInput;
  tool: ToolInput;
  permission: PermissionInput;
  result: ResultInput;
  notice: NoticeInput;
  raw: RawInput;
}
export type EntryInput<K extends EntryKind> = EntryInputs[K];

export interface EntryView<K extends EntryKind = EntryKind> {
  element: HTMLElement;
  // Runs with each later version of the entry (same id) while it shows. A view with no update is built again and its element replaced.
  update?(input: EntryInput<K>): void;
}

// A status edge on a card's leading side: `attention` for a prompt that needs the user, `error` for a failure.
export type CardEdge = 'attention' | 'error';

// `summary` is the head's one line (mono in the code font), `leading` sits before it, `open` opens it at once,
// and `body` builds the body afresh on each open.
export interface CollapsibleCardOptions {
  summary: string;
  mono?: boolean;
  leading?: HTMLElement | null;
  open?: boolean;
  body(): HTMLElement;
}

export interface CollapsibleCard {
  element: HTMLElement;
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

// Chat's parts over the shared base kit. Every part appends itself to `parent` and returns what it appended;
// `markdown`, `card`, `statusDot`, `setDotStatus` and `sectionHeader` are the base kit's.
export interface ChatKit extends BaseKit {
  json(parent: HTMLElement, value: unknown): HTMLElement; // pretty-printed, in a <pre>
  // A collapsible card in the UI font that opens to `body()`, with no leading part; Enter on the focused entry
  // toggles the entry's expanders and collapsible cards. `body` runs on each open; return one element and keep it
  // to refill it in place.
  expander(
    parent: HTMLElement,
    summary: string,
    body: () => HTMLElement,
  ): HTMLElement;
  // A card whose head toggles its body, built closed unless `open`; Enter on the focused entry toggles it with the
  // entry's expanders. Its `element` is appended to `parent`; `leading` moves into its head.
  collapsibleCard(
    parent: HTMLElement,
    options: CollapsibleCardOptions,
  ): CollapsibleCard;
  edgeCard(parent: HTMLElement, edge?: CardEdge | null): HTMLElement; // a solid block, with a status edge when `edge` is given
  // Allow once / Deny with their keys beside them (anchors the keys plugin draws); Deny opens the reason box. Draws the
  // answer instead once the entry carries one; the part keeps itself up to date as the entry's answer arrives.
  permissionActions(parent: HTMLElement): HTMLElement;
  // A user entry's images as thumbnails; clicking one opens the image viewer at it. Throws for any other entry kind.
  // Enter on a focused user entry with images opens the viewer at its first image, in place of toggling its expanders.
  // Call it again in `update` for the entry's later images.
  images(parent: HTMLElement): HTMLElement;
}

// The complete chat layout: a builder for every entry kind.
export interface ChatLayout {
  // Builds one entry into `parent` from the entry and a kit made for that entry: the builder appends its element to
  // `parent` and returns it in `element`.
  entries: {
    [K in EntryKind]: (
      parent: HTMLElement,
      input: EntryInput<K>,
      kit: ChatKit,
    ) => EntryView<K>;
  };
}
