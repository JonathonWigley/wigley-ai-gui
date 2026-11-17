import type {
  BaseKit,
  DialogFrameInput,
  DialogFramePart,
  DotStatus,
  PromptActionInput,
} from '../../../shared/page/layout-host/kit';

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
  | 'raw'
  | 'compaction';

// A harness's own entry kind, `<harness id>:<kind>`; no known kind holds a `:`.
export type HarnessEntryKind = `${string}:${string}`;

// Any entry kind a builder may draw: a known one, or a harness's own.
export type AnyEntryKind = EntryKind | HarnessEntryKind;

// What started a compaction: `app`, the app itself; `manual`, the user's `/compact`; `harness`, the harness on its own.
export type CompactionTrigger = 'app' | 'manual' | 'harness';

// How far a user message got toward the model. `sent`: a turn took it in. `received`: a response to it has started.
// `notReceived`: it ended before a response.
export type UserDelivery = 'sent' | 'received' | 'notReceived';

// `images` are the message's attached images, base64 with no `data:` prefix.
// `delivery` is null when nothing tracks the message. `isLatestDelivery` holds on the session's last user message whose
// `delivery` is not null, and the app sends the input again when it changes; the default layout draws `Received` only
// on that message, and `Sent` and `Not received` on every message.
export interface UserInput {
  kind: 'user';
  id: string;
  text: string;
  images: { mediaType: string; data: string }[];
  delivery: UserDelivery | null;
  isLatestDelivery: boolean;
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
  // The main agent's steps in the turn this result ends, from its start: the later of the last user message and the
  // previous result.
  stepCount: number;
  raw: unknown[];
}
export interface NoticeInput {
  kind: 'notice';
  id: string;
  text: string;
  tone: 'info' | 'error';
  raw: unknown[];
}
// `default`'s `raw` builder also draws an entry of a harness kind no layout or renderer names; `kind` is then that kind.
export interface RawInput {
  kind: 'raw' | HarnessEntryKind;
  id: string;
  raw: unknown[];
}
// A finished compaction. `at` is epoch ms. `beforeTokens` is null when the harness does not report it, `durationMs`
// likewise. `afterTokens` is null until the size the compaction left is known; the entry then arrives again with it set.
export interface CompactionInput {
  kind: 'compaction';
  id: string;
  at: number;
  trigger: CompactionTrigger;
  beforeTokens: number | null;
  afterTokens: number | null;
  durationMs: number | null;
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
  compaction: CompactionInput;
}
// An entry of a harness's own kind: it carries only `raw`, the harness events it was built from, oldest first. `at` is
// epoch ms.
export interface HarnessEntryInput {
  kind: HarnessEntryKind;
  id: string;
  at: number;
  raw: unknown[];
}
export type EntryInput<K extends AnyEntryKind> = K extends EntryKind
  ? EntryInputs[K]
  : HarnessEntryInput;

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

// What the running turn is doing, the first that holds: `compacting` while a compaction runs, whatever the turn does,
// `waiting` on an unanswered permission, `working` on a tool with no result, `writing` while the last entry is
// streaming assistant text, else `thinking`.
export type WorkingState =
  | 'thinking'
  | 'writing'
  | 'working'
  | 'waiting'
  | 'compacting';

// The running turn or compaction, drawn in the session hub's activity dock, the composer's activity line and the
// transcript's turn line. Times are epoch ms.
export interface LiveWorkingInput {
  // What the turn is doing now.
  state: WorkingState;
  // The turn's steps in entry order, each the step's entry input, leaving out subagents' tool calls (a tool whose
  // `agentId` is not `main`); the layout picks the ones it shows.
  steps: StepInput[];
  // When the turn began: its first entry, the later of the user's last message and the first entry after the last
  // result. While the turn holds no entries, the dock keeps the start it shows; a dock that was hidden or done starts
  // at `now`. While `state` is `compacting`, when the compaction began.
  startedAt: number;
  // The time of this draw or update; the turn's time is `now - startedAt`.
  now: number;
  // What started the compaction, as the dock reads it, while `state` is `compacting`; else null.
  compaction: string | null;
}

