# 09 — Chatroom mode, row badge and layouts

Status: not started
Type: Task
Rung: hard · new mode with its own key scopes, a composer, a place slot and a layout contract that 10 drives; it follows existing patterns but leaves many view choices to the worker
Wave: 4 · Depends on: 08
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/chatroom/page/start.ts`
- create `src/plugins/chatroom/page/chatroom-view.ts` (the side bar, the sheet, the composer, keys and anchors)
- create `src/plugins/chatroom/page/chatroom-state.ts` (the pure view state and the badge and activity rules)
- create `src/plugins/chatroom/page/preview-sample.ts` (the preview's sample `RoomView` and thread)
- create `src/plugins/chatroom/page/layout/read-chatroom-layout.ts`
- create `src/plugins/chatroom/layouts/layout.d.ts`
- create `src/plugins/chatroom/layouts/default/layout.js` · create `src/plugins/chatroom/layouts/default/layout.css`
- modify `src/plugins/chatroom/manifest.ts` (page commands, scopes, `page: ['sessions']` already there)
- modify `src/plugins/chatroom/contract.ts` (adds the chatroom.place slot only)
- modify `src/plugins/chatroom/main/start.ts` (`api.layouts.register({ layoutTypes })` only)
- modify `src/plugins/page.ts` · modify `src/plugins/keymap.ts` · modify `docs/keymap.md`
- modify `docs/features/layouts/design.md` (§ Adopters: one `chatroom` row; § Previews: one `Space z l r` row)
- modify `DESIGN.md` (§ Surfaces: one Chatroom bullet)
- test `src/plugins/chatroom/page/chatroom-state.test.ts` · test `src/plugins/chatroom/page/start.test.ts`

Consumes (each from 08 in `src/plugins/chatroom/contract.ts`, as 08's Produces writes them):
- `chatroomRoomsSlot: KeyedSlotKey<RoomView, 'main', 'chatroom'>` (`chatroom.rooms`, keyed by room name) ← 08
- `RoomView` ← 08, with at least these members:
  - `room: string`
  - `threads: readonly ThreadView[]`
  - `board: readonly BoardRow[]` (`BoardRow` ← 06, drawn whole; the page reads only `rowId` and `name`, the session title; the lead checks
    that 06 has both)
  - `claims: readonly Claim[]`
  - `rowUnread: readonly RowUnread[]`
  - `userAsks: readonly RoomMessage[]`: open `question` and `blocker` posts addressed to `you` that no `answer`
    replies to
- `ThreadView { thread: string; resolved: boolean; lastId: number; userUnread: number; userMentions: number }` ← 08.
  `userUnread` counts the posts past the user's cursor. `userMentions` counts those of them addressed to `you`.
- `RowUnread { rowId: string; unread: number; mentions: number; newestThread: string | null }` ← 08: per session
  row, the posts by the row's agents (main and subagents) past the user's cursor, without entries and `progress`,
  and those of them addressed to `you`. `newestThread` is the thread of the row's newest such unread post, or null
  when there is none. Only main sees the posts, so only main can name that thread.
- 08 builds the view of every stored room at app start (a room with history shows after an app restart, with an
  empty board). The page consumes that: it seeds nothing.
- `ChatroomChannel` (the page channel) ← 08, invoke methods (08 spells them as 09 does, `Promise<…>`):
  - `readThread(room: string, thread: string, afterId: number): Promise<RoomMessage[]>`, the whole thread past
    `afterId`, entries and `progress` included
  - `postAsUser(room: string, thread: string, post: UserPost): Promise<UserPostResult>`. Main stamps
    `from: you` and `userWord: true`.
  - `markUserRead(room: string, thread: string, upToId: number): Promise<void>`
- `UserPost { kind: 'note' | 'answer'; body: string; to: readonly string[]; replyTo: number | null }` ← 08 (`to`
  holds participant names)
- `UserPostResult = { ok: true; id: number } | { ok: false; reason: string }` ← 08
- `RoomMessage`, `Participant`, `MessageRef`, `PostKind`, `EntryKind`, `Claim` ← 01
- `sessionsPageKey` (`addRowPart`, `setActivity`, `activate`), `sessionsRowsSlot` (`SessionRow.project`,
  `SessionRow.label`), `followRows` — already in `src/plugins/sessions/contract.ts`
Produces:
- `export const chatroomPagePart: PagePart<typeof chatroomManifest>` in `src/plugins/chatroom/page/start.ts`
- `export const chatroomPlaceSlot: SlotKey<ChatroomPlace, 'page', 'chatroom'>` (`chatroom.place`) and
  `export interface ChatroomPlace { room: string | null; thread: string | null }` in `src/plugins/chatroom/contract.ts`
- manifest commands, all `runsIn: 'page'`: `showMode`, `preview`, `listDown`, `listUp`, `listTop`, `listBottom`,
  `openThread`, `logDown`, `logUp`, `logTop`, `logBottom`, `compose`, `reply`, `send`, `leaveComposer`,
  `openThreadRow` (arg `string`, `<room>\n<thread>`, a click), `openRowRoom` (arg `string`, a row id, a click)
- manifest scopes: `threads: 'In the chatroom thread list'`, `log: 'In the chatroom thread log'`,
  `composer: 'In the chatroom composer'`
- the layout contract `src/plugins/chatroom/layouts/layout.d.ts`: parts `sideBar`, `board`, `message`, `composer`,
  `rowBadge`, each `(parent, input, kit) => PartView` on the base kit
- the page log lines below, which 10's self-test waits on
Decisions:
- **Mode** (pattern: `src/plugins/practice/page/start.ts`): `api.modes.add({ id: 'main', title: 'Chatroom', icon:
  'comment-discussion', element, sideBar, shown, hidden, sideBarHidden, sideBarOpenedOver, focusSideBar, focusMain })`.
  `showMode` shows the mode, or toggles its side bar while it shows. The title bar context is `Chatroom` with the
  shown thread as `detail`.
- **Side bar**: one group per room in `chatroom.rooms`, sorted by name. Under each room, its open threads sorted by
  `lastId` (newest first, a `session:<row id>` thread included), then its resolved threads dim, also by `lastId`
  newest first. Each thread row shows its name, then `userUnread` when it
  is more than 0, and an `@` mark when `userMentions` is more than 0. A `session:<row id>` thread shows as
  `<session title> (session)`. Take the title from the room's `BoardRow` for that row id. When no board row has
  it, show the raw thread name. `j`/`k`/`gg`/`G` move the cursor. Enter opens the cursor's thread, and `picked()`
  closes an overlaid side bar.
- **Start state**: `shown()` with no place shows no thread, sets the key scope to `threads` and puts the list cursor
  on the first row. With a restored place whose room and thread exist, `shown()` opens that thread, and the scope
  is `threads` too. Opening a thread puts the log cursor on its newest message. The keys stay in the side bar until
  `<A-l>` gives them to the log.
- **Sheet**: the room's board on top (one line per `BoardRow`, drawn by the `board` part), then the thread's log
  (one `message` part per message, oldest first), then the composer. A message shows its sender's `name`, its kind
  as a tag, its time, its body as markdown (`kit.markdown`), its refs as chips, `to` names when not empty, and
  `replyTo` as `↪ #<id>`. Entries (`dispatch`, `hand-back`, `joined`, `left`) and `progress` draw dim. A message
  whose `userWord` is true shows the sender `you`.
