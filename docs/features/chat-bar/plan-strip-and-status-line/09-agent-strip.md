# 09 — The agent-strip plugin

Status: not started
Type: Task
Wave: 5 · Depends on: 02, 04, 06, 07, 08
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/agent-strip/manifest.ts`
- create `src/plugins/agent-strip/main/start.ts` · test `src/plugins/agent-strip/main/start.test.ts`
- create `src/plugins/agent-strip/main/selftest-script.ts`
- create `src/plugins/agent-strip/page/start.ts`
- create `src/plugins/agent-strip/page/strip-boxes.ts` · test `src/plugins/agent-strip/page/strip-boxes.test.ts`
- create `src/plugins/agent-strip/page/agent-strip.ts` · test `src/plugins/agent-strip/page/agent-strip.test.ts`
- create `src/plugins/agent-strip/page/layout/read-agent-strip-layout.ts`
- create `src/plugins/agent-strip/page/agent-strip.css`
- create `src/plugins/agent-strip/layouts/layout.d.ts`, `src/plugins/agent-strip/layouts/default/layout.js` ·
  test `src/plugins/agent-strip/layouts/default/layout.test.ts`
- modify `src/plugins/chat/main/preview/chat-preview.ts` · test `src/plugins/chat/main/preview/chat-preview.test.ts`
- create `src/plugins/chat/main/preview/preview-agent-events.ts` (the sample's event list)
- modify `src/plugins/chat/main/start.ts` (wires the preview's `emit`)
- modify `src/plugins/agents/main/start.ts` · test `src/plugins/agents/main/start.test.ts` (no log for the preview)
- modify `src/plugins/keymap.ts`, `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts`,
  `scripts/check-layers.mts`

Consumes:
- `export interface HScroller { element; track; reveal(item); refresh(); dispose() }` and
  `export function createHScroller(): HScroller` in `src/shared/page/ui/h-scroller.ts` ← 02
- `RosterOutcome`, `RosterTool`, `RosterAgent`, `RosterTask`, `Roster` in `src/plugins/agents/contract.ts` ← 04
- `AgentsPageExports` (`roster(sessionId)`, `onRosterChanged(listener)`) in `src/plugins/agents/contract.ts` ← 07
- `ComposerStop` (`enter(sessionId, exits): boolean`, `leave(sessionId)`), `ComposerStopExits` (`toEntries()`,
  `toBox(how)`) and `ChatComposerPart.stop?: ComposerStop` in `src/plugins/chat/contract.ts` ← 06
- `ChatPageExports.addComposerPart`, `KeysPageExports.anchor` / `keysFor`, `sessions.sessionAdded`,
  `sessions.sessionRemoved`, `ChatMainExports.launch` / `closeSessionsIn`, `SessionsMainExports.activate`,
  `MAIN_AGENT_ID`, `FAKE_AGENTS_TEXT`, `CHAT_PREVIEW_HOST_ID` and `ChatAgentEvent` in `src/plugins/chat/contract.ts`
  (tree today)
- the layout registration shape 07 settles: a main part that only registers layouts (and hands a script) ← 07

Produces:
- `export const agentStripManifest` in `src/plugins/agent-strip/manifest.ts` (id `agent-strip`, scope `strip`)
- `export const agentStripMainPart: MainPart<typeof agentStripManifest>` in `src/plugins/agent-strip/main/start.ts`
- `export function agentStripSelfTestScript(deps: AgentStripSelfTestDeps): SelfTestScript` in
  `src/plugins/agent-strip/main/selftest-script.ts`
- `export const agentStripPagePart: PagePart<typeof agentStripManifest>` in `src/plugins/agent-strip/page/start.ts`
- in `src/plugins/agent-strip/page/strip-boxes.ts` (pure):
  ```ts
  export type StripBox =
    | { kind: 'agent'; key: string; agent: RosterAgent }   // key: agentId
    | { kind: 'task'; key: string; task: RosterTask };     // key: taskId
  export function orderStripBoxes(roster: Roster): StripBox[];
  export function entryIndex(boxes: readonly StripBox[]): number | null;
  export function stepIndex(index: number, delta: -1 | 1, count: number): number;
  export function reselect(selectedKey: string, lastIndex: number, boxes: readonly StripBox[]): number | null;
  export function boxLook(outcome: RosterOutcome): { dot: 'running' | 'success' | 'error'; isDimmed: boolean };
  export function agentMeta(agent: RosterAgent): string;
  export function taskOwner(task: RosterTask, agents: readonly RosterAgent[]): string;
  ```
- `export function createAgentStrip(deps: AgentStripDeps): AgentStrip` in `src/plugins/agent-strip/page/agent-strip.ts`,
  where `AgentStrip` is `{ part: ChatComposerPart; prevBox(): void; nextBox(): void; leave(): void; toBox(how: 'insert' | 'append'): void; toggleBox(): void; setLayouts(shown: ShownLayouts<Layout>): void; forget(sessionId: string): void }`
- the Layout contract in `src/plugins/agent-strip/layouts/layout.d.ts` (below)

Decisions:
- **Main part.** As 07 settles for agent-lines, agent-strip has a main part that registers its layouts
  (`api.layouts.register({ layoutTypes })`) and hands its self-test script. It is not page-only.
- **Manifest.** `id: 'agent-strip'`, `dependsOn: ['agents', 'chat', 'sessions', 'keys']`, `scopes: { strip: 'In the agent strip' }`,
  `settings: { layout: 'default' }`, `settingInfo.layout`: label `Layout`, description
  `The agent-strip layout the boxes above the Chat composer draw in: a folder name in agent-strip's layouts folder, or default.`,
  `themeTokens: {}`. Commands, each `group: 'agent strip'`, `runsIn: 'page'`: `prevBox` (`previous box`), `nextBox`
  (`next box`), `leave` (`back to the entries`), `focusBox` (`type a message`), `appendBox` (`type after the message`),
  `toggleBox` (`open or close the box`).
