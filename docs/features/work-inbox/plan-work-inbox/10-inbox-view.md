# 10 — Inbox view plugin

Status: not started
Type: Task
Rung: hard · adds the `work-inbox.filterTicket` command that 11 runs and 12 binds, and a new layout contract; it follows
Backlog's and Schedules' view patterns but leaves the card actions, the draft box and the focus moves to judge
Wave: 2 · Depends on: 04
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`.

Files:
- create `src/plugins/work-inbox/manifest.ts`
- create `src/plugins/work-inbox/contract.ts`
- create `src/plugins/work-inbox/main/start.ts`
- create `src/plugins/work-inbox/page/start.ts`
- create `src/plugins/work-inbox/page/inbox-state.ts`
- create `src/plugins/work-inbox/page/inbox-view.ts`
- create `src/plugins/work-inbox/page/sample-state.ts`
- create `src/plugins/work-inbox/page/demo-steps.ts`
- create `src/plugins/work-inbox/page/layout/read-layout.ts`
- create `src/plugins/work-inbox/page/layout/inbox-kit.ts`
- create `src/plugins/work-inbox/layouts/layout.d.ts`
- create `src/plugins/work-inbox/layouts/default/layout.js`
- create `src/plugins/work-inbox/layouts/default/layout.css`
- test `src/plugins/work-inbox/page/inbox-state.test.ts`
- test `src/plugins/work-inbox/page/inbox-view.test.ts`
- test `src/plugins/work-inbox/page/start.test.ts`
- test `src/plugins/work-inbox/page/demo-steps.test.ts`
- test `src/plugins/work-inbox/page/layout/read-layout.test.ts`

Consumes:
- `WorkState`, `WorkItem`, `WorkSection`, `WorkJobStatus` and `workStateSlot` from `src/plugins/work/contract.ts` ← 04
- `statusLine(job: WorkState['job'], now: number): WorkStatusLine`, with `WorkStatusLine` `{ text, tone, hasRow }`,
  from `src/plugins/work/contract.ts` ← 04. It is the one status-line rule for both views (Decisions, Status line).
- the `work` page part, as `dependsOn.page: ['work']` ← 04
- work commands, run by qualified id: `work.sweep`, `work.send`, `work.dismiss`, `work.restore`, `work.snooze`,
  `work.addToBoard`, `work.startSession`, `work.openJobRow` ← 04 (declared), 08 and 09 (run). Their page handlers
  reject with main's refusal text (04, 09), which only a reporting run sees.
- `work-board.showTicket` (arg: a ticket key string), run by id only and never imported. Task 11 declares it in this
  same wave, so neither task waits on the other. 12's manifests test pins the id once both land.
- tree: `MODES_SHOW` and `CORE_OPEN_LINK` (`src/contracts/commands.ts`), `services.editor` (`EditorHost.create`),
  `services.toast`, `api.commands.runFor` (`PluginCommands.runFor`, `src/contracts/plugin.ts`), `errorText`,
  `createBaseKit` and `ownerBaseKitDeps` (`src/shared/page/layout-host/base-kit.ts`), `readLayoutParts`,
  `placeWrites` (`src/shared/page/place-slot.ts`), `createReducerStore`, `createLayoutParts`

The work contract fields this task reads, beyond plan.md's lists, are under **Contract needs**. If 04 lands them under
other names, use 04's names; if 04 lacks one, stop and report it.

Produces:
- `export const workInboxManifest` in `manifest.ts`: id `work-inbox`, label `Inbox`, `dependsOn: { main: [], page: ['work'] }`,
  `reads: { main: [], page: [] }`, description `Adds Inbox mode: Slack threads sorted by what needs you, with drafts ready to send.`,
  the commands and scopes under Pinned values, setting `layout: 'default'` with `settingControls: { layout: 'layout' }`
  and `settingInfo.layout` (`Layout`, `The Inbox layout: a folder name in work-inbox's layouts folder, or default.`),
  and no `demoSkip`.
- `export const workInboxMainPart: MainPart<typeof workInboxManifest>` in `main/start.ts`. It registers the layout
  contract (`api.layouts.register({ layoutTypes })` from `../layouts/layout.d.ts?raw`) and nothing else, as
  `src/plugins/gallery/main/start.ts` does. Every plugin with layouts has a main part for this. plan.md's File Structure
  leaves it out.