- **Log reading**: on thread open, `readThread(room, thread, 0)`. On each change of that room's slot value whose
  thread `lastId` grew, `readThread(room, thread, <last id held>)` and append. While the mode shows and the thread
  is open, call `markUserRead(room, thread, <last id held>)` after each read. Never call it while the mode is
  hidden. Reads may continue while hidden, but they never mark. On `shown`, call `markUserRead` up to the last id
  held, so a post that came while hidden does not stay unread.
  One read runs at a time for the open thread. A change that comes during a read sets a flag, and the read runs
  again when it ends. A read result appends only the messages whose id is above the last id held, and only while
  its thread is still the open thread; otherwise it is dropped.
- **Composer**: a `textBoxInput` box (`src/shared/page/text-box.ts`). `i` (`compose`) focuses it for a `note` to
  the thread. `r` (`reply`) on a log cursor that holds a `question` or `blocker` opens it as an `answer` with
  `replyTo` that message's id. Its `to` is the sender's board name for a main agent. For a subagent sender
  (`from.agentId` is not null), `to` is the lead's board name, found from `from.rowId`, because a post's `to` names
  only main agents. When the board no longer holds the sender's row, `to` is empty. On any other message `r` logs
  `nothing to reply to`.
  Enter (`send`, `<CR>` with `mode: 'insert'`) posts. On `ok: true` it clears the box. On `ok: false` it keeps
  the draft, shows the reason in the composer, and logs `post refused: <reason>`. Esc (`leaveComposer`) returns the
  keys to the log and keeps the draft. In a `session:<row id>` thread, a `note` has `to` set to that row's board
  name; when the board has no such row, `to` is empty. In other threads `to` is empty. The page sends nothing for
  an empty body.
