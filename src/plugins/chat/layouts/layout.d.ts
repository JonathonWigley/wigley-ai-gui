import type { BaseKit, DotStatus } from '../../../shared/page/layout-host/kit';

// The status dot's states and the base kit, for a layout's JSDoc to import from here.
export type { BaseKit, DotStatus };

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
  agentId: string;
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

// The entry kinds an activity line groups.
export type StepInput = ToolInput | ThinkingInput | RawInput;

// One run of the agent's steps. Times are epoch ms.
export interface ActivityInput {
  // In entry order, each the step's entry input.
  steps: StepInput[];
  // The last step.
  current: StepInput;
  // The session works on this run, and it is the last entry. The default layout draws a live run as its summary line.
  live: boolean;
  // The user has the line open, and the app places the step rows under it. The default layout draws its summary line
  // whether open or not.
  open: boolean;
  // When the run began: the entry before it, or its first step when the run opens the list.
  startedAt: number;
  // When the run ended; null while live.
  endedAt: number | null;
  // The time of this draw or update; the app sends it again once a second while the run is live. A live line's time
  // is `now - startedAt`, a finished one's `endedAt - startedAt`.
  now: number;
}

// What the running turn is doing, the first that holds: `waiting` on an unanswered permission, `working` on a tool
// with no result, `writing` while the last entry is streaming assistant text, else `thinking`.
export type WorkingState = 'thinking' | 'writing' | 'working' | 'waiting';

// The running turn, drawn in the composer's activity dock. Times are epoch ms.
export interface LiveWorkingInput {
  // What the turn is doing now.
  state: WorkingState;
  // The turn's steps in entry order, each the step's entry input, leaving out subagents' tool calls (a tool whose
  // `agentId` is not `main`); the layout picks the ones it shows.
  steps: StepInput[];
  // When the turn began: its first entry, the later of the user's last message and the first entry after the last
  // result. While the turn holds no entries, the dock keeps the start it shows; a dock that was hidden or done starts
  // at `now`.
  startedAt: number;
  // The time of this draw or update; the turn's time is `now - startedAt`.
  now: number;
}

// The finished turn: every entry from the user's last message to its last result; the dock shows it while the session
// is idle, until the user sends the next message. Times are epoch ms.
export interface DoneWorkingInput {
  state: 'done';
  // The turn's steps in entry order, each the step's entry input, leaving out subagents' tool calls (a tool whose
  // `agentId` is not `main`); the layout picks the ones it shows.
  steps: StepInput[];
  // The user's last message's `at`; the first entry's with no user entry. It can be earlier than the live turn's
  // start, when the turn holds a result before its last one.
  startedAt: number;
  // The last result's `at`.
  endedAt: number;
  // The last result's stop reason.
  stopReason: string;
  // The sum of the results' non-null costs; null when none has one.
  costUsd: number | null;
}

export type WorkingInput = LiveWorkingInput | DoneWorkingInput;

