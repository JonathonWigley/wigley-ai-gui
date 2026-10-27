# 06 — Chat

Status: done
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

**Contents**

- **Intent** — what this task lands.
- **Fields** — Files, Consumes, Produces, Decisions, Binds and anchors, behaviour, Tests, Done when, Commit.
- **Proof** — written by `wigley:make`.

## Intent

Every chat key shows on the thing it acts on: the composer, its chips and Send, the running
indicator, the permission card, the dialogs and the pickers. Chat stops reading `keysFor` and drawing
Kbd itself; it names anchors, and the keys plugin draws them. After this task no file under
`src/plugins/chat/` imports `src/plugins/chat/page/key-hint.ts`, so this task deletes it.

## Fields

Files:     modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/chat-kit.ts` ·
           modify `src/plugins/chat/page/chat-dialogs.ts` · modify `src/plugins/chat/page/sign-in-dialog.ts` ·
           modify `src/plugins/chat/page/picker.ts` · modify `src/plugins/chat/page/start-prompt.ts` ·
           modify `src/plugins/chat/page/resume-items.ts` · test `src/plugins/chat/page/resume-items.test.ts` ·
           modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/page/chat.css` ·
           modify `src/plugins/chat/layouts/layout.d.ts` (the `permissionActions` comment only) ·
           delete `src/plugins/chat/page/key-hint.ts` (once its last import goes)

Consumes:  `KeysPageExports.anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable` ← 01
           `AnchorOptions { scope?: ViewScope; where?: HintWhere; label?: boolean | string }` ← 01
           the `is-hint-hidden` class the keys plugin sets on a hidden anchor ← 01
           `headerEnd?: HTMLElement | null` and `cursorEnd?(item: T): HTMLElement | null` on
           `ListPickerRequest<T>` in `src/shared/page/list-picker.ts` ← 01
           existing: `chatCommand`, `chatScope`, `ChatCommandName`, `ChatScopeName` (`src/plugins/chat/ids.ts`),
           `textButton` (`hint` option), `chip`, `statusDot` (`src/shared/page/ui/`)

Produces:  in `src/plugins/chat/page/resume-items.ts`:
           `export type ArchiveState = 'live' | 'archived';`
           `export function archiveStateOf(item: SessionItem): ArchiveState | null;` — null for the new-session line
           in `src/plugins/chat/page/picker.ts`:
           `PickerRequest<T>.archiveState?(item: T): ArchiveState | null;` — the session step's `x` prompt per row
           `PickerDeps.keys: Pick<KeysPageExports, 'anchor'>;`
           in `src/plugins/chat/page/chat-kit.ts`: `KitDeps.keys: Pick<KeysPageExports, 'anchor'>;` (was `'keysFor' | 'onChanged'`)
           in `src/plugins/chat/page/chat-dialogs.ts`: `DialogDeps.keys: Pick<KeysPageExports, 'anchor'>;`
           `export function drawDialogActions(dialog: Dialog, actions: readonly DialogAction[], deps: Pick<DialogDeps, 'keys' | 'run'>): void;`
           (replaces `followKeymap`; `DialogDeps.platform` is removed)
           in `src/plugins/chat/page/chat-view.ts`: `ChatViewDeps.keys: Pick<KeysPageExports, 'anchor'>;`
           (`ChatViewDeps.platform` is removed when nothing else reads it; `HeldTab.keysChange` is removed)

Decisions: placements the user approved (interview 2026-10-27): the unfocused composer shows `i` to type;
           the running indicator shows `⌃C stop`; the mode, effort, model and controls chips show `m`, `e`, `o`
           and `c`; permission cards and Send keep their keys; in the resume list `x` archive is a cursor prompt,
           and `.` archived and `/ filter` sit in its header · each non-vim, non-leader bind gets an anchor on its
           own button, row or header (user) · vim's own keys need no anchor; a view may still anchor one (plan.md
           Decisions) · leader sequences are which-key's, so `<Leader>cm`, `ce`, `co`, `cc` and `cx` get no anchor
           (plan.md Decisions) · the Copy button keeps its `<Leader>cy` hint (`where: 'box'`): it shows that hint
           today, and this task moves no hint off the screen (drafter, plan time) · the layout kit keeps its shape:
           `ChatKit.permissionActions()` is unchanged, and the kit names anchors underneath (user) ·
           a hint's anchor element is made once and kept for the life of its owner (tab, dialog, picker, card);
           a redraw moves the element, it never names the anchor again (drafter: a keymap change already
           redraws every anchor, task 01) · the type hint carries `is-box-focused` while the tab's box has focus,
           and `chat.css` hides it with `visibility: hidden` then, since `i` and `a` are vim's inside the box
           (drafter) · the composer had no running indicator at plan time; this task adds one to the composer
           bar (drafter, concern C3) · the `x` prompt reads `archive` on a live row and `restore` on an archived
           row, and the new-session line has none (drafter: the user named `archive`; an archived row restores)
           · task 01's contract for wave 2: a command counts as placed once the page load named an anchor for
           it in its scope, a disposed anchor included, and the view puts nothing in an anchor element · `y` and
           `n` on a permission card count as placed once a card waits; the chat self-test's first session holds
           the fixture's pending permission from the start (`askFixturePermission`,
           `src/plugins/chat/main/selftest-script.ts`), so this task adds no anchor for a card that is not there

