# 09 — Chat tab

Status: done
Type: Task
Wave: 4 · Depends on: 02, 04, 05, 07, 08
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/ids.ts` · create `src/plugins/chat/page/start.ts` ·
           create `src/plugins/chat/page/chat-view.ts` · create `src/plugins/chat/page/entry-list.ts` ·
           create `src/plugins/chat/page/chat-kit.ts` · create `src/plugins/chat/page/read-chat-layout.ts` ·
           create `src/plugins/chat/page/chat-state.ts` · create `src/plugins/chat/page/entry-focus.ts` ·
           create `src/plugins/chat/page/picker.ts` · create `src/plugins/chat/page/picker-state.ts` ·
           create `src/plugins/chat/page/chat-dialogs.ts` · create `src/plugins/chat/page/chat-commands.ts` ·
           create `src/plugins/chat/page/chat.css` · create `src/shared/page/markdown.css` ·
           modify `src/plugins/chat/manifest.ts` · modify `src/plugins/page.ts` ·
           modify `src/plugins/forms/page/forms.css` · modify `src/plugins/forms/page/start.ts` ·
           modify `src/contracts/editor.ts` · modify `src/renderer/codemirror-vim/codemirror-vim-host.ts` ·
           modify `src/shared/chord-notation.ts` · modify `src/renderer/key-sequences.ts` ·
           modify `src/contracts/keymap.ts` ·
           modify `src/plugins/forms/page/editor-boxes.test.ts` · modify `src/plugins/forms/page/forms-commands.test.ts` ·
           test `src/plugins/chat/page/chat-state.test.ts` · test `src/plugins/chat/page/entry-focus.test.ts` ·
           test `src/plugins/chat/page/picker-state.test.ts` · test `src/plugins/chat/page/read-chat-layout.test.ts` ·
           test `src/shared/chord-notation.test.ts` · test `src/renderer/key-sequences.test.ts`

Consumes:
- `ChatChannel`, `ChatSessionState`, `PermissionAnswer`, `ChatProfile` in `src/plugins/chat/contract.ts` ← 07
  (`recentFolders`, `chooseFolder`, `layout`, `cycleLayout`, `copyLayout` return promises; `ChatSessionState` has no
  `ended` field; an ended session's `sessionEnded` arrives before its row drops; permission entries carry ids
  `permission-<n>`; `activity` reads `waiting` while a permission is pending and arrives only on change; the harness
  emits each `user` entry, so the page adds none)
- `chatManifest` in `src/plugins/chat/manifest.ts` ← 07 (`commands: {}`, `scopes: {}`, empty keys, settings
  `{ profiles }`)
- `ChatEntry`, `ChatEntryKind`, `SessionControl`, `ProcessActivity` in `src/contracts/agent.ts` ← 05
- `ChatLayout`, `ChatKit`, `EntryKind`, `EntryInput<K>`, `EntryView<K>` in `src/plugins/chat/layouts/layout.d.ts` and
  the default export of `src/plugins/chat/layouts/default/layout.js` ← 08, with 08's CSS class table
- `createLayoutLoader<L>(deps: LayoutLoaderDeps<L>)`, `LayoutLoader<L>`, `showLayouts<L>(deps: ShowLayoutsDeps<L>)`
  (with `logSource` and `dataFolderLabel`) in `src/shared/page/layout-loader.ts` ← 02; `LayoutChoice` in
  `src/contracts/layouts.ts` ← 02
- `SessionTabHandle` as task 04 leaves it (`setStatus`, `select`, `remove`, `isVisible`, `takeOver`) ← 04;
  `SessionsPageExports.addTab`, `.activate`, `.closeSession`, `SessionsPageEvents.sessionRemoved` in
  `src/plugins/sessions/contract.ts` (tree)
- `KeysPageExports.keysFor` in `src/plugins/keys/contract.ts` (tree)
- In the tree: `PageApi`, `PagePart`, `PushedScope`, `PluginAreas`, `QualifiedEvents`, `ToastTone`,
  `PageCommandContext` (`src/contracts/plugin.ts`); `EditorHost`, `TextEditor`, `FocusOptions`, `VimMode`
  (`src/contracts/editor.ts`); `element`, `button`, `appendKeys`, `markdownElement` (`src/shared/page/dom.ts`);
  `src/shared/page/dialog.css` (`.overlay`, `.dialog`, `.dialog-title`, `.dialog-text`, `.dialog-actions`, `.button*`,
  `.key-hint`); `qualify` (`src/shared/plugin-manifests.ts`); `errorText` (`src/shared/error-text.ts`)

Produces:
- `src/plugins/chat/ids.ts`, patterned on `src/plugins/forms/ids.ts`:
  `export type ChatCommandName = keyof typeof chatManifest.commands;`
  `export type ChatScopeName = keyof typeof chatManifest.scopes & string;`
  `export function chatCommand(short: ChatCommandName): CommandId` · `export function chatScope(short: ChatScopeName): ViewScope`
- `src/plugins/chat/page/picker.ts` — the picker task 10 consumes:
  ```ts
  export interface PickerRequest<T> {
    title: string;                 // the dialog's heading and the name its log lines carry
    items: readonly T[];
    label(item: T): string;        // the line drawn and filtered on
    selected?: number;             // the item index highlighted on open; 0 when left out or out of range
    picked(item: T): void;         // runs once the picker has closed
  }
  export interface Picker {
    open<T>(request: PickerRequest<T>): void;   // replaces the open request, if any
    isOpen(): boolean;
    down(): void; up(): void; pick(): void; close(): void; focusFilter(): void; leaveFilter(): void;
  }
  export interface PickerDeps {
    overlay: PluginAreas['overlay'];
    editor: EditorHost;
    pushScope(): PushedScope;      // pushes `chat.picker`
    log: Log;
  }
  export function createPicker(deps: PickerDeps): Picker;
  ```
- `src/plugins/chat/page/picker-state.ts`:
  `export interface PickerState { labels: readonly string[]; filter: string; cursor: number }` (`cursor` is an index
  into `labels`, −1 when nothing is visible) · `export function openPicker(labels: readonly string[], selected: number): PickerState`
  · `export function visibleIndexes(state: PickerState): number[]` · `export function movePicker(state: PickerState, step: 1 | -1): PickerState`
  · `export function filterPicker(state: PickerState, filter: string): PickerState`
- `src/plugins/chat/page/chat-view.ts`:
  ```ts
  export interface ChatView {
    // Shows the session's Chat tab: activates the session (Sessions mode shows), selects the tab, and focuses
    // its box in insert mode with the cursor at the end the next time the tab is the visible tab (at once when it
    // is). A session with no Chat tab yet gets this the moment its tab is added.
    reveal(sessionId: string): void;
    visibleSessionId(): string | null;   // the session whose Chat tab is the visible tab
    setLayout(layout: ChatLayout, name: string): void;
  }
  export function mountChatView(deps: ChatViewDeps): ChatView;
  ```
- `src/plugins/chat/page/start.ts`: `export const chatPagePart: PagePart<typeof chatManifest>`; returns
  `{ commands }`, no exports. `src/plugins/page.ts`: `chatPagePart` joins last (`[sessionsPagePart, formsPagePart,
  keysPagePart, chatPagePart]`).
- `src/plugins/chat/page/chat-state.ts`:
  `export function applyEntry(entries: readonly ChatEntry[], entry: ChatEntry): { entries: ChatEntry[]; added: boolean }`
  · `export function oldestPendingPermission(entries: readonly ChatEntry[]): Extract<ChatEntry, { kind: 'permission' }> | null`
  · `export function tabStatus(activity: ProcessActivity): string` · `export function controlText(control: SessionControl): string`
  · `export function valueLabel(control: SessionControl): string`
  · `export function changedControls(before: readonly SessionControl[], after: readonly SessionControl[]): SessionControl[]`
  · `export function folderName(projectDir: string): string`
- `src/plugins/chat/page/entry-focus.ts`:
  `export interface EntryFocus { entryId: string | null; following: boolean }` · `export const START_FOCUS: EntryFocus`
  (`{ entryId: null, following: true }`) · `export function moveFocus(focus: EntryFocus, ids: readonly string[], step: 1 | -1): EntryFocus`
  · `export function focusLatest(ids: readonly string[]): EntryFocus` · `export function focusAfterChange(focus: EntryFocus, ids: readonly string[]): EntryFocus`
- `src/plugins/chat/page/read-chat-layout.ts`: `export const ENTRY_KINDS: readonly ChatEntryKind[]` (built from a
  `Record<ChatEntryKind, true>`, so the compiler flags a kind left out) · `export function readChatLayout(module:
  unknown, name: string): ChatLayout` · the compile-time checks below.
- `src/contracts/editor.ts`: `FocusOptions` gains `insert?: boolean` (`` `insert` focuses in insert mode with the
  cursor where it was, as vim's `i` does ``; `insertAtEnd` wins when both are set); `TextEditor` gains
  `setText(text: string): void` (`` Replaces the whole text, keeping focus and the vim mode; it reports no
  `changed`. ``).
- `src/shared/chord-notation.ts`: a chord's key is one lowercase letter, one digit, or `Enter`; `CHORD_NOTATION_RULE`
  reads `write modifiers C-, A-, S-, D- in that order, at least one of C-, A-, D-, then one lowercase letter, one
  digit, or Enter`. `src/renderer/key-sequences.ts`: an `Enter` chord matches code `Enter`. `src/contracts/keymap.ts`:
  the `PageBind` chord comment (line ~40) reads `C-, A-, D-, + one lowercase letter, one digit, or Enter + `>`, e.g.
  `<C-h>` or `<D-Enter>``, matching the widened rule.
- `src/shared/page/markdown.css`: the markdown rules moved whole from `forms.css`.

Decisions:
- **Manifest additions** (`src/plugins/chat/manifest.ts`; every command `runsIn: 'page'`), command → label · group:
  `focusBox` type a message · box; `appendBox` type after the message · box; `leaveBox` leave the box · box; `send`
  send the message · box; `interrupt` interrupt the turn · chat; `nextEntry` next entry · entries; `prevEntry`
  previous entry · entries; `toggleEntry` expand or collapse the entry · entries; `latestEntry` latest entry ·
  entries; `allowPermission` allow the tool · permissions; `denyPermission` deny the tool, with a reason ·
  permissions; `submitReason` send the denial · permissions; `cancelReason` back to the chat · permissions;
  `pickMode` permission mode · controls; `pickEffort` effort · controls; `pickModel` model · controls; `pickControl`
  every control · controls; `endSession` yes, end the session · confirm; `keepSession` keep the session · confirm;
  `pickerDown` next line · picker; `pickerUp` previous line · picker; `pickerPick` pick · picker; `pickerClose` close
  · picker; `pickerFilter` filter · picker; `pickerList` back to the list · picker; `nextLayout` next chat layout ·
  debug; `prevLayout` previous chat layout · debug; `copyLayout` copy the chat layout to a new folder · debug.
  Scopes: `chat: 'In the chat'`, `picker: 'In a picker'`, `reason: 'In the deny reason box'`, `confirm: 'In the
  end-session confirmation'`.
