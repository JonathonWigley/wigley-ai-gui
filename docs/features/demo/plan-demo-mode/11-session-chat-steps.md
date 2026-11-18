# 11 — Session card and chat steps

Status: not started
Type: Parallel
Rung: deep · crosses chat, sessions and agents through the async session lifecycle (turn ends, held compactions, held rosters) and changes what agents writes to its log
Wave: 2 · Depends on: 01, 02 (both modify `src/plugins/chat/page/start-prompt.ts`, its test and `src/plugins/chat/main/start.ts`), 04 (both modify `src/plugins/sessions/page/start.ts`)
Plan: [plan.md](plan.md)

The demo steps of section `sessions` for seven plugins: sessions, chat, agent-strip, agents,
agent-lines, visual, auto-compact, and the sessions plugin's skip of demo rows in its saved
recency and panes. One reference pattern, then each plugin's own values.

No step here holds `showOnly` or relies on it (the Demo section's hold is 07's), so 04 is not a
dependency. Task 04 also modifies `wigley-ai-gui/src/plugins/sessions/page/start.ts`, in Wave 1:
the worker of this task builds on 04's change to that file.

Files paths are written from the `ai` repo root; every other path is relative to `wigley-ai-gui/`.

Files:
- create `wigley-ai-gui/src/plugins/sessions/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/sessions/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/sessions/page/start.ts` · modify `wigley-ai-gui/src/plugins/sessions/main/start.ts` · modify `wigley-ai-gui/src/plugins/sessions/page/session-recency.ts` · test `wigley-ai-gui/src/plugins/sessions/page/session-recency.test.ts` · modify `wigley-ai-gui/src/plugins/sessions/page/pane-sessions.ts` · test `wigley-ai-gui/src/plugins/sessions/page/pane-sessions.test.ts`
- create `wigley-ai-gui/src/plugins/chat/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/chat/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/chat/page/start.ts` · modify `wigley-ai-gui/src/plugins/chat/main/start.ts` · modify `wigley-ai-gui/src/plugins/chat/page/start-prompt.ts` · test `wigley-ai-gui/src/plugins/chat/page/start-prompt.test.ts`
- create `wigley-ai-gui/src/plugins/agent-strip/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/agent-strip/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/agent-strip/page/start.ts` · modify `wigley-ai-gui/src/plugins/agent-strip/main/start.ts`
- create `wigley-ai-gui/src/plugins/agents/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/agents/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/agents/page/start.ts` · modify `wigley-ai-gui/src/plugins/agents/main/start.ts` · modify `wigley-ai-gui/src/plugins/agents/main/preview.ts` · modify `wigley-ai-gui/src/plugins/agents/manifest.ts` · test `wigley-ai-gui/src/plugins/agents/main/start.test.ts`
- create `wigley-ai-gui/src/plugins/agent-lines/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/agent-lines/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/agent-lines/page/start.ts` · modify `wigley-ai-gui/src/plugins/agent-lines/main/start.ts`
- create `wigley-ai-gui/src/plugins/visual/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/visual/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/visual/page/start.ts` · modify `wigley-ai-gui/src/plugins/visual/main/start.ts` · modify `wigley-ai-gui/src/plugins/visual/manifest.ts`
- create `wigley-ai-gui/src/plugins/auto-compact/page/start.ts` · create `wigley-ai-gui/src/plugins/auto-compact/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/auto-compact/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/auto-compact/main/start.ts` · modify `wigley-ai-gui/src/plugins/auto-compact/manifest.ts`

The page parts list is not in this task's Files: 07 owns the part lists and adds the new
`autoCompactPagePart` to it. See Produces.