- **Keys** (`src/plugins/keymap.ts`, a new `// Agent strip` banner section after chat's), scope `agent-strip.strip`:
  `h` → `agent-strip.prevBox`, `l` → `agent-strip.nextBox`, `k` → `agent-strip.leave`, `i` → `agent-strip.focusBox`,
  `a` → `agent-strip.appendBox`, `<CR>` → `agent-strip.toggleBox`, and `<Esc>` → `agent-strip.leave` as a second bind
  of the same command (the user's answer, 2026-11-02). `<Esc>` is in
  `VIM_KEYS` and takes no anchor. They follow `docs/keymap.md` § Layers (raw keys on
  the focused scope, hjkl the direction, `i`/`a` enter the box, Enter acts). No leader group: `docs/keymap.md` needs no
  row. `h`, `l`, `k` and `<CR>` are in `VIM_KEYS` (`src/plugins/keys/page/vim-keys.ts`) and take no anchor. `i` and
  `a` take anchors: the default layout's selected box draws a cursor prompt line, `kit.keyHint(line, 'focusBox', { label: 'to type' })`
  and `kit.keyHint(line, 'appendBox', { label: 'to append' })`, the kit's scope `agent-strip.strip` (chat's bar uses the
  same labels). The self-test enters the strip, so the placement check sees both anchors.
- **The part and its stop.** The page part adds one composer part `{ id: 'agent-strip.strip', build, stop }` through
  `chat.addComposerPart`. Page part order (`src/plugins/page.ts`): agent-strip right after workflow, so the workflow
  strip draws above the agent strip. Main order and `builtInManifests`: right after agent-lines (07).
- **What the strip draws.** `build(parent, sessionId)` holds the wrapper per session (a later build of the same session
  replaces the held one, as `roster-lines.ts` does). While the session's roster lists no box, the wrapper holds
  nothing. Else it holds one HScroller, kept across redraws so the user's scroll position and the chevrons survive the
  once-a-second tick and each roster change:
  - The first draw with a box creates it (`createHScroller()`) and appends its `element` to the wrapper.
  - Each redraw disposes the box parts, empties `track`, draws each box part into `track` in `orderStripBoxes` order,
    then calls `refresh()`. It does not create a new HScroller, so `scrollLeft` stays.
  - A draw that finds no box disposes the HScroller and removes its `element`; the next draw with a box creates a new
    one. A later build of the same session and `dispose` dispose it too.
  - After a selection change it calls `reveal(<selected box element>)`.
  `dispose` disposes the box parts and the HScroller. The strip reads the
  roster only through `AgentsPageExports`: `roster(sessionId)` at build, and `onRosterChanged(id)` redraws that
  session.
- **Box inputs** (the Layout contract):
  ```ts
  export type BoxStatus = 'running' | 'success' | 'error';            // boxLook(outcome).dot
  export interface ToolLineInput { tool: string; summary: string; status: BoxStatus }
  export interface AgentBoxInput {
    name: string; meta: string; description: string;
    recentTools: readonly ToolLineInput[];   // the latest 3, oldest first
    status: BoxStatus; isDimmed: boolean; isSelected: boolean; isOpen: boolean;
  }
  export interface TaskBoxInput {
    description: string; owner: string; elapsedMs: number | null; command: string | null;
    status: BoxStatus; isDimmed: boolean; isSelected: boolean; isOpen: boolean;
  }
  export interface ToolListInput { tools: readonly ToolLineInput[] }   // every tool call, oldest first
  export interface AgentStripKit extends BaseKit {}
  export interface AgentStripPart { element: HTMLElement }
  export interface Layout {
    agentBox?(parent: HTMLElement, input: AgentBoxInput, kit: AgentStripKit): AgentStripPart;
    taskBox?(parent: HTMLElement, input: TaskBoxInput, kit: AgentStripKit): AgentStripPart;
    toolList?(parent: HTMLElement, input: ToolListInput, kit: AgentStripKit): AgentStripPart;
  }
  export interface CompleteLayout extends Required<Layout> {}
  ```
  The contract's header comment says what the app keeps: the selection, the open box, the key scope, the HScroller
  (scrolling, chevrons, reveal) and the once-a-second redraw; a box's click; no focus (the selected box shows the focus
  ring through `isSelected`). `toolList` draws into the open agent box's own root, after `agentBox` returns it. A task
  box draws its `command` itself while `isOpen` (`no command` when null).