### Binds and anchors

Every scope chat owns, from `src/plugins/keymap.ts` (§ Chat and the `chat…Binds` helpers). "vim" means
the keys are on vim's list (plan.md Decisions) and need no anchor.

| Scope | Keys | Command | Anchor: element, options |
|---|---|---|---|
| `chat.chat` | `i` | `chat.focusBox` | type hint in the composer bar; `{ scope: 'chat.chat', label: 'to type' }` |
| `chat.chat` | `a` | `chat.appendBox` | type hint in the composer bar; `{ scope: 'chat.chat', label: 'to append' }` |
| `chat.chat` | `<D-Enter>` | `chat.send` | inside Send (control hint); `{ scope: 'chat.chat' }` |
| `chat.chat` | `<C-c>` | `chat.interrupt` | running indicator; `{ scope: 'chat.chat', label: 'stop' }` |
| `chat.chat` | `m` `e` `o` `c` | `chat.pickMode` `pickEffort` `pickModel` `pickControl` | inside the control chip whose `controlCommand(control.id)` it is (the first such chip for `pickControl`); `{ scope: 'chat.chat' }` |
| `chat.chat` | `y` / `n` | `chat.allowPermission` / `chat.denyPermission` | inside Allow once / Deny (control hint); `{ scope: 'chat.chat' }` |
| `chat.chat` | `j k <CR> G gg <C-j> <C-k> <C-S-j> <C-S-k>` | entry and scroll commands | vim |
| `chat.chat` box | `<CR>` `<Esc>` | `chat.send` `chat.leaveBox` | vim |
| `chat.chat` box | `<Leader>cx` `cm` `ce` `co` `cc` | | leader |
| `chat.ended` | `i` / `a` | `chat.focusBox` / `chat.appendBox` | the same type hint; `{ scope: 'chat.ended', label: … }` as above |
| `chat.ended` | `<D-Enter>` | `chat.send` | inside Send; `{ scope: 'chat.ended' }` |
| `chat.ended` | the rest | | vim or leader, as in `chat.chat` |
| `chat.picker` | `/` | `chat.pickerFilter` | picker header end (box hint); `{ scope: 'chat.picker', label: 'filter' }` |
| `chat.picker` | `j k <CR> <Esc>`, box `<CR> <Esc>` | | vim |
| `chat.resume` | `/` | `chat.pickerFilter` | picker header end; `{ scope: 'chat.resume', label: 'filter' }` |
| `chat.resume` | `.` | `chat.showArchived` | picker header end, after `/ filter`; `{ scope: 'chat.resume', label: 'archived' }` |
| `chat.resume` | `x` | `chat.toggleArchive` | cursor row's trailing end (cursor prompt); `{ scope: 'chat.resume', label: 'archive' }` on a live row, `label: 'restore'` on an archived row |
| `chat.resume` | `j k <CR> <Esc>`, box `<CR> <Esc>` | | vim |
| `chat.reason` | `<D-Enter>` | `chat.submitReason` | inside Deny; `{ scope: 'chat.reason' }` |
| `chat.reason` | `<Esc>` | `chat.cancelReason` | vim; inside Back as today; `{ scope: 'chat.reason' }` |
| `chat.signIn` | `<D-Enter>` | `chat.submitCode` | inside Send code; `{ scope: 'chat.signIn' }` |
| `chat.signIn` | `<Esc>` | `chat.cancelSignIn` | vim; inside Cancel as today; `{ scope: 'chat.signIn' }` |
| `chat.signIn` box | `<Leader>cy` | `chat.copySignInLink` | inside Copy as today; `{ scope: 'chat.signIn', where: 'box' }` |
| `chat.confirm` | `y` | `chat.endSession` | inside End the session; `{ scope: 'chat.confirm' }` |
| `chat.confirm` | `n` | `chat.keepSession` | inside Keep it running; `{ scope: 'chat.confirm' }` |
| `chat.image` | `h l <Esc>` | `chat.prevImage` `nextImage` `closeImage` | vim; no anchor |

### What changes, by file

- `chat-view.ts`, `buildComposerBar`: the bar draws, in order, the mode label, the type hint, the running
  indicator, the chips, and Send. The type hint (`span.chat-type-hint`) holds two anchor elements, `i` and
  `a`. The running indicator (`span.chat-running`) holds a running StatusDot and the `chat.interrupt` anchor
  element; it has `hidden` while the tab's activity is `idle` or the session has ended. Send is built once
  per tab; `draw` sets only its `disabled` state. The type hint, Send and running anchors are named once per
  tab with the tab's scope (`chatScope(tabScope(tab))`); when the session ends, the view disposes the type
  hint and Send anchors and names them again with `chat.ended`, in the `sessionEnded` handler that sets the
  scope. The four chip anchors (`chat.pickMode`, `pickEffort`, `pickModel`, `pickControl`) are also named
  once per tab, at creation, so a chip redraw moves an element and never names an anchor again. `draw` appends each chip's command's anchor element to that chip; when
  more than one chip runs `chat.pickControl`, the first one takes its element; an element with no chip
  stays detached and live, so a later chip takes it. The chat fixture's Controls picker step (`c`) shows a
  control chip exists in the self-test; confirm a chip runs `chat.pickControl` there, or report a concern. The `activity` message handler now
  also updates the running indicator. `onSessionRemoved` disposes every anchor of the tab in place of
  `keysChange`.