- **Keys** (page binds as `keys` arrays; editor binds as vim strings):

  | Scope | Page | Editor |
  |---|---|---|
  | `chat` | `i` focusBox · `a` appendBox · `j` nextEntry · `k` prevEntry · `Enter` toggleEntry · `G` latestEntry · `y` allowPermission · `n` denyPermission · `<C-c>` interrupt · `<D-Enter>` send · `' ' c m` pickMode · `' ' c e` pickEffort · `' ' c o` pickModel · `' ' c c` pickControl | `<CR>` send · `<Esc>` leaveBox · `<Leader>cm` pickMode · `<Leader>ce` pickEffort · `<Leader>co` pickModel · `<Leader>cc` pickControl |
  | `picker` | `j` pickerDown · `k` pickerUp · `Enter` pickerPick · `Escape` pickerClose · `/` pickerFilter | `<CR>` pickerPick · `<Esc>` pickerList |
  | `reason` | `<D-Enter>` submitReason · `Escape` cancelReason | `<CR>` submitReason · `<Esc>` cancelReason |
  | `confirm` | `y` endSession · `n` keepSession · `Escape` keepSession | — |
  | `any` | `' ' z c n` nextLayout · `' ' z c p` prevLayout · `' ' z c c` copyLayout | — |

  Vim's editor binds are normal-mode maps, so `<CR>` sends only in normal mode and Enter in insert mode adds a line;
  `<Esc>` in insert mode returns to normal mode as vim does, and the next `<Esc>` runs the bind. A normal-mode
  `<CR>` in a forms box now logs `<CR> has no bind in forms.forms` instead of moving down a line (vim keeps one map
  per key sequence for every editor): accepted, as forms' `<Esc>` already is.