// The finished turn: every entry from the user's last message on; the dock and the activity line show it while the
// session is idle, until the user sends the next message. Times are epoch ms.
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
// turn, so it waits only for the agent to take it in. `holdReason` is the send gate's reason while the message waits
// on a compaction it asked for, else null. `skipKey` is the keys that skip that compaction, formatted for the
// platform; empty when the interrupt command is unbound.
export interface QueuedMessageInput {
  text: string;
  imageCount: number;
  sent: boolean;
  holdReason: string | null;
  skipKey: string;
}

// A session's run time under its side-bar row: `text` is the time already formatted, and `isRunning` holds while its
// clock runs.
export interface RowClockInput {
  text: string;
  isRunning: boolean;
}

// `name` is the session's profile: the name a registered harness's profiles give its config folder, else the folder's
// last segment.
export interface RowProfileInput {
  name: string;
}

// One session hub section's frame: `partId` is the side part's id (`chat.session`, `chat.mainAgent`), for a layout that
// frames one part its own way; `summary` is the text its part set, null for none; `collapsed` holds while its body is
// hidden.
export interface SideSectionInput {
  partId: string;
  title: string;
  summary: string | null;
  collapsed: boolean;
}

// The session hub's Session facts: `folder` shows the home folder as `~`; `worktrees` are the names of the worktrees
// the agents wrote in, empty for none; `harness` is the harness's id and `harnessLabel` its label (for a harness
// no adapter registered, the shared `harnessLabel` helper's stand-in label, else the id); `branch` is null outside
// a git repo and `modelEffort` (`Opus 5 · high`) null when the harness declares no model control.
export interface SessionFactsInput {
  repo: string;
  branch: string | null;
  folder: string;
  worktrees: readonly string[];
  harness: string;
  harnessLabel: string;
  modelEffort: string | null;
}

// A `/` completion row's description, never empty.
export interface CompletionDescriptionInput {
  description: string;
}

export interface EntryView<K extends AnyEntryKind = EntryKind> {
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
  // Opens or closes the card on screen only. A reload reopens what the user's toggle (a click on its head, Enter on
  // the entry) or the entry's draw or update left open; a `setOpen` at any other time stays off the saved place.
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
  // Allow once / Deny with their keys beside them (anchors the core draws); Deny opens the reason box. Draws the
  // answer instead once the entry carries one; the part keeps itself up to date as the entry's answer arrives.
  permissionActions(parent: HTMLElement): HTMLElement;
  // A user entry's images as thumbnails; clicking one opens the image viewer at it. Throws for any other entry kind.
  // Enter on a focused user entry with images opens the viewer at its first image, in place of toggling its expanders.
  // Call it again in `update` for the entry's later images.
  images(parent: HTMLElement): HTMLElement;
  // `count` tokens as the usage line reads them: `842`, `182k`, `1.3M`, `0k` for none. Appends nothing.
  tokens(count: number): string;
}

// What a part other than an entry returns: its root, appended to `parent`, and an optional `update` the app runs with
// each later input in place of drawing the part again.
export interface PartView<I> {
  element: HTMLElement;
  update?(input: I): void;
}