- `export const workInboxPagePart: PagePart<typeof workInboxManifest>` in `page/start.ts`.
- `export interface WorkInboxPlace { section: InboxSectionId; ticketFilter: string | null; cursorId: string | null; drafts: Record<string, string> }`
  and `export const workInboxPlaceSlot` (a page-owned value slot of `WorkInboxPlace`, published through `placeWrites` as
  `backlogPlaceSlot` is) in `contract.ts`.
- `export type InboxSectionId = WorkSection | 'all'` and the pure view state in `page/inbox-state.ts`:
  - `export interface InboxViewState`, holding `section`, `ticketFilter`, `cursorId`, `focus: 'sections' | 'list' | 'box'`,
    `sectionCursor` and `drafts`
  - `export type InboxAction`
  - `export function inboxReducer(state: InboxViewState, action: InboxAction): InboxViewState`
  - `export function sectionCounts(work: WorkState): Record<InboxSectionId, number>`
  - `export function shownItems(work: WorkState, view: InboxViewState): WorkItem[]`
  - `export function cardActions(item: WorkItem, view: InboxViewState): readonly InboxCardAction[]`
  - `export function emptyReason(work: WorkState, view: InboxViewState): InboxEmptyReason`
  - `export function prunedDrafts(drafts: Record<string, string>, work: WorkState): Record<string, string>`
- `export function createInboxView(deps: InboxViewDeps): InboxView` in `page/inbox-view.ts`. `InboxViewDeps` carries
  `runFor` (`api.commands.runFor`), `toast` and `log` beside the layout and editor deps. `InboxView` has:
  - `sheet` and `sideBar`
  - `shown()`, `hidden()`, `focusMain()`, `focusSideBar()`, `sideBarHidden()`, `sideBarOpenedOver()`
  - `stateChanged(value: WorkState | undefined)`
  - `setLayouts(shown)`
  - `showSample(state: WorkState): Disposable`
  - `dispose()`
  - `commands`: every no-arg page command but `showMode`
  - `filterTicket(key: string)`, `selectItem(id: string)`, `selectSection(id: string)`, `sendItem(id: string)`,
    `openTicket(key: string)`, and `pressItem(action: InboxCardAction, id: string)`, which the five arg-taking card
    commands (`dismissItem`, `restoreItem`, `snoozeItem`, `addItemToBoard`, `startItemSession`) call
- `export function sampleInboxState(now: number): WorkState` in `page/sample-state.ts`.
- `export function registerDemoSteps(services: PageServices, deps: InboxDemoPageDeps): Disposable` in `page/demo-steps.ts`.
- `export interface InboxLayout` and `CompleteInboxLayout` in `layouts/layout.d.ts`, with the parts under Layout contract.
- `export function readInboxLayout(module: unknown, name: string): InboxLayout` in `page/layout/read-layout.ts`.

## Contract needs

04's `work/contract.ts` holds every field and command this view reads. The ones beyond plan.md's lists:
- `WORK_SECTIONS`, the nav's order.
- `WorkItem.sending`: the text of a queued or running Send or nudge, else null. A press keeps the item `open` with
  `sending` set until its job ends; success clears the item, and failure clears `sending` and sets `note` (08).
- `WorkState.problem`: why `work.json` was not read at start, else null.
- The arg shapes:
  - `work.send` takes `WorkSendArg` (`{ itemId, text }`). On a Waiting on others item it queues a `nudge` job.
  - `work.dismiss`, `work.restore`, `work.snooze` and `work.addToBoard` each take the item id.
  - `work.startSession` takes `WorkStartArg` (`{ source: 'item', id }`).
  - `work.sweep` and `work.openJobRow` take none.
- The `CommandKey` exports `workSendCommand` and `workStartSessionCommand`.
- `statusLine` and `WorkStatusLine` (Consumes). `WorkStatusLine.tone` is `'idle' | 'running' | 'success' | 'error'`,
  each a `DotStatus` value, so the view passes it to the layout unchanged. Its text is the copy under Pinned values,
  and `hasRow` follows 09's `openJobRow` rule: true only when `job.last` has a `rowId` with a saved record, whatever
  `job.running` holds, since a running job's row has no side-bar place to open.