- **Key clash check**, run at plan time against every manifest (`grep -n "keys:" -A40
  src/plugins/*/manifest.ts`, measured at plan time, re-verify) and repeated at startup by the page's
  bound-twice-in-a-scope check and `requireUnambiguousEditorBinds`: the `any` page binds are sessions' `' ' k s`,
  `<A-S-o>`, `<A-S-i>`, `<A-o>`, `<A-i>`, `<D-w>`, `' ' ;`, keys' `' ' ?`, forms' `' ' z l n|p|c|o`; the `any`
  editor binds are `<Leader>ks`, `<Leader>;`, `<Leader>?`. None equals or begins a chat bind, and no chat bind
  begins one of them (`' ' z c …` beside `' ' z l …`, `' ' c …` beside nothing). Chat's own scopes hold no bind twice.
  Editor `<Esc>` and `<CR>` repeat only across distinct scopes (`forms.forms`, `forms.review`, `chat.chat`,
  `chat.picker`, `chat.reason`), which `scopesOverlap` allows. No `<Leader>c` bind exists to begin `<Leader>cm`.
  Task 10's `' ' k n` / `<Leader>kn` (scope `any`) sit beside `' ' k s` / `<Leader>ks` and begin nothing.
- **`<D-Enter>` needs the chord notation widened**: today's `CHORD_NOTATION` (`/^<(C-)?(A-)?(S-)?(D-)?([a-z0-9])>$/`
  in `src/shared/chord-notation.ts`) rejects it and `createChordMatcher` throws at startup. The key group becomes
  `([a-z0-9]|Enter)`; `toParsedChord` maps `Enter` to code `Enter`. `src/main/selftest.ts` `pressChord` already sends
  `keyCode: chord.key`, which Electron reads as the Enter key, so it needs no edit.