Consumes:
- `DemoStep`, `DemoStage`, `DemoBeat`, `DemoPageContext`, `DemoMainStep`, `DemoMainStage`, `DemoMainContext`, `DEMO_HARNESS_ID`, `DEMO_PROFILE` from `src/contracts/demo.ts` ← 01
- `PageServices.demoSteps: DemoStepRegistry<DemoStep>`, `MainServices.demoSteps: DemoStepRegistry<DemoMainStep>` ← 01
- in the tree: `SessionsPageExports.activate` (`src/plugins/sessions/contract.ts:668`); `ChatMainExports.send` (`src/plugins/chat/contract.ts:750`); `ChatSessions.interrupt` (`src/plugins/chat/main/chat-sessions.ts:323`); `ChatPageExports.fillComposer`, `setHeadless` (`src/plugins/chat/contract.ts:964`, `969`); `EditorHost.typeInto` (`src/contracts/editor.ts:206`); `agentStripToggleBoxAtCommand` (`src/plugins/agent-strip/contract.ts:5`); `agentsRostersSlot` (`src/plugins/agents/contract.ts`); `sessionsRowsSlot` (`src/plugins/sessions/contract.ts:732`); `isFakeAgentHarness`, `FakeAgentHarness.holdCompactions`/`releaseCompactions`, the `FAKE_*_TEXT` triggers (`src/shared/fake-agent-harness.ts`); `SAMPLE_MOCKUP_VISUAL`, `SAMPLE_FLOWCHART_VISUAL` (`src/shared/sample-visuals.ts:5`, `54`); `VisualOverlay.open/close` (`src/plugins/visual/page/visual-overlay.ts:21`)

Produces:
- In each plugin above: `export function registerDemoSteps(services: PageServices, deps: <Plugin>DemoPageDeps): Disposable` in `src/plugins/<id>/page/demo-steps.ts`, and `export function registerDemoSteps(services: MainServices, deps: <Plugin>DemoMainDeps): Disposable` in `src/plugins/<id>/main/demo-steps.ts`. `<Plugin>DemoPageDeps` and `<Plugin>DemoMainDeps` are interfaces in the same file, holding only the deps the table below names for that plugin.
- `export const autoCompactPagePart: PagePart<typeof autoCompactManifest>` in `src/plugins/auto-compact/page/start.ts`. The task that owns `src/plugins/page.ts` (07) imports it and adds it to the page parts list, in the slot after `agentsPagePart`.
- `export function sampleRoster(now: number): Roster` in `src/plugins/agents/main/preview.ts` (the existing function, exported).
- The step ids, each registered once as a page half and, where the table says so, as a main half under the same id: `sessions.cards`, `sessions.panes`, `chat.transcript`, `chat.composer`, `chat.controls`, `chat.startPrompt`, `chat.headless`, `agent-strip.strip`, `agents.roster`, `agent-lines.lines`, `visual.visuals`, `auto-compact.compact`.

## Reference pattern (every plugin in this task)

- `page/demo-steps.ts` registers each `DemoStep` through `services.demoSteps.register` and returns
  one Disposable over every registration. The plugin's `page/start.ts` calls it once in `start`,
  after the objects the deps name exist. The registry disposes the registrations when the plugin
  stops (01), so `start.ts` keeps no handle.
- `main/demo-steps.ts` does the same for each `DemoMainStep`, called from `main/start.ts`.
- A main half `enter` launches its demo sessions only through `context.launchSession(text)`, one
  call per key, and resolves `{ sessions: { <key>: <session id> }, dispose }`. It never calls
  `chat.launch` itself, so every session is ephemeral, on `DEMO_PROFILE`, in `context.scratchDir`.
- A main stage's `dispose` undoes what the main half did beyond the launch (a held compaction, a
  held roster, a slot key). It does not close the sessions: when the run leaves a step, the demo
  main (06) disposes the page stage, then the main stage, then closes every session id in the main
  stage's `sessions` map with chat's `close(id, 'finished')`.