04's `job` holds only `running` and `last`, so the status line shows no queued count.

## Decisions

- **Layout.** Inbox mode uses the shell's side bar for the section nav, as Settings and Schedules do (DESIGN.md
  § Surfaces). The sheet holds one pane: a head (title, the status line, the ticket filter chip, box hints), then the
  card list. There is no split in the sheet, so the view sets resize and focus targets to `null`. Alt+h reaches the
  side bar through the mode's `focusSideBar`, and Alt+l returns through `focusMain`. The spike's look (`work.css` on
  `spike/work-inbox`) is reference for arrangement only.
- **The view reads `workStateSlot` and runs commands only.** It imports nothing from `work/main` (plan.md Boundary
  rules). Each slot change redraws. The view keeps no copy of work state beyond its own draw state.
- **Sections.** The nav lists the seven rows in Pinned order. A section shows its items with `state === 'open'`,
  newest `at` first. **All** shows every item in every state, newest first, each with its section's name as a neutral
  Tag, and a state Tag when it is not open. A section's count is its open items. All's count is every item. The
  Needs you count draws as a `warning` Tag while it is over 0, and every other count as tabular-numeral text in
  `fg-tertiary`.
- **Ticket filter.** `filterTicket(key)` shows the mode with the open items whose `ticketKeys` hold `key`, across
  sections, each with its section Tag. While a filter is set, no nav row is selected, and the head shows a filter
  chip `<KEY> ✕`. `clearFilter` (the chip's click, or `Esc` in the list) drops the filter and returns to the section
  shown before it.
- **Cards** draw through the layout's `card` part, one per shown item. Each card shows:
  - `<channel> · <author>` and the item's age
  - the title and the summary
  - the latest reply, when it is not empty
  - `With <participants joined by ", ">`, when there are any
  - `Why: <why>`, when `why` is set
  - one chip per ticket key, its tooltip the `linkReason`
  - the actions row, and the note in `status-error`
  The spin-up row (Start session, Add to Board) shows on every open card. Needs you and Waiting on others cards carry
  the draft (the Waiting draft is the nudge) and Send. A Waiting card also carries Snooze 1 day. Every open card
  carries Dismiss, and every card that is not open carries Restore. A Needs you card has a `status-warning` start edge
  at `indicator-width`. The default layout's CSS draws it, since the Card primitive's edges are `attention` and
  `error` only (DESIGN.md § Primitives). Task 14 checks this edge against `--wg-status-warning`.
- **One run path for work commands.** `kit.button` and `commands.run` cannot show a refusal: `KitCommands.run`
  returns `void` and logs a failure, and `PluginCommands.run` resolves on a handler failure. Only
  `PluginCommands.runFor(id, arg, sessions)` rejects with the handler's failure. So the view runs every command of
  another plugin through one internal path, `runWork(id, arg)`:
  - It calls `deps.runFor(id, arg, {})`. A key or click carries no session, so `sessions` is `{}`.
  - On a rejection it logs `<id> failed: <errorText>` and toasts the `errorText` with tone `error`. Once the view is
    disposed it does nothing.
  - It never throws, and the caller does not await it.
  - `openTicket` runs `work-board.showTicket` through it too, but toasts `Board is off: switch on work-board in
    Settings` in place of the error text.
  Every work command the view runs goes through `runWork`: the buttons, the keys and the `W` and `gs` binds. The
  layout's buttons therefore run this view's own commands, never a `work.*` id, and 12 binds `W` and `gs` to this
  view's `sweep` and `showJobRow`. Backlog has no reporting run to copy here: its view toasts its own channel's
  rejections, a channel this view does not own.
- **Card presses.** Each layout button runs a `work-inbox` command through `kit.button(parent, label, qualifiedId,
  { arg })`:
  - Dismiss, Restore, Snooze 1 day, Add to Board and Start session run `work-inbox.dismissItem`, `restoreItem`,
    `snoozeItem`, `addItemToBoard` and `startItemSession` with the item id. Each calls `pressItem(action, id)`, which
    runs `work.dismiss`, `work.restore`, `work.snooze` or `work.addToBoard` with the id, or `work.startSession` with
    `{ source: 'item', id }`, through `runWork`.
  - Open in Slack runs `core.openLink` with `item.url`. It opens a link and refuses nothing, so it needs no
    `runWork`.
  - Send runs `work-inbox.sendItem` with the item id, since only the view holds the box's text.
  - A ticket chip runs `work-inbox.openTicket` with its key, so a card still draws while work-board is off.
  - A card's own click runs `work-inbox.selectItem` with its id, as Backlog's `selectRow` does.
  - The status line's Show transcript runs `work-inbox.showJobRow`, and the `never` empty line's hint names
    `work-inbox.sweep`.
  Keys run the no-arg view commands, which act on the cursor card through the same `pressItem`.
- **A key whose action the card lacks.** Every per-card key is bound in the whole `list` scope, but a card offers only
  its `cardActions`. A key whose action is not in the cursor card's `cardActions`, or whose button draws disabled (Send
  while `isSending`), runs nothing and logs `no <command> for <id>`, `<command>` being the view command's short name
  (`no restore for fixture-needs-you`). `i` on a card with no draft area logs `no editDraft for <id>`. With no cursor
  card, each per-card key logs `no card`. The view never lets a work command refuse an action the card did not offer.
  `t` (`ticketOnBoard`) takes the card's first ticket key, in `ticketKeys` order; a card with none logs
  `no ticketOnBoard for <id>`.
