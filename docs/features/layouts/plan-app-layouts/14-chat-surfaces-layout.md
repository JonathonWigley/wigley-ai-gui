# 14 — Chat surfaces draw through chat's layout

Status: in progress
Type: Task
Wave: 3 · Depends on: 04 (and 02 through it)
Plan: [plan.md](plan.md)

Every chat surface beyond the entries draws through chat's layout. Task 04 moved the entries onto the host. This
task does not change how entries draw. It adds the other surfaces as parts of the same `ChatLayout`, under the same
`chat.layout` setting and the same pick chain.

The surfaces, listed from the code (`src/plugins/chat/page/`):

| Part | Today | App keeps |
| --- | --- | --- |
| `composer` | `chat-view.ts` `createTab`: `floatingPanel()` `.chat-composer` holding the strip, the box, the bar | the box's editor, the paste listener, the height observer |
| `composerBar` | `chat-view.ts` `buildComposerBar`: vim mode, type hint, a chip per control, running indicator, Send | the key anchors, which chip holds a command's keys, the redraw on each change |
| `attachments` | `attachments.ts` `buildAttachmentStrip`: a thumbnail and a remove button per attached image | the `Attachments` model, paste and drop |
| `pickerRow` | `src/shared/page/list-picker.ts` `draw`: one `row()` per item, for every list chat opens: the start prompt's Folder, Profile and Session steps (the resume and archive list) and the Controls and control-choice pickers | the list picker's panel, title, filter box, header keys, cursor, filter, scroll, click |
| `signIn` | `sign-in-dialog.ts`: text, link with Copy, code box, Cancel / Send code | the dialog frame and title, show and hide, the scope, the code box's editor, the sign-in flow |
| `reasonBox` | `chat-dialogs.ts` `createReasonBox`: text, reason box, Back / Deny | the dialog frame and title, the scope, the editor |
| `closeConfirm` | `chat-dialogs.ts` `createCloseConfirm`: text, Keep it running / End the session | the dialog frame and title, the scope |
| `imageViewer` | `image-viewer.ts`: the image and `<n> of <count>` on the scrim | the scrim, show and hide, the scope, `h` / `l` stepping |

Not a part, kept app-owned: the Chat tab root (`div.chat-tab`) and the entry list's scroll box (`ol.chat-entries`),
which hold scrolling; the list picker's frame, which five owners share; the `/` completion popup, which the editor
adapter draws.

Files:
- modify `src/plugins/chat/layouts/layout.d.ts` — the new parts, their inputs and kits
- modify `src/plugins/chat/layouts/default/layout.js` — the default of each new part, drawing today's DOM and classes
- test `src/plugins/chat/layouts/default/layout.test.ts` — rows for the new default parts
- modify `src/plugins/chat/page/read-chat-layout.ts` · test `src/plugins/chat/page/read-chat-layout.test.ts`
- create `src/plugins/chat/page/chat-layouts.ts` — the shown chat layouts every surface reads, and the part draw helper
- create `src/plugins/chat/page/composer-input.ts` · test `src/plugins/chat/page/composer-input.test.ts`
- create `src/plugins/chat/page/composer-kit.ts` — the composer, bar and attachments kits ·
  test `src/plugins/chat/page/composer-kit.test.ts`
- create `src/plugins/chat/page/picker-row.ts` · test `src/plugins/chat/page/picker-row.test.ts`
- create `src/plugins/chat/page/dialog-kits.ts` — the sign-in, reason box, close confirm and image viewer kits
- modify `src/plugins/chat/page/chat-view.ts`, `attachments.ts`, `chat-dialogs.ts`, `sign-in-dialog.ts`,
  `image-viewer.ts`, `picker.ts`, `start-prompt.ts`, `chat-commands.ts`, `start.ts`

This task edits no file outside `src/plugins/chat/`. Task 02 owns `src/shared/page/list-picker.ts` and has added the
row hook and `redraw` this task fills.