- A page half `enter` reads `context.sessions[<key>]` and returns a `DemoStage`. Each beat's `show`
  is idempotent and reaches its state from any other beat of the step, so next, previous and a
  jump all land on the same screen. A beat that shows one session calls
  `sessions.activate(sessionId)` (the sessions page export), which shows Sessions mode
  (`src/plugins/sessions/contract.ts:668` and its handler at `src/plugins/sessions/page/start.ts`).
- The page stage's `dispose` closes what the page half opened (an overlay, a picker, a split pane,
  an open strip box), and nothing more.
- No step reads or writes the user's real state (design.md § Real state stays untouched): the
  samples are fake-harness sessions and in-memory builders, and the safety changes below keep
  demo sessions out of the files agents writes.
- Copy below is verbatim: titles, captions, beat names, launch texts, log lines and toasts.

## Steps by plugin (section `sessions` for every step)

| Step id | order | title | caption |
|---|---|---|---|
| `sessions.cards` | 10 | `Session cards` | `Every agent session has a card in the side bar that shows what it is doing.` |
| `sessions.panes` | 20 | `Panes` | `Sessions split into panes, side by side or stacked, each pane with its own tabs.` |
| `chat.transcript` | 30 | `Transcript` | `The transcript draws every kind of entry an agent writes.` |
| `chat.composer` | 40 | `Message box` | `The message box queues messages while the agent works, interrupts it, and completes slash commands.` |
| `chat.controls` | 50 | `Session controls` | `Control chips set the session's permission mode, effort, model and verbosity.` |
| `chat.startPrompt` | 60 | `Start prompt` | `The start prompt starts a session in a project or folder, or resumes a saved one.` |
| `chat.headless` | 70 | `Headless sessions` | `A headless session works without asking the user, and its chip says so.` |
| `agent-strip.strip` | 80 | `Agent strip` | `The agent strip above the message box shows each running subagent and task.` |
| `agents.roster` | 90 | `Subagents and tasks` | `Each session keeps a roster of its subagents and background tasks, with their tools, models and spend.` |
| `agent-lines.lines` | 100 | `Agent lines` | `A working line under each session card names the subagents and tasks it runs.` |
| `visual.visuals` | 110 | `Visuals` | `HTML an agent writes draws as a live visual, with a full-size view.` |
| `auto-compact.compact` | 120 | `Auto compact` | `A session whose prompt cache went cold compacts before the next message.` |

### sessions

- `sessions.cards`
  - files: `src/plugins/sessions/page/sidebar-view.ts`, `src/plugins/chat/page/chat-state.ts`, `src/plugins/sessions/layouts/default/layout.js`
  - main half, keys in launch order:
    - `done` ← `Summarise the last commit.` (an echo turn; it ends while another row is focused, so the row shows `done`, `src/plugins/chat/page/chat-state.ts:51`)
    - `working` ← `FAKE_HOLD_TEXT`
    - `waiting` ← `FAKE_PERMISSION_TEXT`
    - `error` ← `FAKE_HOLD_TEXT`, then `context.processEvents(error).ended({ code: 1, error: 'The agent process exited with code 1.' })` once `launchSession` resolved. A process that rests while its turn runs leaves `unseen` at `error` (`unseenAfterRest`, `src/plugins/chat/page/chat-state.ts`).
  - beats: `working` activates `working`; `needs you` activates `waiting`; `done` activates `waiting`; `error` activates `waiting`. The `done` and `error` beats keep the pane on `waiting`, so those two cards stay unviewed and keep their words.