- **The draft box.** Only the cursor card's draft is a vim box: `services.editor.create`, placed through the card kit's
  `draftBox` slot. Every other card shows its draft as plain wrapped text. The box opens on the user's edit for the
  item, else the item's `draft`, else empty with the placeholder `Write a reply…`. Each edit goes into
  `drafts[itemId]` in the view state and the place slot, so a redraw, a sweep or a page reload keeps unsent text.
  A sweep that brings a new `draft` for an item the user has edited keeps the user's text. On each state change,
  `prunedDrafts` drops the edit of every id that is no longer in `WorkState.items`, and keeps the edit of an item in
  any state, so the place slot cannot grow without bound and a Restore brings back the user's text.
  `i` (`editDraft`) focuses the box and sets the `box` scope. `Esc` (`leaveBox`, `where: 'box'`) returns to the `list`
  scope. A redraw while the box has focus keeps the box element and its editor, as Backlog keeps its filter frame.
- **Send.** `send` (Cmd+Enter in the list or the box) and `sendItem(id)` read the item's text: the edit, else the
  draft. Blank text toasts `Nothing to send` (`info`) and runs nothing. Otherwise they run `work.send { itemId, text }`
  through `runWork` and drop the edit. The item stays `open` in its section while `item.sending` is set (08), so the
  sending state shows in every section and under All: the box shows the `sending` text read-only, Send is disabled and
  its label is `Sending…`. The item leaves the section once its job succeeds and main clears it. A failed job clears
  `sending` and sets `note`, which the card shows in `status-error`, with the box editable again.
- **Problem.** While `WorkState.problem` is set, the head shows it as a `status-error` line above the list.
- **Status line.** The view draws 04's `statusLine(job, now)` (Contract needs). Its text describes `job.running`, else
  `job.last`, with the copy under Pinned values. The **Show transcript** button runs `work-inbox.showJobRow`, which runs
  `work.openJobRow` through `runWork`, and draws only while `hasRow` is true: the last finished job has a saved row.
  While a job runs, the button still opens the last finished job's row. `gs` runs `showJobRow` too. The line's age
  redraws once a minute through `services.timers`.
- **Empty list.** `emptyReason` returns one of:
  - `never`: no job ever ran and no item exists
  - `section`: the section has no open item
  - `filter`: no open item holds the filter key
  The `empty` part draws one EmptyState line, with the `W` hint on `never`.
- **First show.** With no place to put back, the view opens on `needs_you`, with `sectionCursor` on that row, focus on
  the list, and the cursor on the section's first card in shown order (none when it is empty). That placement logs
  `section Needs you`, then `selected <title>` when there is a card. A page load with a saved place opens on that
  place instead (Place), and logs its section and cursor the same way.