- **Box focus**: `i` focuses the box with `{ insert: true }`, `a` with `{ insertAtEnd: true }`. The CodeMirror host
  enters insert mode for `insert` through `Vim.handleEx(cm, 'startinsert')` when not already inserting (as
  `insertAtEnd` uses `startinsert!`). `setText` dispatches one transaction replacing the document, tagged with a
  host-private annotation the `updateListener` skips when it reports `changed`. The two forms test fakes of
  `TextEditor` gain `setText: () => undefined`.
- **One Chat tab per chat session**, added through `addTab(sessionId, { id: 'chat', title: 'Chat', element,
  beforeClose, shown })` when `sessionStarted` arrives or, on load, for each state `sessions()` returns. Listeners
  first, then `sessions()`: a session already held is skipped, so `sessions()` answering after a `sessionStarted`
  changes nothing. An `entry`, `controls` or `activity` message for a session the page holds no tab for logs
  `<message> for unknown session <id> ignored` and is dropped (the `sessions()` answer that follows carries it).
  The page keeps each session's `ChatSessionState` and applies each message to it. `sessionRemoved` for a chat
  session drops its state, destroys its box editor and logs `session closed: <name>`.
- **Names in log lines**: `<name>` is `folderName(projectDir)`, the folder's last path segment (`/a/b/` → `b`),
  since sessions exports no row label. Every log line below is under source `chat`.
- **Tab element** (`div.chat-tab`, a grid of three rows): `ol.chat-entries` (scrolls, `overflow-y: auto`), then
  `div.chat-box` holding the session's editor from `services.editor.create(box, '', events)`, then
  `div.chat-controls`, the status line: `span.chat-box-mode` with the box's vim mode upper-cased (`NORMAL`,
  `INSERT`, `VISUAL LINE`; `PAGE` while the box has no focus) followed by one `span.chat-control` per control
  reading `controlText(control)`; it wraps (`flex-wrap: wrap`) at narrow widths.
- **Status line text**: `valueLabel(control)` is the label of the choice whose `value` equals `control.value`, else
  the raw value, else `unset` when `value` is null; `controlText` is `` `${label}: ${valueLabel}` ``. On each
  `controls` message the page redraws the line and logs `<label> is <valueLabel> in <name>` for each control
  `changedControls` returns (a control whose id is new or whose value differs from before; on the first `controls`
  message every control counts as changed).
- **Tab status** through the handle's `setStatus`, sent only when it changes: `tabStatus('working')` → `working`,
  `tabStatus('waiting')` → `waiting for permission`, `tabStatus('idle')` → `''`. Each `activity` message logs
  `<name> is <activity>`. After `sessionEnded` the status is `''`.
- **Entries list**, in `entry-list.ts`, one `li.chat-entry-slot` per entry in the state's order, the slot holding the
  layout's element; the slot (host-owned) carries `is-focused` for the focused entry. `applyEntry` replaces an
  entry with the same id in place (`added: false`) or appends (`added: true`). An added entry from an `entry`
  message logs `<kind> entry added in <name>`; entries drawn from `sessionStarted` or `sessions()` log nothing.
- **Building an entry**: `layout.entries[kind](entry, kit)` with a kit made for that entry (`chat-kit.ts`). When the
  builder throws, or returns no `HTMLElement` in `element`, the page logs `layout <layout name> <kind> entry
  failed: <errorText>` and builds the entry with the default layout and a fresh kit; the first such failure for a
  kind under each shown layout also toasts `error`: `Chat layout <layout name>: <kind> entries drawn with default`.
  A default layout that throws too is logged `default layout <kind> entry failed: <errorText>` and the slot shows a
  `div.chat-entry.chat-raw` with the entry's kind as text.