- `sessions.panes`
  - files: `src/plugins/sessions/page/pane-sessions.ts`, `src/shared/page/pane-tree/pane-tree.ts`
  - main half keys: `first` ← `Map the session list.`; `second` ← `Review the open diff.`; `third` ← `Draft the release notes.`
  - page deps (`SessionsDemoPageDeps`): `activate` (the exports' `activate`), `panes: Pick<…, 'split' | 'load' | 'close'>` (the `view.panes` object of `src/plugins/sessions/page/start.ts`), `closeWaiting()` (the existing function the pane keys call).
  - beats:
    - `side by side`: close every pane this stage split; activate `first`; `panes.split('row')`; `panes.load(pane, second)`; `activate(second)`; `closeWaiting()`. These are the calls `split` and the split picker's `chosen` make (`src/plugins/sessions/page/start.ts:1062-1064`, `1104-1113`), with no picker.
    - `stacked`: the `side by side` state, then `panes.split('column')` on the focused pane, `panes.load(pane, third)`, `activate(third)`.
    - A `split` that returns null logs `demo panes: pane too small to split` and the beat shows what it has.
  - dispose: `panes.close(id)` for each pane the stage split, newest first.
- Demo rows leave no saved trace in the sessions page's `uiState` (a row is a demo row when
  `row.harness === DEMO_HARNESS_ID`):
  - **Recency** (`src/plugins/sessions/page/session-recency.ts`): `rowsChanged` drops every demo
    row from `before` and `after` before it compares them, so a demo row is never stamped, never
    moves or drops a stamp, and never stamps its project (the scratch folder). `stampsOf` then finds
    no stamp for a demo row, and the side bar orders it as a row with no stamp. A change made only of
    demo rows alters nothing, so nothing is saved to the `recency` or `projectRecency` entries.
  - **Panes** (`savedPaneSessions`, `src/plugins/sessions/page/pane-sessions.ts:202`): a pane that
    shows a demo row saves `null`, as an empty pane does, so a restart after a stopped or crashed
    demo opens that pane empty instead of on a session id no harness holds.

### chat