- **Cursor.** j/k/gg/G move the cursor card in shown order. The cursor card carries the focus ring and its cursor
  prompt. A section change, a filter and a clear each put the cursor on the new list's first card. When the cursor's
  item leaves the list, the cursor moves to the next card in shown order, else the previous one, else none. The view
  logs these lines, which 13's self-test checks:
  - `shown`, each time the mode shows
  - `selected <title>`, on each cursor move and each placement
  - `section cursor <title>`, on each move of the side bar's section cursor
  - `section <title>`, on each section change
  - `filter <KEY>` and `filter cleared`
  - `sections focused`, `list focused` or `box focused`, on each focus change
  - `no <command> for <id>` and `no card` (A key whose action the card lacks)
- **Side bar keys.** j/k/gg/G move only `sectionCursor` and log `section cursor <title>`; they do not change the shown
  section. Enter opens the cursor's section and moves focus to the list, and `l` opens it keeping focus
  (`docs/keymap.md`, A side-bar list). Each open logs `section <title>`. While a filter is set, opening a section drops
  the filter.
- **Focus from another view.** `filterTicket(key)` and `selectItem(id)` show the mode and focus the list, so the
  list's keys (`Esc` clearing the filter) act at once. `selectItem` of an id not in the shown list switches to All
  first, since the item may not be open.
- **Place.** `section`, `ticketFilter`, `cursorId` and `drafts` go to `workInboxPlaceSlot` on each change, and a page
  load puts the last page's place back once the first state lands, as Backlog does with `backlog.place`. The title
  bar's context is `{ title: 'Inbox', detail: <section title, or the filter key> }`.
- **Demo step.** `sampleInboxState(now)` is this view's own sample. The views may not import `work/main` (plan.md
  Boundary rules), so the work fixture is out of reach. The sample holds at least:
  - two Needs you items, one with a worker draft. The first in shown order (the newest `at`) holds a ticket key, so
    beat 1 places the `t` anchor.
  - one each in You promised, My threads, Around Slack (with a `why`) and Worth knowing (with a `why`)
  - one Waiting on others item with a nudge
  - one dismissed item, the newest `at` of all seven, so beat 3's cursor lands on it as the first card under All
  - ticket keys on three items, the first Needs you item among them
  - `job.last`: a finished sweep with a `rowId`, so `hasRow` is true and the `gs` anchor draws
  `showSample(state)` draws the sample in place of the slot until its dispose, and holds the place slot. Its beats
  are:
  1. `needs you`: Inbox shown, cursor on the first Needs you card
  2. `waiting`: section Waiting on others, cursor on its card
  3. `all`: section All, cursor on the dismissed card
  Together they draw every card action's anchor in the `list` scope: beat 1 places `i`, Cmd+Enter, `d`, `s`, `b`
  and `t`, beat 2 `z`, beat 3 `u`, and every beat `W` and `gs`. So the self-test's end-of-run placement check finds
  every bind 12 adds there. The step presses nothing and launches no worker. A key pressed during the demo acts on
  sample ids, which main refuses, and `runWork` toasts the refusal. That is acceptable.
- **The Dock badge is not this view's.** Alerts is a main service (`src/main/alerts/`), so work main sets the Needs you
  count (04 or 09). The view only draws the nav count.
- **Keys** are listed under Pinned values. Task 12 writes every bind in `src/plugins/keymap.ts`. This task declares
  the commands and scopes and places every anchor:
  - `W` (`work-inbox.sweep`) as a box hint in the list head, and again in the side bar's header for the `sections`
    scope
  - Cmd+Enter as Send's control hint
  - `i` on the cursor card's draft
  - `d`, `z`, `u`, `b`, `s` and `t` in the cursor card's prompt, each shown only where its action applies
  - `gs` (`work-inbox.showJobRow`) as the Show transcript button's control hint
  Ctrl+n needs no anchor of its own: Backlog's three scopes bind it and place none.
- **Lint until 12.** `npm run lint`'s composition check fails on the new folder until 12 registers it in
  `src/plugins/main.ts`, `page.ts` and `manifests.ts`. That one failure is expected at this task's proof. The style
  and layer parts of lint must pass.

## Pinned values

Copy from `design.md` § Inbox, verbatim:

- Section nav titles, in order: `Needs you`, `You promised`, `Waiting on others`, `My threads`, `Around Slack`,
  `Worth knowing`, `All`. Their ids: `needs_you`, `promised`, `waiting`, `my_threads`, `around`, `worth_knowing`, `all`.
- Button labels: `Open in Slack`, `Start session`, `Add to Board`, `Send`, `Snooze 1 day`, `Dismiss`, `Restore`.
- Mode: id `main`, title `Inbox`, icon `inbox`.

Copy this view chooses:

- `Sending…`, `Write a reply…` and `Nothing to send`.
- `Show transcript`.
- `Board is off: switch on work-board in Settings`.
- The state Tags under All: `cleared`, `dismissed`, and `snoozed until <MMM d>`.
- The filter chip: `<KEY> ✕`.
- Empty lines:
  - `never`: `Nothing gathered yet: sweep Slack and Jira` with the `work-inbox.sweep` hint
  - `section`: `Nothing in <section title>.`
  - `filter`: `No open threads for <KEY>.`
- The status line's copy, which 04's `statusLine` returns and its table test pins; the Board shows the same. It is
  for the job `running ?? last`. The kind words are sweep `Sweep`, send `Send`, move `Move` and
  nudge `Nudge`. `<ago>` is `just now`, `<n>m ago`, `<n>h ago` under 48 hours, else `<n>d ago`. Its forms:
  - none: `No job yet`, tone `idle`
  - queued: `<Kind> queued`, tone `running`
  - running: `<Kind> running · started <ago>`, tone `running`
  - done: `<Kind> done <ago>`, tone `success`
  - failed: `<Kind> failed <ago>`, tone `error`
  - a set `note` adds ` · <note>`

Commands (`workInboxManifest.commands`, every one `runsIn: 'page'`):

| Command | Arg | Label |
| --- | --- | --- |
| `showMode` | | `inbox` |
| `sectionDown` / `sectionUp` / `sectionTop` / `sectionBottom` | | `next section` / `previous section` / `first section` / `last section` |
| `openSection` | | `open the section` |
| `peekSection` | | `show the section, keeping focus` |
| `listDown` / `listUp` / `listTop` / `listBottom` | | `next card` / `previous card` / `first card` / `last card` |
| `openSlack` | | `open in Slack` |
| `editDraft` | | `edit the draft` |
| `send` | | `send the draft` |
| `leaveBox` | | `leave the draft` |
| `dismiss` | | `dismiss` |
| `snooze` | | `snooze 1 day` |
| `restore` | | `restore` |
| `addToBoard` | | `add to Board` |
| `startSession` | | `start a session` |
| `ticketOnBoard` | | `show its ticket on the Board` |
| `clearFilter` | | `clear the ticket filter` |
| `sweep` | | `sweep Slack and Jira` |
| `showJobRow` | | `show the last job's transcript` |
| `filterTicket` | `'string'` | `show the threads of a ticket` |
| `selectItem` | `'string'` | `select this card` |
| `selectSection` | `'string'` | `show this section` |
| `sendItem` | `'string'` | `send this card's draft` |
| `openTicket` | `'string'` | `show this ticket on the Board` |
| `dismissItem` | `'string'` | `dismiss this card` |
| `restoreItem` | `'string'` | `restore this card` |
| `snoozeItem` | `'string'` | `snooze this card 1 day` |
| `addItemToBoard` | `'string'` | `add this card to the Board` |
| `startItemSession` | `'string'` | `start a session from this card` |

`sweep` runs `work.sweep` and `showJobRow` runs `work.openJobRow`, each through `runWork`, so their refusals toast.

Scopes:
- `sections`: `In the Inbox sections`
- `list`: `In the Inbox list`
- `box`: `In an Inbox draft`

Keys for task 12. Each was picked by `docs/keymap.md` § Adding a bind and checked against every bind in its scope and
in `any`, which holds no raw key.