// A session control as its chip shows it: `value` is the choice's label, else the raw value, else `unset`; `enabled`
// holds while the session's process runs; `role` is the control's role (`model`, `permissionMode`, `effort` or another
// the harness declares), null when it declares none.
export interface ComposerControlInput {
  id: string;
  label: string;
  value: string;
  enabled: boolean;
  role: string | null;
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
  // Running, and a turn or a compaction is in progress.
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
  // The slot the `workingLine` part draws into: the activity line. The app hides it while there is nothing to show, and
  // the default stylesheet while the session hub is visible. A composer that leaves it out gets it just above the box.
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
  // The `i` and `a` prompts, then `J`, `K`, `V` and `y` with no labels; hidden, keeping its space, while the box has
  // focus.
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
  // The interrupt keys and the send-now keys; hidden, keeping their space, while not working.
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
// `value` as its chip shows it. A `section` row sits under a heading: `title` is its name, `detail` the rest of its
// line (the section's note on the row first, when it has one), and `at` the time `detail` spells.
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
  | {
      list: 'folder' | 'session';
      kind: 'section';
      title: string;
      detail: string;
      at: number;
    }
  | { list: 'controls'; label: string; value: string }
  | { list: 'choices'; label: string; isCurrent: boolean };
// `label` is the line the list filters on and the row's tooltip shows; a `section` row's joins its title and detail.
// `prompt` is the actions the cursor row shows (`x archive` / `x restore` in the Session step), each drawn with
// `kit.keyHint`; empty on every other row. A layout that leaves out `pickerRow` draws it with `default`.
export interface PickerRowInput {
  item: PickerItemInput;
  label: string;
  prompt: readonly PromptActionInput[];
}
// A row draws through `row(parent, { density: 'list', tag: 'li', … })`; the app sets `is-selected` and `is-cursor`
// on it.
export interface PickerRowKit extends BaseKit {}
export interface PickerHeadingInput {
  title: string;
}
export type PickerHeadingKit = BaseKit;

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
// `src` a `data:` URL; `index` the image's place from 0 among `count`; `removable` while the images are the
// composer's attached ones, which `removeShownImage` removes from.
export interface ImageViewerInput {
  src: string;
  index: number;
  count: number;
  removable: boolean;
}
export interface SideSectionKit extends BaseKit {
  // `button.chat-side-section-head`, which toggles the section on click and takes no key and no focus: a click in the
  // focused pane leaves the focus where it was, and one in another pane moves it to that pane's box.
  head(parent: HTMLElement): HTMLButtonElement;
  // `div.chat-side-section-body`, the part's content inside; the same element on every draw. Mounts once per draw;
  // left out, it ends the part's element.
  body(parent: HTMLElement): HTMLElement;
}

// Builds one entry into `parent` from the entry and a kit made for that entry: the builder appends its element to
// `parent` and returns it in `element`. A `user` or `assistant` builder gets one cursor stop per block when it draws
// the text with `kit.markdown`; an entry with no marked block has one stop, and a body drawn later is not read until
// the next redraw. Copy reads the entry's source lines by a block's position, so copy per block needs the layout to
// draw `input.text` itself.
export type EntryBuilder<K extends AnyEntryKind> = (
  parent: HTMLElement,
  input: EntryInput<K>,
  kit: ChatKit,
) => EntryView<K>;

// The chat layout a user writes: a builder for each entry kind it changes, and the other surfaces' parts it changes;
// a part or entry kind left out draws with `default`. A dialog part draws into the dialog's body; `dialogFrame` draws
// the panel and title around it, and the app keeps the dialog's scrim, keys and focus.
export interface ChatLayout {
  // Whether the entry list draws the agent's steps (activity lines and their step rows); `false` leaves them out of
  // the list and the entry cursor. A user layout that wants the activity lines sets it
  // `true`. Left out, the layout takes `default`'s.
  activityInTranscript?: boolean;
  // A builder per known kind it changes; it may also name a harness's own kind (`<harness id>:<kind>`), which it then
  // draws over any renderer a plugin adds for that kind.
  entries?: { [K in EntryKind]?: EntryBuilder<K> } & {
    [kind: HarnessEntryKind]: EntryBuilder<HarnessEntryKind> | undefined;
  };
  // One run of the agent's steps (tool, thinking, raw entries between two other entries), drawn into its slot; the
  // app keeps the cursor, the click that opens it and the step rows.
  activity?(
    parent: HTMLElement,
    input: ActivityInput,
    kit: BaseKit,
  ): PartView<ActivityInput>;
  // The activity dock, drawn into the session hub's Main agent section: a `LiveWorkingInput` while the turn or a
  // compaction runs, a `DoneWorkingInput` while the session is idle after a finished turn, until the user sends the next
  // message; a user part receives both and branches on `input.state`. The app sends the input again on each change and
  // once a second with a new `now` while the dock is live. The slot hides while there is nothing to show, and the
  // section with it; it is not a cursor stop.
  working?(
    parent: HTMLElement,
    input: WorkingInput,
    kit: BaseKit,
  ): PartView<WorkingInput>;
  // The dock's one line, drawn into the composer's working slot (`ComposerKit.working`) with the same input at the same
  // times as `working`, for when the hub is not visible, and into the transcript's turn line, the row after the last
  // entry, with a live input only. Each slot hides while it has nothing to show; neither is a cursor stop.
  workingLine?(
    parent: HTMLElement,
    input: WorkingInput,
    kit: BaseKit,
  ): PartView<WorkingInput>;
  // One pending message's row, appended to the entry list after the last entry; the app marks the focused row and
  // handles its click, and sends the input again when the row turns sent or its hold ends.
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
  // The status line under the box, drawn into the composer's status line slot again on each change other than
  // `isBoxFocused`, which the app applies to the type hint in place.
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
  // One section's heading in such a list, appended to the heading's `li`, so its root is no `li`. Headings take no
  // cursor and no click, and hide while a filter is typed.
  pickerHeading?(
    parent: HTMLElement,
    input: PickerHeadingInput,
    kit: PickerHeadingKit,
  ): PartView<PickerHeadingInput>;
  // A `/` completion row's description, appended to the row after its name. It draws anew with each row the popup
  // draws, so a layout change shows at the next popup and an `update` never runs.
  completionDescription?(
    parent: HTMLElement,
    input: CompletionDescriptionInput,
  ): PartView<CompletionDescriptionInput>;
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
  // The frame of the sign-in, deny-reason and end-session dialogs: the panel, its title (`input.title`) and, when
  // `input.hasActions`, its actions row. Return the panel, appended to `parent`, with `body` and `actions` inside it;
  // the app fills them. The app keeps the scrim, showing and hiding, keys and focus. A frame whose `body` or `actions`
  // is not inside its panel, or whose `actions` is not null exactly when `hasActions` is false, draws with `default`.
  dialogFrame?(
    parent: HTMLElement,
    input: DialogFrameInput,
    kit: BaseKit,
  ): DialogFramePart;
  // The image and its place on the viewer's scrim.
  imageViewer?(
    parent: HTMLElement,
    input: ImageViewerInput,
    kit: BaseKit,
  ): PartView<ImageViewerInput>;
  // The run time, drawn into the session row's `chat.rowClock` wrapper; the app orders the wrapper among the row's
  // parts. The app sends the input again on each change and once a second while the clock runs, and draws nothing for
  // a session with no time yet.
  rowClock?(
    parent: HTMLElement,
    input: RowClockInput,
    kit: BaseKit,
  ): PartView<RowClockInput>;
  // The session's profile, drawn into the session row's `chat.rowProfile` wrapper; the app orders the wrapper among the
  // row's parts. The app draws the part again when the layouts or a harness's profiles change, and draws nothing for a
  // session with no config folder.
  rowProfile?(
    parent: HTMLElement,
    input: RowProfileInput,
    kit: BaseKit,
  ): PartView<RowProfileInput>;
  // One section's frame in the session hub, drawn into the side part's wrapper. The app sends the input again when the
  // section collapses, expands or its summary changes; a part with no `update` draws again, and the body moves over.
  sideSection?(
    parent: HTMLElement,
    input: SideSectionInput,
    kit: SideSectionKit,
  ): PartView<SideSectionInput>;
  // The session hub's Session facts, the body of the hub's first part. The app sends the input again after each
  // status line draw; a part with no `update` draws again.
  sessionFacts?(
    parent: HTMLElement,
    input: SessionFactsInput,
    kit: BaseKit,
  ): PartView<SessionFactsInput>;
}

// The built-in layout: a builder for every entry kind and every part.
export interface CompleteChatLayout extends Required<ChatLayout> {
  entries: { [K in EntryKind]: EntryBuilder<K> };
}