- Main deps (`ChatDemoMainDeps`): `chat: Pick<ChatSessions, 'send' | 'interrupt'>` (the `chat` object of `src/plugins/chat/main/start.ts:390`).
- Page deps (`ChatDemoPageDeps`): `activate` (the sessions page export chat already holds), `fillComposer`, `setHeadless` (the same functions the exports object at `src/plugins/chat/page/start.ts:403-418` builds), `typeInto: EditorHost['typeInto']` (`services.editor`), `openStartPrompt()` (`startPrompt.open()`), `pickModel(sessionId)` (the code path the `pickModel` command runs, aimed at `sessionId`), `cancelPicker()` (chat's list picker `cancel()`), `isPickerOpen()` (its `isOpen()`).
- `chat.transcript`
  - files: `src/plugins/chat/page/entry-list.ts`, `src/plugins/chat/layouts/default/layout.js`
  - main keys: `blocks` ← `FAKE_BLOCKS_TEXT`; `steps` ← `FAKE_STEPS_TEXT`; `permission` ← `FAKE_PERMISSION_TEXT`
  - beats: `markdown` activates `blocks`; `tools and thinking` activates `steps`; `permission` activates `permission`
- `chat.composer`
  - files: `src/plugins/chat/page/composer-kit.ts`, `src/plugins/chat/page/chat-commands.ts`
  - main keys:
    - `queued` ← `FAKE_HOLD_TEXT`, then `chat.send(queued, { text: 'Then run the tests.', images: [] })`; the send queues, since the turn runs (`src/plugins/chat/contract.ts:747-749`)
    - `interrupted` ← `FAKE_HOLD_TEXT`, then `chat.interrupt(interrupted)`
    - `slash` ← `Plan the next change.`
  - beats:
    - `queued` activates `queued`
    - `interrupted` activates `interrupted`
    - `slash commands`: `fillComposer(slash, '')` (shows the Chat tab, box focused in insert mode), then `typeInto(<the focused element>, ['/'])` when `services.editor.contains(document.activeElement)`; else logs `demo composer: no box to type into`. A typed `/` is an `input.type` transaction, which opens the completion; `fillComposer` alone does not (`setText` dispatches `wigley.setText`, `src/renderer/codemirror-vim/codemirror-vim-host.ts:308`).
  - dispose: `fillComposer(slash, '')` only when the stage typed into `slash`
- `chat.controls`
  - files: `src/plugins/chat/page/chat-view.ts`, `src/plugins/chat/page/picker.ts`
  - main key: `session` ← `Plan the next change.`
  - beats: `chips` cancels the picker when this stage opened it, then activates `session`; `model picker` activates `session`, then `pickModel(session)`
  - dispose: `cancelPicker()` when this stage opened the picker and `isPickerOpen()`
- `chat.startPrompt`
  - files: `src/plugins/chat/page/start-prompt.ts`, `src/plugins/chat/page/start-prompt-items.ts`
  - no main half
  - beat: `start prompt` runs `openStartPrompt()` when `isPickerOpen()` is false
  - dispose: `cancelPicker()` when `isPickerOpen()`
- `chat.headless`
  - files: `src/plugins/chat/page/row-clock.ts`, `src/plugins/chat/page/chat-view.ts`
  - main key: `session` ← `Plan the next change.`
  - beats: `attended` activates `session`, then `setHeadless(session, false)`; `headless` activates `session`, then `setHeadless(session, true)`
- Start prompt while the demo runs, in `src/plugins/chat/page/start-prompt.ts`:
  - `openPrompt`: when `deps.harnesses().has(DEMO_HARNESS_ID)`, the context takes `projects: []` and `recent: []`, and the prompt logs `start prompt: the demo runs, projects and recent folders hidden`. With no projects the folder step opens (`src/plugins/chat/page/start-prompt.ts:218-222`), so the first step lists the resume sections' rows and `Other folder…` only.
  - `resumeSectionRow`: a row whose `profile` is `DEMO_PROFILE` is a sample (task 12 builds them). It logs `sample session <title> not resumed`, toasts `A sample session: the demo resumes nothing` (tone `info`), and resumes nothing.

### agent-strip

- `agent-strip.strip`
  - files: `src/plugins/agent-strip/page/agent-strip.ts`, `src/plugins/agent-strip/layouts/default/layout.js`
  - main key: `agents` ← `FAKE_AGENTS_TEXT`
  - page deps: `activate` (sessions page export), `runCommand` (`api.commands.run`), `firstAgentKey(sessionId): string | null` (the first agent's `agentId` in `agentsRostersSlot` for that session, from the roster agent-strip already reads at `src/plugins/agent-strip/page/start.ts:38`)
  - beats: `boxes` activates `agents`, and closes the box this stage opened, if any (`agentStripToggleBoxAtCommand` again); `box open` activates `agents`, then opens the first agent's box through `agentStripToggleBoxAtCommand` `{ sessionId, key }` when the stage holds no open box. A null key logs `demo strip: no agent box yet` and opens nothing.
  - dispose: closes the box this stage opened

### agents

- `agents.roster`
  - files: `src/plugins/agents/roster.ts`, `src/plugins/agents/main/preview.ts`
  - main deps: `clock`, `rosters` (the `rowRosters` writer, `src/plugins/agents/main/start.ts:62`), `holdSample(sessionId): Disposable` (below)
  - main key: `session` ← `Map every caller of the session list.`; then `holdSample(session)` and `rosters.set(session, sampleRoster(clock.now()))`
  - dispose: `rosters.delete(session)`, then the hold's dispose
  - page: `agents/page/start.ts` calls `registerDemoSteps(services, { activate })`; the manifest's `dependsOn.page` becomes `['sessions']`
  - beat: `roster` activates `session`
- Changes in `src/plugins/agents/main/start.ts`:
  - A session `holdSample` holds keeps its sample roster: the `chat.agentEvent` fold writes and deletes no `rowRosters` key for it until the hold's dispose. The fold still folds its events into `rosters`.
  - The agent log skips demo rows: the `chat.agentEvent` handler appends no line when `sessionsRowsSlot`'s row for `sessionId` has `harness === DEMO_HARNESS_ID`. The skip sits beside the `isPreviewHost` skip at `:85-89`.

### agent-lines

- `agent-lines.lines`
  - files: `src/plugins/agent-lines/page/working-lines.ts`, `src/plugins/agent-lines/layouts/default/layout.js`
  - main key: `agents` ← `FAKE_AGENTS_TEXT`
  - beat: `working line` activates `agents`
  - agent-lines is off by default; the run starts it in memory (01, 06), so the step needs no switch of its own.

### visual

- `visual.visuals`
  - files: `src/plugins/visual/page/html-fence.ts`, `src/plugins/visual/page/visual-overlay.ts`, `src/shared/sample-visuals.ts`
  - main key: `visual` ← `FAKE_VISUAL_TEXT`
  - page deps: `activate`, `overlay: Pick<VisualOverlay, 'open' | 'close'>` (the `overlay` of `src/plugins/visual/page/start.ts`); the manifest's `dependsOn.page` becomes `['sessions']`
  - beats: `inline` closes the overlay, then activates `visual`; `full size` activates `visual`, then `overlay.open([SAMPLE_MOCKUP_VISUAL, SAMPLE_FLOWCHART_VISUAL], 0)`; `next visual` does the same open at index 1
  - dispose: `overlay.close()`

### auto-compact

- New page part `src/plugins/auto-compact/page/start.ts`: `autoCompactPagePart` starts, calls `registerDemoSteps(api.services, { activate })` and returns `{ commands: {} }`. The manifest's `dependsOn.page` becomes `['sessions']`, and its comment drops "Main only: it has no surface and no layout" for a line that names the page part as the demo step's only.
- `auto-compact.compact`
  - files: `src/plugins/auto-compact/main/send-gate.ts`, `src/plugins/auto-compact/main/start.ts`
  - main deps: `chat: Pick<ChatMainExports, 'send'>`, `harnesses: AgentHarnessRegistry` (`services.agentHarnesses`), `onTurnFinished(listener: (finished: { sessionId: string; how: 'idle' | 'rested' }) => void): Disposable` (a listener on `chat.turnFinished`, which the part already hears at `src/plugins/auto-compact/main/start.ts:64`)
  - main half, in this order:
    1. Subscribe `onTurnFinished` before the first launch; keep the ids whose turn finished `idle` in a stage-local set. `idle(id)` resolves once the set holds `id`.
    2. `compacted` ← `FAKE_COLD_TEXT`; `await idle(compacted)`; `chat.send(compacted, { text: 'Carry on with the plan.', images: [] })`. The send gate holds the send and compacts first (`sendGateVerdict`, `src/plugins/auto-compact/main/send-gate.ts:37`).
    3. When `harnesses.get(DEMO_HARNESS_ID)` is a fake (`isFakeAgentHarness`), call its `holdCompactions()`; else log `demo compact: no demo harness to hold`.
    4. `held` ← `FAKE_COLD_TEXT`; `await idle(held)`; `chat.send(held, { text: 'Carry on with the plan.', images: [] })`. Its compaction stays open after `compactionStarted`.
    5. `cold` ← `FAKE_COLD_TEXT`; nothing more.
  - main dispose: `releaseCompactions()` when step 3 held them; the subscription's dispose
  - beats: `cold cache` activates `cold`; `compacting` activates `held`; `compacted` activates `compacted`

Decisions:
- Every session a step shows is a demo session the step launches; no step opens a layout preview (design.md § Rejected; seams map § 9).
- One beat shows one state that already exists, by activating its session: beats never act on a session in a way the previous beat cannot undo. Irreversible actions (the interrupt, the error end, the cold send) run in the main half at enter, each on a session of its own.
- The card step keeps the pane on `waiting` for the `done` and `error` beats: viewing a session clears its `done` and `error` words (`src/plugins/chat/page/chat-state.ts:39-44`).
- While the demo runs (the demo harness is registered), the start prompt hides the user's projects and recent folders and resumes no sample row, for any opener, not only the start-prompt step: the side bar hides real sessions the same way for the whole run (plan.md Decisions).
- The session hub, the details and the sections keep the user's own show and fold state; no step here toggles them.
- The sessions page skips demo rows in its saved recency and panes (plan.md ruling: no demo row in recency or ui-state), so a demo run changes neither entry; the check is the row's harness, the boundary rule plan.md names.
- auto-compact reads the user's `minTokens` setting as is. With it at 0 or at 200000 or above, the gate does not hold the send (`FAKE_COLD_TEXT` reads 200000 context), and the `compacting` and `compacted` beats show plain sends.

GIVEN the demo harness is registered WHEN the start prompt opens THEN its first step lists the resume sections' rows and `Other folder…`, and no project or recent folder.
GIVEN the demo harness is registered WHEN the user picks a resume row whose profile is `DEMO_PROFILE` THEN the prompt toasts `A sample session: the demo resumes nothing` and asks chat to resume nothing.
GIVEN no demo harness WHEN the start prompt opens THEN it lists projects and recent folders as before.
GIVEN a demo row's agent event WHEN agents folds it THEN no line is appended to its log.
GIVEN a saved recency record WHEN a sessions state adds, moves or removes only demo rows THEN no stamp changes and `uiState` is not written; WHEN a state adds a demo row and a `claude` row THEN only the `claude` row and its project are stamped.
GIVEN a pane showing a demo row WHEN the panes are saved THEN that pane's saved session is `null`.
GIVEN a session `holdSample` holds WHEN an agent event for it arrives THEN its `agents.rosters` key keeps the sample roster; after the hold's dispose the next event writes the folded roster.

Tests:
- `src/plugins/chat/page/start-prompt.test.ts`: add the case `hides projects and recent folders while the demo harness is registered` — harnesses hold `DEMO_HARNESS_ID` and one listed harness, the channel answers two projects, one recent folder and one section row; the picker opens `Folder` with the section row and `Other folder…` only. The break it catches: a dropped demo check shows the user's project names in a team demo.
- `src/plugins/chat/page/start-prompt.test.ts`: add the case `a sample section row resumes nothing` — a section row with `profile: DEMO_PROFILE` is chosen; the channel's `resume` gets no call and the toast text is `A sample session: the demo resumes nothing`. The break: a sample row starts a resume of a session id no harness holds.
- `src/plugins/agents/main/start.test.ts`: add the case `appends no log line for a demo row` — the rows slot holds the session with `harness: DEMO_HARNESS_ID`; an `agentSpawned` event appends nothing to the fake data files, while the same event for a `claude` row appends one line. The break: demo runs fill the user's agent logs.
- `src/plugins/sessions/page/session-recency.test.ts`: add an `it.each` `recency_DemoRows_AreNeverStamped: $case` in the shape of the existing table (line 60), rows: `{ case: 'a demo row arrives' }` (no stamp, no `uiState` write), `{ case: 'a demo row leaves' }` (no write), `{ case: 'a demo row and a claude row arrive together' }` (only the `claude` row and its project stamped). The break it catches: a demo run stamps the scratch folder as a project and pushes the user's real stamps toward the 200 cap.
- `src/plugins/sessions/page/pane-sessions.test.ts`: add a row to the `savedPaneSessions: $name` table (line 227): a pane on a row with `harness: DEMO_HARNESS_ID` saves `null`. The break: a restart reopens a pane on a demo session id.
- `src/plugins/agents/main/start.test.ts`: add the case `a held sample roster outlasts the fold` — hold a session, set a sample roster, emit `agentSpawned` for it; the slot keeps the sample; dispose the hold, emit again; the slot holds the folded roster.

Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs the tests above. Live checks of the steps are in task 17.
Commit: one commit for the group.

## Proof