| Scope | Keys → command |
| --- | --- |
| `work-inbox.sections` | `j` sectionDown · `k` sectionUp · `gg` sectionTop · `G` sectionBottom · `<CR>` openSection · `l` peekSection · `W` sweep · `<C-n>` `chat.startNewSession` |
| `work-inbox.list` | `j` listDown · `k` listUp · `gg` listTop · `G` listBottom · `<CR>` openSlack · `i` editDraft · `<D-Enter>` send · `d` dismiss · `z` snooze · `u` restore · `b` addToBoard · `s` startSession · `t` ticketOnBoard · `<Esc>` clearFilter · `W` sweep · `gs` showJobRow · `<C-n>` `chat.startNewSession` |
| `work-inbox.box` | `<D-Enter>` send · `<Esc>` leaveBox (`where: 'box'`) · `<C-n>` `chat.startNewSession` |

Why these keys:
- `<CR>` opens (Raw key layer).
- `i` enters the box.
- `<D-Enter>` sends, by the Cmd convention.
- `d` matches the docs tree's and the Sessions list's trash or close.
- `u` undoes a dismiss.
- `z` is sleep.
- `s` starts, as Backlog's `s` does.
- `b` is Board and `t` is ticket.
- `gs` is a `g` go-to, like Backlog's `gl`.
- `<Esc>` backs out.

Layout contract (`layouts/layout.d.ts`). Each part appends its root and returns it, as Backlog's contract says. The
parts:
- `sideBar(parent, kit: SideBarKit): InboxPane`. Its slot is `sections` → `ol.work-inbox-sections`.
- `sectionRow(parent, input: SectionRowInput, kit)`. `SectionRowInput` is `{ id, title, count, isHot }`. The app sets
  `is-selected` and `is-cursor` and the click.
- `main(parent, kit: MainKit): InboxPane`. Its slots are `status` → `div.work-inbox-status-slot`,
  `filter` → `div.work-inbox-filter-slot` and `cards` → `ol.work-inbox-cards`.
- `status(parent, input: InboxStatusInput, kit)`. `InboxStatusInput` is `{ text, tone: DotStatus, hasRow }`, filled
  from 04's `WorkStatusLine` field for field. It draws the Show transcript button, running `work-inbox.showJobRow`,
  only when `hasRow` is true.
- `filter(parent, input: { ticketKey: string }, kit)`.
- `card(parent, input: CardInput, kit: CardKit)`. `CardKit` adds the `draftBox(parent)` slot, placed only on the cursor
  card while it has a draft area. `CardInput` holds:
  - `id`, `section`, `sectionTitle` (non-null under All and the filter), `channel`, `author`, `age`
  - `title`, `summary`, `latest`, `participants`, `why`
  - `tickets` (`{ key, reason }`)
  - `state`, `stateTag`, `draft` (text, or null when the card has no draft area), `isSending` (`item.sending !== null`)
  - `isDirect` (Needs you), `isCursor`, `note`, `url`
  - `actions` (`InboxCardAction[]`, in order: `send`, `snooze`, `dismiss` or `restore`, `startSession`, `addToBoard`)
  - `prompt` (`PromptActionInput[]`, empty off the cursor card)
- `empty(parent, input: { reason, section, ticketKey }, kit)`.
- Kit scopes: `sideBar` and `sectionRow` draw in `work-inbox.sections`, and every other part in `work-inbox.list`.
  The `draftBox`'s box hint draws in `work-inbox.box`.

## GIVEN / WHEN / THEN

- GIVEN a WorkState with 2 open and 1 dismissed Needs you items WHEN the nav draws THEN Needs you reads 2 as a
  `warning` Tag, and All counts every item.
- GIVEN section All WHEN it draws THEN the dismissed item shows with a `dismissed` Tag and Restore, and no Dismiss.
- GIVEN `filterTicket('ABC-1')` WHEN the list draws THEN it shows only the open items holding `ABC-1`, each with its
  section Tag, and no nav row is selected. WHEN `Esc` follows THEN the section shown before returns.
- GIVEN the cursor on a Needs you card WHEN the user types in its box and the slot changes THEN the box keeps the
  text and its focus.
- GIVEN an edited draft WHEN `send` runs THEN `work.send` runs with `{ itemId, text }` holding the edited text, and
  the edit is dropped. GIVEN blank text THEN it toasts `Nothing to send` and runs nothing.
- GIVEN an open Needs you item with `item.sending` set WHEN its card draws in Needs you THEN Send reads `Sending…` and
  is disabled, and the box is read-only. WHEN `send` runs on it THEN it logs `no send for <id>` and runs nothing.