- **Default look** (`layouts/default/layout.js`, `agent-strip.css`; DESIGN.md § Surfaces, Chat): each box a
  `kit.card` (`card-background`, `radius-md`) of fixed width. Agent box: `kit.statusDot` in `status`, the name, the
  meta in `fg-tertiary`, the description cut to one line, the recent tools as mono lines. Task box: `kit.icon` terminal,
  the description, `<owner> · <kit.duration(elapsedMs)>` (owner alone when `elapsedMs` is null). `isDimmed` sets class
  `is-dimmed` (text in `fg-tertiary`); `isSelected` sets `is-selected` with the focus ring (`focus-border`) and draws the
  `i`/`a` cursor prompt line. Classes `agent-strip-*`; rules select under
  `[data-layout-owner='agent-strip'][data-layout='default']`; tokens only (`npm run lint` style check).
- **Pure rules** (`strip-boxes.ts`):
  - `orderStripBoxes`: every agent, then every task, stable-sorted by `startedAt`; equal times keep agents first.
  - `entryIndex`: the first box whose outcome is `'running'`, else 0; null for no box.
  - `stepIndex`: `index + delta` clamped to `0 … count - 1`.
  - `reselect`: the index of `selectedKey` in `boxes`; when gone, `min(lastIndex, boxes.length - 1)`; null for no box.
  - `boxLook`: `running` → `{ dot: 'running', isDimmed: false }`; `done` → `{ dot: 'success', isDimmed: true }`;
    `failed` → `{ dot: 'error', isDimmed: true }`.
  - `agentMeta`: `[model, effort, cost]` without nulls, joined with ` · `, cost `$` + `spendUsd.toFixed(2)`; `''` when all
    are null.
  - `taskOwner`: `main` when `task.agentId === MAIN_AGENT_ID`; else the `name` of the roster agent with that id; else
    `subagent`. The last case is reached by a running task whose owning subagent finished and was dropped by a
    `userMessage` (task 04 keeps the task, drops the agent): its box then says `subagent` (the user's answer, 2026-11-02).
- **Keys at run time.** `stop.enter(sessionId, exits)`: no box → return false; else select `entryIndex`, keep
  `{ sessionId, exits }` as the active stop, `api.keys.setScope('strip')`, redraw, reveal, log, return true.
  `prevBox`/`nextBox` step the selection (`stepIndex`) and log only when it moved. `leave` (k) clears the selection,
  then `exits.toEntries()`. `focusBox`/`appendBox` clear it, then `exits.toBox('insert' | 'append')`. `toggleBox`
  toggles the selected box open. `stop.leave(sessionId)` (chat moved the cursor) clears the selection and sets no
  scope. A roster change while selected re-selects by `reselect`; when it returns null, the strip clears the selection
  and calls `exits.toEntries()`. A command with no active stop does nothing.
- **The open box.** One open box per session, by key. Enter toggles the selected box. Opening one closes the last. It
  stays open across moves and leaving the strip, and closes when its box leaves the roster.
  - A mouse click on a box (the user's answer, 2026-11-02): toggles that box open
    or closed and changes nothing else. The selection stays where it was, the strip's scope is not entered, and focus
    does not move (the box takes no focus), because only `j` gives a composer part the cursor (task 06).
  - The open box's height (the user's answer, 2026-11-02): the default layout
    caps the open box's tool list at `max-height: calc(var(--wg-space-6) * 8)` with `overflow-y: auto`, each tool line
    one line ellipsized; the track has `align-items: flex-start`, so the other boxes keep their own height. No new
    token (`--wg-space-6` exists). `.agent-strip-tool` is in
    `scrollsItself` (it ellipsizes); the tool list scrolls itself, so `.agent-strip-toolList` joins it too.
- **Time.** A task box's `elapsedMs` is `now - startedAt` while it runs and null once finished: `RosterTask` carries
  no end time. One timer redraws every held strip once a second (`TICK_MS = 1000`) while any held strip shows a running
  task box, and clears when none does.
- **Logs** (`[agent-strip]`, `<name>` the side-bar label from `sessions.sessionAdded`, else the id):
  - `boxes in <name>: <count> (<running> running)` is a state line, drawn again every second: it logs only when its
    text changes for that session. A session's first draw with 0 boxes logs nothing; `boxes in <name>: 0 (0 running)`
    logs only after a non-zero count for that session.
  - Event lines log on every occurrence, with no dedupe: `selected box <n> of <count> in <name>` (1-based, on enter and
    each move that moved; `h` at the first box and `l` at the last log nothing), `opened box <n> in <name>`,
    `closed box <n> in <name>`, `left strip in <name>` (k, i, a, or chat's `leave`).
- **Self-test** (agent-strip's own script, since its main part exists; keys' steps live in forms' script only because
  keys has no session fixture). Project `agent-strip-selftest` under the self-test home; `open` calls
  `chat.closeSessionsIn(projectDir)`, then `chat.launch` with first message `agent-strip self-test`, then
  `sessions.activate`; `shownLine` `[chat] Chat tab shown in agent-strip-selftest`. One group `strip keys`, why
  `j from the last entry enters the strip on its first running box, l and h move between boxes, Enter opens and closes a box, k hands the cursor back, an interrupt leaves the finished boxes dimmed and the next message drops them.`
  Steps, `N` = `agent-strip-selftest`:
  1. keys `['i', ...FAKE_AGENTS_TEXT, 'Escape', 'Enter']` → `[agent-strip] boxes in N: 4 (4 running)`, `checksFit: true`,
     screenshot `strip`.
  2. keys `['Escape', 'G', 'j']` → `[agent-strip] selected box 1 of 4 in N`, `alsoExpect`
     `[chat] composer part agent-strip.strip took the cursor in N` (task 06's handover proof), screenshot
     `strip-selected`.
  3. `['l']` → `[agent-strip] selected box 2 of 4 in N`.
  4. `['h']` → `[agent-strip] selected box 1 of 4 in N`.
  5. `['Enter']` → `[agent-strip] opened box 1 in N`, screenshot `strip-opened`.
  6. `['Enter']` → `[agent-strip] closed box 1 in N`.
  7. `['k']` → `[agent-strip] left strip in N`, `alsoExpect` `[chat] cursor back on the entries in N`.
  8. `['<C-c>']` → `[agent-strip] boxes in N: 4 (0 running)`, screenshot `strip-finished`.
  9. keys sending `strip cleared` as step 1 sends → `[agent-strip] boxes in N: 0 (0 running)`.
  `scrollsItself`: the box text classes that ellipsize (`.agent-strip-name`, `.agent-strip-description`,
  `.agent-strip-meta`, `.agent-strip-tool`), `.agent-strip-toolList`, the HScroller's track class 02 names,
  `.chat-activity-step`.
  Step 2's keys rest on 06's last-stop rule (the user's answer, 2026-11-02): when the fake
  turn's last run is open, `G` lands on its line and `j` walks its steps first, so step 2 presses `j` once per step
  after the line. Read the landed rule and the fake turn's entries, then fix the keys, not the expect.
- **Preview.** AGENTS.md § Architecture (A layout) requires a preview under `Space z l` for a view that needs agent
  data. agents' `Space z l a` row has no Chat tab, so the strip previews in chat's `Space z l c` sample session instead.
  - The events: `previewAgentEvents(at: number): AgentEvent[]` in `src/plugins/chat/main/preview/preview-agent-events.ts`
    (pure) lists two subagents (one running with three tool calls and an `agentReplied`, one finished `done`) and one
    running task with a command, in event order.
  - The emit: `agentEvent` is a chat main event (`chat-sessions.ts` emits it; agents main hears `chat.agentEvent`).
    `ChatPreviewDeps` gains `emit: (event: 'agentEvent', data: ChatAgentEvent) => void`, which chat main's `start.ts`
    wires to `api.events.emit` as it does for chat-sessions. `open()` emits each listed event once, after
    `sessionStarted`, with `{ sessionId: <the preview's row id>, profileDir: null, hostSessionId: CHAT_PREVIEW_HOST_ID,
    event }`. `profileDir` is null: the preview runs no profile folder (`PREVIEW_PROFILE` is a name), and
    `ChatAgentEvent.profileDir` allows null.
  - The listeners: agents main folds them like any session, so the strip draws them. agents main's `chat.agentEvent`
    listener skips `agentLog.append` when `hostSessionId === CHAT_PREVIEW_HOST_ID`, so a preview leaves no log file
    (agents may import `src/plugins/chat/contract.ts`). usage main reads only `usage` events, which the list holds
    none of; workflow main maps events of workflow sessions only, and the preview row is none.
  - The end: the preview ends its sample session as today. agents main drops the row's roster on `sessions.closed` /
    `sessions.ended`, as for any row (task 04's `sessionEnded` marks running items `failed`; it does not clear).
  - The test: `chat-preview.test.ts` asserts that `open()` emits the list's events in order with the payload above, and
    that the list holds two `agentSpawned`, one `agentFinished` (`done`), one `agentReplied` and one `taskStarted` with
    a command. The test does not fold: `src/plugins/chat/main` may not import `src/plugins/agents/roster.ts`
    (`scripts/check-layers.mts`), and chat names no other plugin (plan.md boundary rule). Task 11's live check 7 shows
    the folded strip.
  - Add a `chat-preview` screenshot step only if chat's script already saves `chat-chat-preview`: then that screenshot
    shows the strip.
- **LAYERS:** add `src/plugins/agent-strip` (`src/contracts`, `src/shared`), `src/plugins/agent-strip/layouts`
  (`src/shared/page/layout-host`), `src/plugins/agent-strip/main` (`src/contracts`, `src/shared`,
  `src/plugins/agent-strip`, `src/plugins/agent-strip/layouts`, `src/plugins/chat/contract.ts`,
  `src/plugins/sessions/contract.ts`), `src/plugins/agent-strip/page` (`src/contracts`, `src/shared`, `src/shared/page`,
  `src/shared/page/ui`, `src/shared/page/layout-host`, `src/plugins/agent-strip`, `src/plugins/agent-strip/layouts`,
  `src/plugins/agents/contract.ts`, `src/plugins/chat/contract.ts`, `src/plugins/sessions/contract.ts`,
  `src/plugins/keys/contract.ts`); add the plugin and its `main` to `src/plugins/main.ts`'s entry, it and its `page` to
  `src/plugins/page.ts`'s, it to `src/plugins/manifests.ts`'s.

GIVEN a roster of a done subagent, a running subagent and a running task WHEN `j` leaves the last entry THEN the
running subagent's box is selected and the strip's scope is in force.
GIVEN the selected box is the first WHEN `h` runs THEN the selection stays and nothing is logged.
GIVEN the strip is selected WHEN the next `userMessage` empties the roster THEN the strip draws nothing and the cursor
is back on the last entry.
GIVEN a running task box shows WHEN a second passes THEN its elapsed time redraws; once no running task box shows, no
timer is pending.

Tests:
- `strip-boxes.test.ts`, one `it.each` table per function:
  - `orderStripBoxes`: start order across kinds; equal `startedAt` keeps the agent first; empty roster → `[]`.
    Catches tasks grouped after agents.
  - `entryIndex`: first running in the middle; none running → 0; no boxes → null. Catches entry on a finished box.
  - `stepIndex`: `0, -1, 4` → 0; `3, 1, 4` → 3; `1, 1, 4` → 2. Catches running off either end.
  - `reselect`: key kept at a new index; key gone, last index past the end → last box; empty → null.
  - `boxLook`: the three outcomes as listed above. Catches a finished box drawn undimmed.
  - `agentMeta`: all three → `claude-sonnet-4-5 · high · $0.42`; no effort → `claude-sonnet-4-5 · $0.42`; all null →
    `''`. Catches a dangling separator.
  - `taskOwner`: main; a listed subagent's name; an unlisted id → `subagent`.
- `agent-strip.test.ts` (fake DOM, fake timers, recording anchors as `roster-lines.test.ts` does):
  - `enter_NoBoxes_ReturnsFalse` and `enter_WithBoxes_SelectsAndSetsScope` — catches `j` entering an empty strip.
  - `leave_HandsCursorBackThroughExits` (k → `toEntries`; i → `toBox('insert')`; a → `toBox('append')`, one table).
  - `rosterEmptiesWhileSelected_ReturnsToEntries`.
  - `toggleBox_DrawsToolListInOpenAgentBox` — the open agent box holds a `toolList` part listing every tool.
  - `tick_RunningTaskShown_RedrawsAndStopsWhenNone`.
  - `build_UserLayoutThrows_DrawsDefault` for each part (`it.each` over `agentBox`, `taskBox`, `toolList`).
  - `prevBox_AtFirst_LogsNothing` — `h` on box 1 keeps the selection and logs no line.
  - `toggleBox_OpensOneAtATime` — Enter on box 1 then on box 2 (after `l`): box 2 open, box 1 closed; the log has
    `opened box 1`, then `opened box 2`; a click on an unselected box toggles it and leaves the selection (the user's answer, 2026-11-02).
  - `rosterDropsOpenBox_Closes` — the open box's item leaves the roster: no box is open.
  - `stopLeave_ClearsWithoutScope` — `stop.leave(sessionId)` clears the selection, logs `left strip`, and sets no
    scope.
  - `redraw_KeepsScrollerAndItsScrollLeft` — a roster change and a tick keep the same HScroller `element` and its
    `scrollLeft`; an empty roster removes it, and the next box makes a new one.
  - `log_$case` (it.each) — the first empty draw logs no `boxes` line; 4 boxes then 0 logs `boxes in N: 0 (0 running)`;
    an unchanged `boxes` text across a tick logs once; `left strip` twice (enter, k, enter, k) logs twice.
- `strip-boxes.test.ts`, `entryIndex` gains the row: a done subagent, then a running subagent, then a running task →
  1.
- `layouts/default/layout.test.ts` (new; chat's `layout.test.ts` is the pattern): `agentBox_$case` and `taskBox_$case`
  (it.each) — `isDimmed` sets `is-dimmed`; `isSelected` sets `is-selected` and draws the `focusBox` and `appendBox` key
  hints; not selected draws neither; a task box with `isOpen` draws its `command`, or `no command` when it is null.
  Catches a lost anchor now that the placement check runs only on the user's ask.
- `main/start.test.ts`: `start_RegistersLayoutsAndHandsScript`, as 07's.
- `agents/main/start.test.ts`: `previewEvents_NoLogWritten` — a `chat.agentEvent` whose `hostSessionId` is
  `CHAT_PREVIEW_HOST_ID` folds into the roster and calls no `agentLog.append`; another host's event still appends.

Done when: `npm run lint` passes; the tests above pass; `npm run selftest -- --plugin agent-strip` passes (group
`strip keys`). The end-of-run placement check runs only in a whole self-test run, which runs only on the user's ask
(AGENTS.md § Running and testing); task 11 lists it for the user's ask.
Commit: one commit for the group.

Runtime looks for task 11: screenshots `agent-strip-strip`, `agent-strip-strip-selected`, `agent-strip-strip-opened`,
`agent-strip-strip-finished` against DESIGN.md § Surfaces, Chat (cards, dim finished boxes, focus ring, the `i`/`a`
prompt); the strip below the workflow strip; chevrons at a narrow width with more boxes than fit; trackpad scrolling,
which only the user's hands can check.

## Proof