- **A replaced entry** (same id) runs the view's `update(entry)` when the view has one, after the kit's own parts
  updated; its first throw per entry logs `layout <layout name> <kind> entry update failed: <errorText>` and the
  element stays. A view with no `update` is built again (fallback rules as above) and its element replaces the old
  one in the slot, the new kit's expanders opening as the old kit's were, by creation order.
- **The kit** (`chat-kit.ts`, one per built entry): `markdown(text)` → `div.md` holding
  `services.markdown.block(text)` (`markdownElement`); `json(value)` → `pre.chat-json` whose `textContent` is
  `String(JSON.stringify(value, null, 2))`; `expander(summary, body)` → `div.chat-expander` holding a
  `button.chat-expander-line` (`dom.ts` `button`, text `summary`, a `▸`/`▾` marker) and, while open, the element
  `body()` returned; `body()` runs on each open, its element replacing the last; clicking the line toggles that
  expander. `permissionActions()` → `div.chat-permission-actions`: while the entry's `answer` is null an `Allow`
  button and a `Deny` button, each followed by `appendKeys(…, keysFor(chatCommand('allowPermission' |
  'denyPermission'), chatScope('chat')))`; clicking Allow answers this entry allowed, clicking Deny opens the reason
  box for this entry; once `answer` is set it shows `Allowed` or `Denied` (`Denied: <reason>` with a reason) in
  `span.chat-permission-answer`, redrawn by the kit's update before the view's. `permissionActions()` on an entry
  that is not a permission throws `permissionActions is only for a permission entry`.
- **Compile-time checks** in `read-chat-layout.ts`: a mapped type over `ChatEntryKind` whose member is `true` when
  `Extract<ChatEntry, { kind: K }>` extends `EntryInput<K>` and `never` otherwise, held by a constant every key of
  which is `true` (a drifted variant fails the build); and `[ChatEntryKind] extends [EntryKind]` and
  `[EntryKind] extends [ChatEntryKind]` both asserted the same way, so the two kind lists stay one set.