Consumes:
- ← 02, exact signatures in `02-layout-core.md` § Produces: `api.layouts.show<L>(options: ShowLayoutOptions<L>):
  LayoutShow`, `ShownLayouts<L>`, `PartPick<L>`, `pickLayout<L>(chain, layouts, defines): PartPick<L>`,
  `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>):
  { built: R; layoutName: string; dispose(): void }` with `build(builder: B, parent: HTMLElement, rollback:
  RollbackDeps): R` (`dispose` disposes every anchor and runs every box `destroy` recorded through the successful
  attempt's `rollback`, once),
  `RollbackDeps`, `requireElementIn(parent, element, partName)`, `createBaseKit(deps: BaseKitDeps): BaseKit`,
  `BaseKitDeps`, `KitCommands { exists, run }`, `commandRunner(qualifiedId, commands): () => void`,
  `readLayoutModule(module, name)`, `isRecord(value)`; `BaseKit` (with `keyHint(parent, command, options?:
  KeyHintOptions)`, `statusDot`, `setDotStatus`, `row(parent, options: KitRowOptions)`, `emptyState`, `keyPrompt`)
  and `KitRowOptions` from `kit.d.ts`, imported in the repo's `layout.d.ts` from
  `'../../../shared/page/layout-host/kit'` beside 04's import.
- ← 02, the list picker's hook: `ListPickerRequest<T>.drawRow?(parent: HTMLElement, item: T, input: { label: string;
  trailing: HTMLElement | null; recordAnchor(anchor: Disposable): void }): HTMLElement` and `ListPicker.redraw(): void` (`src/shared/page/list-picker.ts`).
- ← 04: `ChatLayout` in `src/plugins/chat/layouts/layout.d.ts`, also the complete layout (its `entries` are required,
  and chat has no separate complete-layout type); the entry builders' form `(parent, input, kit)`; `ChatKit extends
  BaseKit`; `readChatLayout(module: unknown, name: string): ChatLayout` in `read-chat-layout.ts`;
  `chatCommandNamed(short: string): CommandId | null` in `src/plugins/chat/ids.ts`; and the call in chat's
  `page/start.ts` that hands the page `ShownLayouts<ChatLayout>` from `api.layouts.show`. This task renames nothing of
  04's.

Produces:
- In `src/plugins/chat/layouts/layout.d.ts` (each `parent` is the element the part appends its own root to; `drawPart`
  sets `data-layout="<name>"` and `data-layout-owner="chat"` on that root; A layout's `layout.css` selects under `[data-layout-owner="chat"][data-layout="<name>"]`):

  ```ts
  export interface PartView<I> { element: HTMLElement; update?(input: I): void }

  export interface ComposerControlInput { id: string; label: string; value: string; enabled: boolean }
  export interface ComposerInput {
    session: string;          // the tab's name
    modeLabel: string;        // the box's vim mode as `modeLabel()` prints it; 'PAGE' while the box has no focus
    isBoxFocused: boolean;
    running: boolean;         // the session's process runs
    working: boolean;         // running, and a turn is in progress
    controls: ComposerControlInput[];
  }
  export interface ComposerKit extends BaseKit {
    floatingPanel(parent: HTMLElement): HTMLElement;
    box(parent: HTMLElement): HTMLElement;          // the message box frame, its editor inside
    attachments(parent: HTMLElement): HTMLElement;  // the slot the `attachments` part draws into
    bar(parent: HTMLElement): HTMLElement;          // the slot the `composerBar` part draws into
  }
  export interface ComposerBarKit extends BaseKit {
    typeHint(parent: HTMLElement): HTMLElement;     // the `i` and `a` prompts; hidden while the box has focus
    controlChip(parent: HTMLElement, control: ComposerControlInput): HTMLButtonElement;
    running(parent: HTMLElement): HTMLElement;      // dot and interrupt keys; hidden, keeping its space, while not working
    sendButton(parent: HTMLElement): HTMLButtonElement;
  }
  export interface AttachmentInput { src: string; index: number; count: number }
  export interface AttachmentsInput { images: AttachmentInput[] }
  export interface AttachmentsKit extends BaseKit {
    removeButton(parent: HTMLElement, index: number): HTMLButtonElement;
  }

  export type PickerItemInput =
    | { list: 'folder'; kind: 'recent'; path: string; profile: string; lastUsed: number }  // path: as the row shows it, home as `~`
    | { list: 'folder'; kind: 'choose' }
    | { list: 'profile'; name: string; configDir: string }
    | { list: 'session'; kind: 'new' }
    | { list: 'session'; kind: 'past'; title: string; modified: number; archived: boolean }
    | { list: 'controls'; label: string; value: string }   // value: `valueLabel(control)`, `unset` for null
    | { list: 'choices'; label: string; isCurrent: boolean };
  export interface PickerRowInput { item: PickerItemInput; label: string }
  export interface PickerRowKit extends BaseKit {
    // The cursor row's prompt (`x archive` / `x restore`), the `trailing` the list picker hands; null elsewhere.
    // A row draws through `BaseKit.row(parent, { density: 'list', tag: 'li', … })`.
    cursorEnd(): HTMLElement | null;
  }

  export interface SignInInput { profile: string; link: string | null }
  export interface SignInKit extends BaseKit {
    copyButton(parent: HTMLElement): HTMLButtonElement;  // Copy with its keys; disabled while `link` is null
    codeBox(parent: HTMLElement): HTMLElement;           // the code box frame, its editor inside
    actions(parent: HTMLElement): HTMLElement;           // `div.ui-dialog-actions`: Cancel and Send code with keys
  }
  export interface ReasonBoxInput { toolName: string }
  export interface ReasonBoxKit extends BaseKit {
    reasonBox(parent: HTMLElement): HTMLElement;
    actions(parent: HTMLElement): HTMLElement;           // Back and Deny with keys
  }
  export interface CloseConfirmInput { session: string }
  export interface CloseConfirmKit extends BaseKit {
    actions(parent: HTMLElement): HTMLElement;           // Keep it running and End the session with keys
  }
  export interface ImageViewerInput { src: string; index: number; count: number }
  ```

  `ChatLayout` gains these optional members. Chat has no complete-layout type (task 04), so the compiler does not check
  that `default` defines them: `layout.test.ts` checks each, and `drawPart` throws `layout default has no <part>` for
  one it lacks:

  ```ts
  composer?(parent: HTMLElement, input: ComposerInput, kit: ComposerKit): PartView<ComposerInput>;
  composerBar?(parent: HTMLElement, input: ComposerInput, kit: ComposerBarKit): PartView<ComposerInput>;
  attachments?(parent: HTMLElement, input: AttachmentsInput, kit: AttachmentsKit): PartView<AttachmentsInput>;
  pickerRow?(parent: HTMLElement, input: PickerRowInput, kit: PickerRowKit): PartView<PickerRowInput>;
  signIn?(parent: HTMLElement, input: SignInInput, kit: SignInKit): PartView<SignInInput>;
  reasonBox?(parent: HTMLElement, input: ReasonBoxInput, kit: ReasonBoxKit): PartView<ReasonBoxInput>;
  closeConfirm?(parent: HTMLElement, input: CloseConfirmInput, kit: CloseConfirmKit): PartView<CloseConfirmInput>;
  imageViewer?(parent: HTMLElement, input: ImageViewerInput, kit: BaseKit): PartView<ImageViewerInput>;
  ```

- In `src/plugins/chat/page/chat-layouts.ts`:
  `export interface ChatLayouts { current(): ShownLayouts<ChatLayout>; set(shown: ShownLayouts<ChatLayout>): void;
  onChange(listener: () => void): Disposable }` and `export function createChatLayouts(): ChatLayouts`, starting on
  `{ layouts: new Map([['default', defaultLayout]]), user: 'default' }`. Also
  `export function drawChatPart<B, R extends { element: HTMLElement }>(options: { layouts: ChatLayouts; parent:
  HTMLElement; partName: ChatPartName; part(layout: ChatLayout): B | undefined; build(builder: B, parent: HTMLElement,
  rollback: RollbackDeps): R; log: Log }): { built: R; layoutName: string; dispose(): void }` — picks with
  `pickLayout([shown.user, 'default'], shown.layouts, (layout) => part(layout) !== undefined)` and draws with
  `drawPart` (`owner: 'chat'`, `defaultLayout` the built-in default, `logSource: 'chat'`), handing `build` straight through, so each
  attempt gets its own `rollback`. A surface's `build` makes its kit, calls the part, and returns
  `{ element: view.element, view, kit }`. `export type ChatPartName = 'composer' | 'composerBar' | 'attachments' |
  'pickerRow' | 'signIn' | 'reasonBox' | 'closeConfirm' | 'imageViewer'`.
- In `src/plugins/chat/page/composer-input.ts`:
  `export function composerInputOf(tab: { name: string; state: Pick<ChatSessionState, 'running' | 'activity' |
  'controls'>; isBoxFocused: boolean; boxMode: VimMode }): ComposerInput` and
  `export function chipKeyCommands(controls: readonly Pick<SessionControl, 'id'>[]): (ChatCommandName | null)[]`
  (per control, the pick command whose keys its chip holds; null when an earlier chip holds them).
- In `src/plugins/chat/page/picker-row.ts`, one exported function per list:
  `folderRowInput(item: FolderItem): PickerItemInput`, `profileRowInput(profile: ChatProfile): PickerItemInput`,
  `sessionRowInput(item: SessionItem): PickerItemInput`, `controlRowInput(control: SessionControl): PickerItemInput`,
  `choiceRowInput(choice: ControlChoice, control: SessionControl): PickerItemInput`.
- In `src/plugins/chat/page/picker.ts`: `PickerRequest<T>` gains the required member `rowInput(item: T):
  PickerItemInput`; `Picker` gains `redraw(): void`.

Decisions:
- One `ChatLayout`, one `chat.layout` setting, one pick chain for every part: `[shown.user, 'default']`. A user
  layout defines only the parts it changes (layouts design § Shape). `readChatLayout` accepts a layout without any of
  the new parts and throws, naming the part, for a new part present but not a function.
- New parts take the host's form `(parent, input, kit)` and append their root to `parent`, because `drawPart` checks
  the element with `requireElementIn(parent, …)`. Entries keep 04's form, the same `(parent, input, kit)`.
- Each surface's kit spreads `createBaseKit({ markdown, keys, commands, platform, scope, commandNamed:
  chatCommandNamed })` under its own parts, as 04's entry kit does, with `scope` the surface's scope below. The kit's
  `commands` are the `KitCommands` 04's `page/start.ts` builds. No surface kit declares its own `statusDot`,
  `setDotStatus`, `row`, `emptyState` or `keyPrompt`: those are `BaseKit`'s.
- Kit parts that hold keys (type hint, running, Send, each chip command's key span, dialog actions, Copy) are built
  once per surface per page load, with their anchors, and each call places the same element. Their anchors are not
  recorded through `rollback`: the surface owns them and disposes them when the tab or dialog goes. So a redraw never
  makes or disposes them, and the self-test's placement check still finds every chat bind placed.
- **Disposing a part on a redraw.** Each surface keeps the `dispose` of its last draw of each part (per tab for
  `composer`, `composerBar` and `attachments`; per dialog for the dialog parts; one for `imageViewer`). It calls that
  `dispose` before it draws the same part again and when the tab or dialog goes. So an anchor a user part makes
  through `BaseKit.keyHint` or `keyPrompt` holds one live anchor however often the bar redraws. A recorded box
  `destroy` detaches the box from the old part and keeps its editor, so the next draw places it again. Chat never
  calls the `dispose` of a `pickerRow` draw: the list picker disposes the anchors given to `recordAnchor`.
- The app-owned boxes (composer box, sign-in code box, reason box) are `inputFrame()` elements that hold a mounted
  editor. A kit's box part appends that same element; it never creates an editor. It records, through the attempt's
  `rollback.recordBox`, a destroy that detaches the element from the failed part and keeps the editor, so the `default` draw places it again. A part that leaves its box or
  its `actions` unplaced gets it appended at the end of the part's element, so the keys always reach a box.
- Each box and slot mounts once per draw: a second call in one draw throws `<part> placed twice`, and the host draws
  the part with `default`.
- The composer draws once per tab and again on each layout change. `composerBar` draws afresh on each change today's
  `bar.draw(tab)` runs on. `attachments` draws afresh on each `Attachments` change; the app hides the slot while no
  image is attached.
- A layout change keeps the user's work: each tab's box element moves into the new composer with its text, cursor and
  vim mode; the attached images stay in `Attachments` and draw again; a box that held focus is focused again with
  `focus()` and no options. The height observer and the composer's capture-phase paste listener move to the new
  composer root; the tab root keeps the drop listener.
- An open picker, dialog or image viewer draws again at once on a layout change (`ChatLayouts.onChange`), keeping its
  cursor, its box text and its index.
- The list picker stays the shared module, and task 02's hook is the only change to it. Chat's picker fills
  `drawRow(parent, item, { label, trailing, recordAnchor })`: it draws the `pickerRow` part through `drawChatPart` into `parent`,
  with input `{ item: request.rowInput(item), label }` and a kit whose `cursorEnd()` returns `trailing` and whose key anchor calls, if the row names any, hand each anchor to `recordAnchor`. The picker
  disposes them before each draw pass and when it closes; chat tracks no row anchor. The list
  picker sets the `li`'s `is-selected` and `is-cursor` classes, its `title` tooltip (the label) and its click on the
  returned element after the hook, so a layout styles the cursor row through `is-cursor`. Chat's `Picker.redraw()`
  calls the list picker's `redraw()`. Without `drawRow` the list picker draws as today, so docs, backlog, settings and
  notes do not change.
- Spelled as the row shows it: a recent folder's `path` is the `FolderItem`'s `label`, `displayPath(projectDir,
  homeDir, paths)` with the home folder as `~`, as the folder step prints it today (a layout has no paths service). A
  control's `value` (in `PickerItemInput` and `ComposerControlInput`) is `valueLabel(control)` from `chat-state.ts`:
  the choice's label, else the raw value, else `unset`, as today's chip draws it.
- The dialogs keep `createDialog` and its title. The end-session confirmation (`createCloseConfirm`) is chat's own
  dialog over `createDialog`, not the shared confirm prompt (`src/shared/page/confirm-prompt.ts`), so it draws as the
  `closeConfirm` part and fills no `drawBody`. No chat dialog opens the shared confirm prompt. The part draws into `dialog.body`; the app leaves `dialog.actions`
  empty, and the default layout draws the buttons in a `div.ui-dialog-actions` through `kit.actions`, so the look
  stays the same.
- The default layout draws today's DOM with today's class names, so `chat.css` needs no change.
- Kit scopes for `BaseKit`'s `keyHint` and `keysFor`: composer, bar and attachments `chat.chat`; picker rows the open
  request's scope (`chat.picker` or `chat.resume`); `signIn` `chat.signIn`; `reasonBox` `chat.reason`;
  `closeConfirm` `chat.confirm`; `imageViewer` `chat.image`.
- Every `[chat]` log line the self-test waits on stays as it is (`picker shown: <title>`, `picker closed: <title>`,
  `image viewer showing <n> of <count>`, `deny reason box shown for <tool>`, `sign-in link shown for <profile>`, …).

GIVEN a Chat tab with `hello` in its box in normal mode and two attached images WHEN the user saves the shown chat
layout's `layout.js` THEN the composer draws again, the box holds `hello` in normal mode, and two thumbnails show

GIVEN a user layout that defines only `composerBar`, and its builder throws WHEN a Chat tab draws THEN the bar draws
with `default`, the host logs the failure for part `composerBar`, and the composer frame and entries draw as before

GIVEN a user layout whose `composer` never calls `kit.box` WHEN a Chat tab draws THEN the box sits at the end of the
composer, and `i` focuses it

GIVEN a resting session WHEN its bar draws THEN every control chip is disabled

GIVEN the start prompt's Session step with `.` showing archived sessions WHEN the cursor is on an archived row THEN
that row ends in the `x restore` prompt and no other row has a prompt

GIVEN the sign-in dialog open with a code typed WHEN the chat layout reloads THEN the dialog stays open with the code
in its box and the link as before

Tests:
- `composer-input.test.ts` `composerInputOf_SessionStates_EnablesAndShowsWork` — one table: running and idle → chips
  enabled, `working` false; running and `working` activity → `working` true; running and `waiting` → `working` true;
  resting → chips disabled, `working` false; box focused in insert → `modeLabel` `INSERT`, unfocused → `PAGE`.
  Catches chips enabled on a resting session and a running indicator shown while idle.
- `composer-input.test.ts` `chipKeyCommands_Controls_KeysOnFirstChipPerCommand` — controls `mode`, `sandbox`,
  `effort`, `verbosity` → `pickMode`, `pickControl`, `pickEffort`, `null`. Catches the keys of `pickControl` set on
  two chips (one anchor element moved between them) or on none.
- `picker-row.test.ts` `rowInput_EachList_MapsItsFields` — one table, a row per input variant: a recent folder, the
  choose line, a profile, the new-session line, a past session archived, a control, a choice that is the current
  value and one that is not. Catches a dropped `archived` flag and a wrong current choice.
- `read-chat-layout.test.ts` — add rows to the test that owns the reader's rule: a layout with only `entries` reads;
  a layout whose `composer` is a string throws naming `composer`. Catches the new parts made required, which would
  refuse every user layout written before them.
- `composer-kit.test.ts` `composerParts_PieceLeftOutOrPlacedTwice_KeysStillReachTheBox` — one `it.each` table: a
  user `composer` that never calls `kit.box` (the box ends the part's element, and it is the same editor element); a
  user `signIn` that calls neither `codeBox` nor `actions` (both end the part's element); a user `composer` that calls
  `kit.box` twice (the part draws with `default`, and the log names `box placed twice`). Catches a user layout that
  hides a box from the keys, or mounts it twice.
- `composer-kit.test.ts` `composerBar_Redraw_LeavesOneAnchorPerHint` — a recording `anchor` double. A user
  `composerBar` that calls `kit.keyHint` draws three times (three state changes). Asserts one live anchor for that
  hint, and that the kit's Send anchor was made once. Catches a bar redraw that leaks an anchor on each state change.
- `layout.test.ts` — rows over the default's new parts with the fake kit the file already builds:
  `composer_Default_PlacesEachSlotOnce` (box, attachments slot, bar slot, one call each);
  `composerBar_Default_ChipsInControlOrderThenRunningThenSend`; `pickerRow_Default_PlacesCursorEnd`;
  `signIn_Default_PlacesCopyCodeBoxAndActions`; `imageViewer_Default_UpdateMovesCounterAndHidesItForOne`. Catches a
  default that drops a slot or a key-bearing part.

Done when: `npm run lint` passes (layers and styles) and the code compiles; the test gate runs the tests above;
`npm run selftest` passes every chat group with no `[keys] unplaced` line. The look of each surface under `default`
and under a user layout is checked live in task 17 (Final verification).

Commit: one commit for the group, naming each surface that now draws through the chat layout.

## Proof