- **Row badge** (pattern: `src/plugins/unity-pool/page/start.ts` `addRowPart`): part id `chatroom.badge`. For each
  row, find the `RoomView` whose `room` equals `SessionRow.project`, then its `RowUnread` for the row id. Text:
  `@<mentions>` when `mentions` is more than 0, else `<unread> new` when `unread` is more than 0, else nothing is
  drawn. A click runs `openRowRoom`. That command shows the mode on the row's room and opens the thread of the
  row's newest unread post: the thread `RowUnread.newestThread` names, else the row's `session:<row id>` thread.
- **Row activity**: source id `chatroom`. A row whose agents posted an entry of `userAsks` gets
  `{ word: 'asks you', tone: 'attention', rank: 35, emphasis: 'raised' }`. Rank 35 puts it over error (30) and
  working (20) and under needs you (40). When the row has none, set `null`. Set it again on every slot change.
- **Place**: write `chatroom.place` on each room or thread change, and restore it at start (the `<id>.place` rule,
  AGENTS.md § A slot).
- **Keys** (`src/plugins/keymap.ts`, `docs/keymap.md`):
  - `<Leader>kc` → `chatroom.showMode`, scope `any`. `k` is the go-to group, and `c` is the item's first letter
    (docs/keymap.md § Leader groups, step 5: a mode goes under `k`). `kc` is free.
  - `<Leader>zlr` → `chatroom.preview`, scope `any`, in the layout previews group (`r` for room; `zlc` is chat's).
  - In scope `threads`: `j`, `k`, `gg`, `G`, `<CR>`. In scope `log`: `j`, `k`, `gg`, `G`, `i`, `r`. In scope
    `composer`: `<CR>` (insert), `<Esc>`.
  - Add `chatroom.threads` and `chatroom.log` to the `<C-n>` per-main-view scope list in `keymap.ts`.
  - Add `kc` to the `k` row and `zlr` to the `zl` row of `docs/keymap.md`'s table.
- **Design docs**: `docs/features/layouts/design.md` § Adopters gets one row: owner `chatroom`, setting
  `chatroom.layout`, surfaces the side bar, the board, the message, the composer and the row badge. § Previews gets
  one row: `Space z l r`, the chatroom sample. `DESIGN.md` § Surfaces gets one bullet, `**Chatroom:**`, that
  describes the side bar, the board, the log and the composer, and the row badge, with token names where it gives
  numbers, in the style of the `Unity pool` bullet. Task 12 judges its screenshots against that bullet.
- **Anchors** (AGENTS.md § Key hints, Every other bind has an anchor): `i compose` and `r reply` are box hints in
  the log pane's header. `r` is also a cursor prompt on a question or blocker row. Send's `↩` is a control hint on
  the composer's Send button. The vim keys need none. The self-test fixture (10) draws every anchored element.
- **Preview** (AGENTS.md § A layout: a view that needs agent data has a preview sample under `Space z l`):
  `preview` shows the mode over `preview-sample.ts`'s `RoomView` and thread, in place of the slot. The sample has
  one message of each `PostKind` and each `EntryKind`, two board rows, one claim and one `userAsks` entry. In the
  preview the composer logs `preview: not posted` and sends nothing. The badge and activity ignore the sample.
  Leaving the mode or opening a real thread ends the preview.
- **Layout** (pattern: `src/plugins/unity-pool/layouts/layout.d.ts`, `page/layout/read-unity-pool-layout.ts`):
  the page shows through `api.layouts.show` with `userLayout: () => api.settings().layout`. Main registers the
  contract text in `main/start.ts`. Every root that a part draws carries the layout attributes. Colours and lengths
  are theme tokens (`npm run lint` runs `check-styles`).
- **Page log lines**, each under `[chatroom]`. Write them exactly. 10 waits on them:
  - `shown` when the mode shows (as backlog logs `[backlog] shown`)
  - `badge in <row label>: <text>`, with `none` when nothing is drawn. Log only when the text changes.
  - `activity in <row label>: asks you` or `activity in <row label>: none`. Log only when it changes.
  - `thread shown: <room>/<thread> (<n> messages)`
  - `list cursor on <room>/<thread>`
  - `log cursor on #<id> <kind> from <name>`
  - `composer open: note` and `composer open: answer to #<id>`
  - `posted #<id> to <room>/<thread>` and `post refused: <reason>`
  - `nothing to reply to`
  - `preview shown` and `preview: not posted`
- `page.ts`: add `chatroomPagePart` to `pageParts`. The host starts parts in dependency order, so `sessions`
  starts first.
GIVEN a `RowUnread` of `{ unread: 3, mentions: 1 }` WHEN the badge rule runs THEN the text is `@1`
GIVEN `{ unread: 2, mentions: 0 }` WHEN the badge rule runs THEN the text is `2 new`; with `{ 0, 0 }` nothing draws
GIVEN a room whose `userAsks` holds a question from row A WHEN the activity rule runs THEN row A gets `asks you`
  raised and row B gets null
GIVEN rooms with open and resolved threads WHEN the side bar list builds THEN rooms sort by name, open threads by
  `lastId` descending, and resolved threads follow
GIVEN the log cursor on a question from `Shop Revamp` WHEN `r` then text then Enter THEN `postAsUser` gets
  `{ kind: 'answer', replyTo: <its id>, to: ['Shop Revamp'] }` on the shown room and thread
GIVEN a `RowUnread` with `newestThread: 'plan-demo'` WHEN `openRowRoom` runs THEN the thread `plan-demo` opens; with
  `newestThread: null` the thread `session:<row id>` opens
GIVEN `postAsUser` answers `ok: false` WHEN the user sends THEN the draft stays in the box and the reason shows
Tests:
- `chatroom-state.test.ts` — `badgeText` (table: mentions over unread, unread only, both zero) · `rowActivities`
  (table: question to you, blocker to you, ask from another row, no asks → null) · `threadList` (one test over the
  whole order: rooms by name, open by `lastId` descending, resolved last, `session:` thread named from the board
  with the raw-name fallback) · `userPostFor` (table: note in a topic thread → empty `to`; note in
  `session:<row id>` → that row's name; note in `session:<row id>` whose row is not on the board → empty `to`; reply
  on a question from a main agent → answer with `replyTo` and `to`; reply on a question from a subagent → `to` is
  the lead's board name; reply on a question from a sender the board no longer holds → empty `to`; reply on a
  `result` → null)
- `start.test.ts` — wiring tests through `startDrawingPagePart`, with a fake channel and a seeded slot. Assert the
  fake's recorded calls, not the DOM. Rows: opening a thread then marking read calls `markUserRead` with the last
  id · a send calls `postAsUser` with the composer's post · a hidden mode never calls `markUserRead`, and `shown`
  then marks up to the last id held · an empty body makes no `postAsUser` call · `ok: false` keeps the draft ·
  two slot changes before the first `readThread` reply show each message id once · a read that lands after another
  thread opened appends nothing · `openRowRoom` opens `newestThread`, else `session:<row id>` · the preview
  composer calls no `postAsUser` and logs `preview: not posted` · the place round trip: opening a thread writes
  `chatroom.place`, and a new start with that place restores the thread (this is the proof of the restore, since
  12 cannot reload the page) · `badge in` logs only when the text changes.
Approach:  keep the rules in `chatroom-state.ts` as pure functions over `RoomView`, `SessionRow` and the place,
           so the tests reach them without a DOM. `chatroom-view.ts` holds the DOM, keys, anchors and focus,
           in the shape of `practice-view.ts`.
Done when: compiles; `npm run lint` passes (layers and styles); the tests above pass at the test gate. Live
           checks are in 12.
Commit:    one commit for the group

## Proof