// One pending message: its text as typed, how many images it carries, and whether the user sent it into the running
// turn, so it waits only for the agent to take it in.
export interface QueuedMessageInput {
  text: string;
  imageCount: number;
  sent: boolean;
}

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
  // A plain one-line row, no card, that opens `body()` in place under it; Enter on the focused entry toggles it with
  // the entry's expanders. Its `element` is appended to `parent`; `leading` moves into its head.
  collapsibleRow(
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

// What a part other than an entry returns: its root, appended to `parent`, and an optional `update` the app runs with
// each later input in place of drawing the part again.
export interface PartView<I> {
  element: HTMLElement;
  update?(input: I): void;
}

// A session control as its chip shows it: `value` is the choice's label, else the raw value, else `unset`; `enabled`
// holds while the session's process runs.
export interface ComposerControlInput {
  id: string;
  label: string;
  value: string;
  enabled: boolean;
}
// The session's model control and its effort control, which the status line shows as one chip; `effort` is null when
// the session declares no effort control.
export interface ModelEffortInput {
  model: ComposerControlInput;
  effort: ComposerControlInput | null;
}
export interface ComposerInput {
  // The tab's name.
  session: string;
  // The name of the clone's top folder holding the session's folder; the folder's own name outside a clone.
  repo: string;
  // The clone's checked-out branch, or its short commit on a detached HEAD; null outside a clone.
  branch: string | null;
  isBoxFocused: boolean;
  // The session's process runs.
  running: boolean;
  // Running, and a turn is in progress.
  working: boolean;
  // The model and effort controls; null when the session declares no model control, and an effort control then stays
  // in `controls`.
  modelEffort: ModelEffortInput | null;
  // Every other control, in the order the session declares them.
  controls: ComposerControlInput[];
}
// The composer's pieces. Each slot and the box mounts once per draw: a second call throws `<part> placed twice`, and
// the composer draws with `default`. A composer that leaves the box out gets it at the end of its element, and the
// working slot just above the box.
export interface ComposerKit extends BaseKit {
  // `div.ui-floating`: the glass panel; the composer's root in the default layout.
  floatingPanel(parent: HTMLElement): HTMLElement;
  // The message box frame, its editor inside.
  box(parent: HTMLElement): HTMLElement;
  // The slot the `working` part draws into: the activity dock. The app hides it while there is nothing to show. A
  // composer that leaves it out gets it just above the box.
  working(parent: HTMLElement): HTMLElement;
  // The slot the `attachments` part draws into; the app hides it while no image is attached.
  attachments(parent: HTMLElement): HTMLElement;
  // The slot the `statusLine` part draws into.
  statusLine(parent: HTMLElement): HTMLElement;
  // `div.chat-composer-parts`, holding one `div.chat-composer-part` (`data-part="<id>"`) per part other plugins added
  // for every Chat tab, in the order they were added, each drawn for the tab's session; returns the
  // `div.chat-composer-parts`. Call it once, where the parts go: a composer that leaves it out gets the parts first in
  // its element. A part that throws is logged and draws nothing. A second call throws
  // `composer placed contributed parts twice`, so the composer draws with `default`.
  contributedParts(parent: HTMLElement): HTMLElement;
}
// The status line's pieces. Each piece holding keys places the same element on every draw.
export interface StatusLineKit extends BaseKit {
  // The `i` and `a` prompts; hidden, keeping its space, while the box has focus.
  typeHint(parent: HTMLElement): HTMLElement;
  // One chip for the model and effort: the model control's label, then `<model> · <effort>` (the model alone while
  // `effort` is null). It opens the model picker and holds the model and effort pick keys (the model's alone while
  // `effort` is null); disabled while the model control is not `enabled`.
  modelEffortChip(
    parent: HTMLElement,
    input: ModelEffortInput,
  ): HTMLButtonElement;
  // A chip showing the control's label and value that opens its picker; disabled while not `enabled`. The first chip
  // whose command opens a picker holds that command's keys.
  controlChip(
    parent: HTMLElement,
    control: ComposerControlInput,
  ): HTMLButtonElement;
  // The slot holding `div.chat-status-parts`: one `div.chat-status-part` (`data-part="<id>"`) per status part other
  // plugins added for every Chat tab, in the order they were added, each drawn for the tab's session; returns the
  // slot. Call it once: a status line that leaves it out gets the slot at the end of its element. A second call throws
  // `status line placed status parts twice`, so the line draws with `default`.
  statusParts(parent: HTMLElement): HTMLElement;
  // A running dot, the interrupt keys and the send-now keys; hidden, keeping its space, while not working.
  running(parent: HTMLElement): HTMLElement;
  // Send with its keys.
  sendButton(parent: HTMLElement): HTMLButtonElement;
}
// One attached image: `src` a `data:` URL, `index` its place from 0.
export interface AttachmentInput {
  src: string;
  index: number;
  count: number;
}
export interface AttachmentsInput {
  images: AttachmentInput[];
}
export interface AttachmentsKit extends BaseKit {
  // A small close button that removes the image at `index`.
  removeButton(parent: HTMLElement, index: number): HTMLButtonElement;
}

// One row of a list chat opens, by list: the start prompt's Folder, Profile and Session steps, the Controls list and a
// control's choices. A recent folder's `path` is spelled as the row shows it, the home folder as `~`; a control's
// `value` as its chip shows it.
export type PickerItemInput =
  | {
      list: 'folder';
      kind: 'recent';
      path: string;
      profile: string;
      lastUsed: number;
    }
  | { list: 'folder'; kind: 'choose' }
  | { list: 'profile'; name: string; configDir: string }
  | { list: 'session'; kind: 'new' }
  | {
      list: 'session';
      kind: 'past';
      title: string;
      modified: number;
      archived: boolean;
    }
  | { list: 'controls'; label: string; value: string }
  | { list: 'choices'; label: string; isCurrent: boolean };
// `label` is the line the list filters on.
export interface PickerRowInput {
  item: PickerItemInput;
  label: string;
}
export interface PickerRowKit extends BaseKit {
  // The cursor row's prompt (`x archive` / `x restore` in the Session step); null on every other row. A row draws
  // through `row(parent, { density: 'list', tag: 'li', … })`; the app sets `is-selected` and `is-cursor` on it.
  cursorEnd(): HTMLElement | null;
}

// `link` is null until the sign-in reports it.
export interface SignInInput {
  profile: string;
  link: string | null;
}
export interface SignInKit extends BaseKit {
  // Copy with its keys; disabled while `link` is null.
  copyButton(parent: HTMLElement): HTMLButtonElement;
  // The code box frame, its editor inside. Mounts once per draw; left out, it ends the part's element.
  codeBox(parent: HTMLElement): HTMLElement;
  // `div.ui-dialog-actions`: Cancel and Send code with their keys. Left out, it ends the part's element.
  actions(parent: HTMLElement): HTMLElement;
}
export interface ReasonBoxInput {
  toolName: string;
}
export interface ReasonBoxKit extends BaseKit {
  // The reason box frame, its editor inside. Mounts once per draw; left out, it ends the part's element.
  reasonBox(parent: HTMLElement): HTMLElement;
  // `div.ui-dialog-actions`: Back and Deny with their keys. Left out, it ends the part's element.
  actions(parent: HTMLElement): HTMLElement;
}
export interface CloseConfirmInput {
  session: string;
}
export interface CloseConfirmKit extends BaseKit {
  // `div.ui-dialog-actions`: Keep it running and End the session with their keys. Left out, it ends the part's
  // element.
  actions(parent: HTMLElement): HTMLElement;
}
// `src` a `data:` URL; `index` the image's place from 0 among `count`.
export interface ImageViewerInput {
  src: string;
  index: number;
  count: number;
}

// Builds one entry into `parent` from the entry and a kit made for that entry: the builder appends its element to
// `parent` and returns it in `element`.
export type EntryBuilder<K extends EntryKind> = (
  parent: HTMLElement,
  input: EntryInput<K>,
  kit: ChatKit,
) => EntryView<K>;

// The chat layout a user writes: a builder for each entry kind it changes, and the other surfaces' parts it changes;
// a part or entry kind left out draws with `default`. A dialog part draws into the dialog's body; the app keeps the
// dialog's frame and title.
export interface ChatLayout {
  // Whether the entry list draws the agent's steps (activity lines and their step rows) and the `result` entries;
  // `false` leaves them out of the list and the entry cursor. A user layout that wants the activity lines sets it
  // `true`. Left out, the layout takes `default`'s.
  activityInTranscript?: boolean;
  entries?: { [K in EntryKind]?: EntryBuilder<K> };
  // One run of the agent's steps (tool, thinking, raw entries between two other entries), drawn into its slot; the
  // app keeps the cursor, the click that opens it and the step rows.
  activity?(
    parent: HTMLElement,
    input: ActivityInput,
    kit: BaseKit,
  ): PartView<ActivityInput>;
  // The activity dock, drawn into the composer's working slot (`ComposerKit.working`): a `LiveWorkingInput` while the
  // turn runs, a `DoneWorkingInput` while the session is idle after a finished turn, until the user sends the next
  // message; a user part receives both and branches on `input.state`. The app sends the input again on each change
  // and once a second with a new `now` while the turn is live. The slot hides while there is nothing to show; it is
  // not a cursor stop.
  working?(
    parent: HTMLElement,
    input: WorkingInput,
    kit: BaseKit,
  ): PartView<WorkingInput>;
  // One pending message's row, appended to the entry list after the last entry; the app marks the focused row and
  // handles its click, and sends the input again when the row turns sent.
  queuedMessage?(
    parent: HTMLElement,
    input: QueuedMessageInput,
    kit: BaseKit,
  ): PartView<QueuedMessageInput>;
  // The floating composer, appended to the Chat tab under the entries.
  composer?(
    parent: HTMLElement,
    input: ComposerInput,
    kit: ComposerKit,
  ): PartView<ComposerInput>;
  // The status line under the box, drawn into the composer's status line slot again on each change.
  statusLine?(
    parent: HTMLElement,
    input: ComposerInput,
    kit: StatusLineKit,
  ): PartView<ComposerInput>;
  // The attached images, drawn into the composer's attachments slot again on each change.
  attachments?(
    parent: HTMLElement,
    input: AttachmentsInput,
    kit: AttachmentsKit,
  ): PartView<AttachmentsInput>;
  // One row of a list chat opens, appended to the list.
  pickerRow?(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): PartView<PickerRowInput>;
  signIn?(
    parent: HTMLElement,
    input: SignInInput,
    kit: SignInKit,
  ): PartView<SignInInput>;
  reasonBox?(
    parent: HTMLElement,
    input: ReasonBoxInput,
    kit: ReasonBoxKit,
  ): PartView<ReasonBoxInput>;
  closeConfirm?(
    parent: HTMLElement,
    input: CloseConfirmInput,
    kit: CloseConfirmKit,
  ): PartView<CloseConfirmInput>;
  // The image and its place on the viewer's scrim.
  imageViewer?(
    parent: HTMLElement,
    input: ImageViewerInput,
    kit: BaseKit,
  ): PartView<ImageViewerInput>;
}

// The built-in layout: a builder for every entry kind and every part.
export interface CompleteChatLayout extends Required<ChatLayout> {
  entries: { [K in EntryKind]: EntryBuilder<K> };
}