- GIVEN the cursor card leaves the shown list WHEN the slot changes THEN the cursor moves to the next card, else the
  previous one.
- GIVEN `job.running` is a running sweep and `job.last` is null WHEN the status draws THEN it reads
  `Sweep running · started <ago>` in tone `running`, with no Show transcript. GIVEN `job.last` is a done sweep with a
  saved row THEN Show transcript draws, also while another job runs.
- GIVEN `work.dismiss` rejects with `x is not open` WHEN Dismiss is pressed or `d` runs THEN the view logs
  `work.dismiss failed: x is not open` and toasts `x is not open` with tone `error`. The same holds for `W` and `gs`.
- GIVEN the cursor on an open Needs you card WHEN `u` runs THEN it logs `no restore for <id>` and runs no command.
- GIVEN a card with ticket keys `['ABC-1', 'ABC-2']` WHEN `t` runs THEN `work-board.showTicket` runs with `ABC-1`.
- GIVEN `openTicket('ABC-1')` WHEN `work-board.showTicket` rejects THEN the view toasts
  `Board is off: switch on work-board in Settings`.
- GIVEN an edit for an item WHEN a slot change no longer holds the item THEN the edit leaves the view state and the
  place. GIVEN the item is dismissed instead THEN the edit stays, and a Restore shows it.
- GIVEN no saved place WHEN the mode first shows THEN Needs you is shown with the cursor on its first card, logging
  `section Needs you` then `selected <title>`.

## Tests

- `inbox-state.test.ts`:
  - `sectionCounts counts open items per section and every item under All`: table rows per section.
  - `shownItems filters by section, All and ticket key, newest first`: table.
  - `cardActions gives each section and state its actions`: a table over Needs you open, Waiting open, Around open,
    and dismissed under All, asserting the exact action lists from the `CardInput.actions` order.
  - `inboxReducer keeps the cursor on the next card, else the previous, when its item leaves`: table.
  - `inboxReducer clears the filter back to the section shown before it`.
  - `emptyReason names never, section and filter`.
  - `prunedDrafts keeps edits of items in any state and drops the rest`: table.
  The status line's words are 04's `statusLine` table test; this task adds no copy of it.
- `inbox-view.test.ts`, on the fake DOM and editor as `backlog-view.test.ts` uses them, with a fake `runFor`:
  - `send runs work.send with the edited text and drops the edit`
  - `blank send toasts and runs nothing`
  - `a sending card reads Sending…, disables Send and keeps its section`
  - `a slot change keeps the focused draft box and its text`
  - `a rejected work command logs and toasts its text`: a table over a button press, a key, `W` and `gs`, each
    asserting that `runFor` ran the `work.*` id and the toast holds the rejection text.
  - `a key whose action the card lacks logs and runs nothing`: a table over `u` on an open card, `z` on Needs you,
    `i` on an Around card and `d` on a dismissed card.
  - `t runs the board command with the card's first ticket key`
  - `openTicket toasts when the board command rejects`
  - `Show transcript draws only while hasRow is true`
  - `the Needs you count draws as a warning Tag while over 0`
  - `first show opens Needs you on its first card and logs both lines`
  - `each focus change sets its scope and logs it`
  - `the Needs you card carries is-direct`
- `start.test.ts`:
  - `showMode shows the mode and leaves it shown`
  - `a page load puts back the place`
  - `filterTicket shows the mode filtered with the list focused`
- `demo-steps.test.ts`: `the Inbox step registers and its beats enter and dispose without throwing`, as
  `backlog/page/demo-steps.test.ts` does.
- `read-layout.test.ts`: as Backlog's, over this contract's parts.

The layout's look, the warning edge's colour and the cross-mode chip land in task 14 (Final verification).

## Done when

- `npm run typecheck` passes.
- `npm test -- src/plugins/work-inbox` passes.
- `node scripts/check-styles.mts` passes.
- `npm run lint`'s only failure is the composition check naming `work-inbox`, which 12 closes.

## Commit

One commit for the group: `work-inbox: Inbox mode view over work.state, its layout contract, default layout and demo step`.

## Proof