- `chat-kit.ts`: `drawPermissionActions` builds Allow once and Deny once per unanswered entry, each with an
  anchor element as its `hint`. When the answer arrives, the kit disposes those two anchors and draws the
  answer text. `EntryKit.dispose` disposes any anchors still held. The `keysChange` follow is removed.
- `chat-dialogs.ts`: `drawDialogActions` builds each action's button once, with an anchor element as its
  `hint`, and is called once per dialog. `followKeymap` and the `onChanged` follow are removed.
  `createReasonBox` and `createCloseConfirm` call `drawDialogActions`.
- `sign-in-dialog.ts`: calls `drawDialogActions`. The Copy button is built once; `showLink` sets its
  `disabled` state; its `onChanged` redraw is removed.
- `picker.ts`: `createPicker` makes three header anchor elements once — `/ filter` for `chat.picker`,
  `/ filter` and `. archived` for `chat.resume` — and two cursor anchor elements for `chat.resume`,
  `x archive` and `x restore`. `open` hands `list.open` the header element of the request's scope as
  `headerEnd`, and, for the `resume` scope, a `cursorEnd` that maps `request.archiveState(item)` to the
  `archive` element, the `restore` element, or null.
- `start-prompt.ts`: `openSessionStep` passes `archiveState: archiveStateOf` in its request.
- `resume-items.ts`: adds `ArchiveState` and `archiveStateOf`.
- `start.ts`: hands `keys` to `createPicker`, and stops handing `platform` to every dep that no longer reads it.
- `chat.css`: styles `.chat-type-hint` (hidden with `visibility: hidden` under `.is-box-focused`),
  `.chat-running`, and the anchor elements inside a chip, with existing tokens only.
- `layout.d.ts`: the `permissionActions` comment says the keys come from the keys plugin's anchors, not
  from `keysFor`.

GIVEN a Chat tab whose box has no focus WHEN the tab shows THEN the composer bar shows `i to type` and
`a to append` after the mode label, and they hide, keeping their space, while the box has focus
GIVEN Claude is working in the shown session WHEN the composer draws THEN the running indicator shows with
`⌃C stop`, and it hides once the activity is `idle`
GIVEN the session ends WHEN its tab shows THEN `i`, `a` and Send's `⌘↩` read the `chat.ended` binds, and
the chips' hints hide
GIVEN the resume list is open WHEN the cursor is on a live past session THEN its row ends in `x archive`;
on an archived row it ends in `x restore`; on the New session line it ends in no prompt
GIVEN the resume list is open THEN its header ends in `/ filter  . archived`
GIVEN a mode picker is open THEN its header ends in `/ filter`, and shows no `. archived`
GIVEN a permission waits WHEN the user rebinds `chat.allowPermission` THEN Allow once shows the new keys
with no chat code running (the keys plugin redraws the anchor)

Tests:     `archiveStateOf_NewSessionLine_Null` — `archiveStateOf({ kind: 'new', label: 'New session' })` is null ·
           `archiveStateOf_LiveRow_Live` — a past item whose row has `archived: false` gives `'live'` ·
           `archiveStateOf_ArchivedRow_Archived` — a past item whose row has `archived: true` gives `'archived'`
           (each test builds its own `PastSessionRow`) · the composer, chips, dialogs and pickers are looks:
           task 12 (Final verification) checks them on screen

Done when: typecheck and lint pass; `grep -rn "key-hint'" src/plugins/chat` prints nothing;
           `grep -rn "keysFor\|onChanged" src/plugins/chat/page --include='*.ts'` prints no line outside test
           files; the test gate runs the tests above
Commit:    one commit for the group: "Chat names key anchors on its composer, cards, dialogs and pickers"

### Concerns for the lead

- **C1 and C2 — settled by the lead.** Task 01 adds the list picker slots `headerEnd` and `cursorEnd`. Task 01
  counts placement over the page load, so the permission keys count once a card waits.
- **C3 — no running indicator existed.** The user named "the running indicator"; at plan time the composer
  has none (the session row's status text belongs to the sessions plugin, task 03). This task adds one to the
  composer bar.

## Proof

Commit 7a58a86 · proof: diff read, Produces present (layout.d.ts kit keyHint shape kept, key-hint.ts deleted); typecheck clean in chat files · concerns: fake agent declares only Mode and Effort controls, so the chat.pickControl (c) and chat.pickModel (o) chip anchors are named but never attached in the self-test