- **`readChatLayout(module, name)`**: the module's `default` must be an object (`layout <name>: the default export
  is missing or not an object`), with `entries` holding a function for each of `ENTRY_KINDS` in order (`layout
  <name>: entries.<kind> is missing or not a function`, naming the first missing). It is the loader's `read`.
- **Layouts**: `createLayoutLoader<ChatLayout>({ importModule: (url) => import(/* @vite-ignore */ url), dataUrl:
  (path, revision) => api.dataUrl(path, revision), defaultLayout, head: document.head, read: readChatLayout })`
  and `showLayouts<ChatLayout>({ channel: { onLayoutChanged: (listener) => api.channel.on('layoutChanged',
  listener), readLayout: () => api.channel.invoke('layout') }, loader, setLayout: (layout, name) =>
  view.setLayout(layout, name), log, logSource: 'chat', dataFolderLabel: "chat's data folder", toast })`, as forms'
  start does. `setLayout` rebuilds every held session's entries with the new layout, keeping each session's focus
  by entry id. `nextLayout` / `prevLayout` / `copyLayout` invoke `cycleLayout(1)`, `cycleLayout(-1)`,
  `copyLayout()`; a rejection logs `layout command failed: <errorText>` and toasts it as forms' `layoutCommand`.
- **Focus among entries** (`entry-focus.ts`): `moveFocus` from `entryId: null` goes to the last id for either
  step; otherwise one place by `step`, clamped at both ends; `following` is true exactly when the result is the
  last id. `focusLatest(ids)` is the last id with `following: true` (`START_FOCUS` with no ids).
  `focusAfterChange` keeps a following focus on the new last id, keeps a non-following focus whose id still
  exists, and falls back to `focusLatest` when the id is gone. Commands: `nextEntry`/`prevEntry` log `focused
  <kind> entry` (or `no entries in <name>`); `latestEntry` logs `following the latest entry`.
- **Scroll rule**: after any change to a session's entries, a following focus scrolls `ol.chat-entries` to its
  bottom (`scrollTop = scrollHeight`); a non-following focus scrolls nothing. `j`/`k` bring the focused slot into
  view (`scrollIntoView({ block: 'nearest' })`); `G` scrolls to the bottom.
- **`toggleEntry`** acts on the focused entry's expanders: when any is closed all open, else all close, logging
  `expanded <kind> entry` / `collapsed <kind> entry`; an entry with none logs `<kind> entry has nothing to expand`.
- **The session a command acts on**: the session of `context.editor` when the key fired in a chat box, else
  `visibleSessionId()`; with neither, the command logs `no Chat tab shown` and does nothing.
- **Send** (`send`, from `<CR>` in normal mode or `<D-Enter>` anywhere): text `editor.text()`; when `text.trim()`
  is empty it logs `nothing to send` and invokes nothing; after `sessionEnded` it logs `<name> has ended` and keeps
  the text; otherwise it invokes `send(sessionId, text)` with the text as typed, calls `setText('')` and logs `sent
  a message in <name>`. A rejected send logs `send failed: <errorText>` and toasts `Message not sent:
  <errorText>` (`error`); the box stays cleared.
- **`leaveBox`** blurs the box and logs `left the box`; **`focusBox`** / **`appendBox`** log `focused the box in
  <name>`.
- **`interrupt`**: with activity not `idle`, invokes `interrupt(sessionId)` and logs `interrupted <name>`; with
  `idle`, logs `nothing to interrupt in <name>`.
- **Permissions**: `allowPermission` / `denyPermission` act on `oldestPendingPermission(entries)` of the session —
  the first entry in state order of kind `permission` with `answer` null; with none they log `no pending permission
  in <name>`. Allow invokes `answerPermission(sessionId, entryId, { allowed: true, reason: null })` and logs `allowed
  <toolName> in <name>`. Deny opens the **reason box**: an overlay dialog (`div.overlay > div.dialog.chat-reason`,
  title `Deny <toolName>?`, text `Optional: tell Claude why. It reads your reason.`, an editor, and buttons `Deny`
  and `Back` with `keysFor` hints from scope `chat.reason`), pushes scope `reason`, focuses the editor with
  `{ insert: true }`, and logs `deny reason box shown for <toolName>`. `submitReason` invokes
  `answerPermission(…, { allowed: false, reason: text.trim() === '' ? null : text.trim() })`, closes the box (pop,
  `setText('')`, hidden) and logs `denied <toolName> in <name>`; `cancelReason` closes it sending nothing and logs
  `deny reason box closed`. The pushed scope's `onBaseChanged` closes it as `cancelReason` does. The page draws the
  answer only from chat main's replaced entry.
- **Controls**: `pickMode` / `pickEffort` / `pickModel` open the picker for control id `mode` / `effort` / `model`
  of the session (title the control's `label`, items its `choices`, label each choice's `label`, `selected` the
  index of the current value, 0 when none matches); a session whose controls lack the id logs `<name> has no <id>
  control`. `pickControl` opens a picker titled `Controls` of every control (`controlText` each), then the chosen
  control's choices picker; with no controls it logs `<name> has no controls`. A pick invokes `setControl(sessionId,
  id, value)` and logs `set <id> to <value> in <name>`; a rejection logs `setControl failed: <errorText>` and toasts
  `<errorText>` (`error`) — main's own message, such as the Claude adapter's `Claude is working; change <label> when
  the turn ends` (task 06). The status line changes only when chat main's `controls` message arrives.
- **The picker** (`picker.ts`, over `picker-state.ts`): one `div.overlay > div.dialog.chat-picker` contributed to the
  overlay at creation and hidden while closed, holding `h2.dialog-title` (the title), `div.chat-picker-filter` (an
  editor made once at creation) and `ol.chat-picker-list` (one `li.chat-picker-item` per visible item, the cursor's
  carrying `is-cursor`, kept in view). `open` blurs the focused element (so the list keys fire, a chat box
  included), clears the filter with `setText('')`, pushes scope `picker` (keeping the pushed scope when one is
  already open), shows the dialog and logs `picker shown: <title>`. `down`/`up` move the cursor; `pick` with a
  visible cursor closes the picker then runs `picked(item)`; with nothing visible it does nothing. `close` (Esc on
  the list) hides, pops and logs `picker closed: <title>`; the pushed scope's `onBaseChanged` closes it the same
  way. `focusFilter` (`/`) focuses the filter editor with `{ insertAtEnd: true }`; the editor's `changed` text
  becomes the filter; `leaveFilter` (`<Esc>` in normal mode) blurs it, the filter kept; `<CR>` in normal mode in the
  filter picks. Clicking an item picks it.
- **Picker state rules**: `openPicker(labels, selected)` sets `filter ''` and `cursor` = `selected` when in range,
  else 0, else −1 for no labels. `visibleIndexes` lists, in order, the indexes whose label contains the filter
  trimmed, compared lower-cased (an empty filter shows every label). `movePicker` moves the cursor to the next or
  previous visible index, clamped at the ends, and does nothing with none visible. `filterPicker` keeps the cursor
  when it stays visible, else moves it to the first visible index, else −1.
- **Close confirm** (`beforeClose` of the Chat tab): when the session's activity is not `idle`, no `sessionEnded`
  arrived, and the session's close was not confirmed, it selects the Chat tab, leaves any focused box, shows the
  confirm (`div.overlay > div.dialog.dialog-confirm`, role `alertdialog`, title `End this session?`, text `Claude is
  still working. Ending the session stops it.`, buttons `End the session` (`button button-danger`) and `Keep it
  running`, each with its `chat.confirm` keys via `keysFor`), pushes scope `confirm`, logs `closing the session asks
  to end <name>`, and returns false; otherwise true. `endSession` marks the close confirmed, hides the confirm,
  pops, and calls `sessions.closeSession(sessionId)` (whose `beforeClose` now returns true); `keepSession` hides,
  pops and logs `kept <name>`. The pushed scope's `onBaseChanged` hides it as `keepSession` does. Patterned on
  forms' cancel confirm (`buildConfirm` in `forms-view.ts`).
- **`shown`** of a Chat tab sets base scope `chat`, logs `Chat tab shown in <name>`, redraws the status line, and
  runs a waiting `reveal` focus.
- **`sessionEnded`**: logs `<name> ended`, or `<name> ended: <error>` and toasts `<name> ended: <error>` (`error`)
  when `error` is non-null; the tab stays until the row drops.
- **Markdown styles**: the `/* Markdown (class names from markdown-it-renderer.ts) */` block, from that comment to
  the end of `src/plugins/forms/page/forms.css` (lines 672–883, measured at plan time, re-verify), moves unchanged
  to `src/shared/page/markdown.css`; `src/plugins/forms/page/start.ts` and `src/plugins/chat/page/start.ts` each
  import `'../../../shared/page/markdown.css'` after `dialog.css`.
- **`chat.css`** draws 08's classes and this task's own (`chat-tab`, `chat-entries`, `chat-entry-slot`,
  `is-focused`, `chat-box`, `chat-controls`, `chat-box-mode`, `chat-control`, `chat-json`, `chat-expander*`,
  `chat-permission-actions`, `chat-permission-answer`, `chat-picker*`, `chat-reason`) from theme variables only
  (`var(--wg-…)`, as `forms.css` and `dialog.css` do); `.chat-json` and `.chat-tool-result` scroll in their own box
  (`overflow-x: auto`), and every text block wraps (`overflow-wrap: anywhere`), so the self-test's fit check passes.
- Page imports stay inside the boundary rules: chat's page imports `src/contracts`, `src/shared` (`page/` included),
  chat's own folder, and `../../sessions/contract` and `../../keys/contract` only.

GIVEN entries `[a, b]` WHEN `applyEntry` gets `a'` (id `a`) THEN it returns `[a', b]` and `added: false`; GIVEN `c` THEN
`[a, b, c]` and `added: true`
GIVEN entries user `u`, permission `permission-1` answered, permission `permission-2` pending, permission `permission-3`
pending WHEN `oldestPendingPermission` runs THEN it returns `permission-2`; GIVEN no pending one THEN null
GIVEN activity `working` / `waiting` / `idle` WHEN `tabStatus` runs THEN `working` / `waiting for permission` / `''`
GIVEN control Effort with choices Low `low` / High `high` and value `high` WHEN `controlText` runs THEN `Effort: High`;
GIVEN value `max` THEN `Effort: max`; GIVEN value null THEN `Effort: unset`
GIVEN before `[mode auto, effort medium]` and after `[mode auto, effort high, model opus]` WHEN `changedControls` runs
THEN it returns `[effort high, model opus]`; GIVEN before `[]` THEN every control of after
GIVEN `/Users/u/dev/app/` WHEN `folderName` runs THEN `app`
GIVEN ids `[a, b, c]` and `START_FOCUS` WHEN `moveFocus(…, -1)` THEN `{ entryId: 'c', following: true }`; from `c` with -1
THEN `{ b, following: false }`; from `a` with -1 THEN `{ a, false }`; from `b` with 1 THEN `{ c, true }`; from `c` with 1
THEN `{ c, true }`
GIVEN focus `{ c, true }` WHEN ids become `[a, b, c, d]` THEN `focusAfterChange` gives `{ d, true }`; GIVEN `{ b, false }`
THEN `{ b, false }`; GIVEN `{ x, false }` with `x` gone THEN `{ d, true }`; GIVEN no ids THEN `START_FOCUS`
GIVEN labels `['~/dev/app', '~/dev/api', 'Choose folder…']` WHEN `openPicker(labels, 1)` THEN cursor 1, filter `''`;
`openPicker(labels, 7)` THEN cursor 0; `openPicker([], 0)` THEN cursor −1
GIVEN that state WHEN `filterPicker(…, ' AP ')` THEN visible `[0, 1]` and cursor 1 kept; `filterPicker(…, 'choose')` THEN
visible `[2]`, cursor 2; `filterPicker(…, 'zzz')` THEN visible `[]`, cursor −1
GIVEN filter `ap` and cursor 0 WHEN `movePicker(…, 1)` twice THEN cursor 1 both times; `movePicker(…, -1)` from 0 THEN 0;
GIVEN nothing visible THEN the state is returned unchanged
GIVEN a module whose default has `entries` with every kind but `tool` WHEN `readChatLayout(module, 'mine')` THEN it throws
`layout mine: entries.tool is missing or not a function`; GIVEN `{ default: 3 }` THEN `layout mine: the default export
is missing or not an object`; GIVEN every kind a function THEN it returns the default export
GIVEN `<D-Enter>` WHEN `parseChord` runs THEN `{ ctrl: false, alt: false, shift: false, meta: true, key: 'Enter' }`;
GIVEN `<D-enter>` or `<D-Tab>` THEN null
GIVEN a page bind `<D-Enter>` in scope `chat.chat` WHEN the chord matcher sees code `Enter` with only Meta held in that
scope THEN it returns the bind; with Ctrl also held THEN undefined
GIVEN the self-test WHEN chat's script runs (task 11) THEN the Chat tab, send, the box, the entries' focus and
expanders, `y`, `<C-c>`, the effort picker and the close confirm each log their pinned line

Tests:
- `chat-state.test.ts` — `applyEntry_SameIdReplacesInPlace`, `applyEntry_NewIdAppends`,
  `oldestPendingPermission_FirstUnansweredInOrder`, `oldestPendingPermission_NonePending_Null`,
  `tabStatus_EachActivity`, `controlText_ChoiceLabelRawValueOrUnset`, `changedControls_NewOrChangedOnly`,
  `changedControls_NothingBefore_All`, `folderName_LastSegmentTrailingSlashIgnored` — values above, each entry and
  control built in the test.
- `entry-focus.test.ts` — `moveFocus_FromNothing_Latest`, `moveFocus_UpLeavesFollowing`, `moveFocus_ClampsAtBothEnds`,
  `moveFocus_DownOntoLast_Follows`, `focusAfterChange_FollowingMovesToNewLast`, `focusAfterChange_NotFollowing_Stays`,
  `focusAfterChange_GoneId_Latest`, `focusAfterChange_NoIds_Start`.
- `picker-state.test.ts` — `openPicker_SelectedInRange`, `openPicker_SelectedOutOfRange_First`,
  `openPicker_NoLabels_NoCursor`, `filterPicker_CaseInsensitiveTrimmedSubstring`, `filterPicker_KeepsVisibleCursor`,
  `filterPicker_MovesHiddenCursorToFirst`, `filterPicker_NothingVisible_NoCursor`, `movePicker_StepsOverVisibleOnly`,
  `movePicker_ClampsAtEnds`, `movePicker_NothingVisible_Unchanged`.
- `read-chat-layout.test.ts` — `readChatLayout_MissingKind_ThrowsNamingIt`, `readChatLayout_NotAnObject_Throws`,
  `readChatLayout_EveryKind_ReturnsTheDefaultExport`, `ENTRY_KINDS_HoldsEveryKindOnce` (asserts the set
  `user assistant thinking tool permission result notice raw`). The variant-to-input checks are the typecheck's.
- `chord-notation.test.ts` gains `parseChord_EnterKey` and `parseChord_OtherNamedKeys_Rejected`;
  `key-sequences.test.ts` gains `matches an Enter chord on code Enter` beside the digit case.
- The DOM, the kit, the picker overlay, the dialogs and the keys run in task 11's self-test steps; the look is
  the final verification's checks 2–4, 7 and 12.

Done when: the typecheck and `npm run lint` pass; `npm run selftest` still passes forms' script; the test gate runs
the tests above.
Commit:    one commit for the group

## Proof

80edb99 · diff read: `ids.ts` and the page modules are present; `picker.ts` exports `PickerRequest`; the core edits are in (`FocusOptions.insert`, `TextEditor.setText`, chords naming Enter, `markdown.css`); typecheck and lint pass. Contract changes: `mountChatView` returns `ChatTabs extends ChatView` (`session`, `sessionOfEditor`); `ChatViewDeps` landed as listed in the Run log; `setText` tags its edit with user event `wigley.setText` (no direct `@codemirror/state` dependency). Ruling: `modeLabel` moved to `src/shared/vim-mode-label.ts`, and forms re-exports it. Concerns: raw entries are noise for j/k; whether Cmd+Enter also fires the Enter bind is unverified (task 11); the selftest flake also shows on an archive of 380800b.
