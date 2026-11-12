# 04 — Practice on scoped agents: the interviewer becomes a registration

Status: not started
Type: Task
Rung: deep · crosses main and page through the interviewer's lifetime, and keeps it in `progress.json` through a new store adapter
Wave: 3 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/practice/main/interviewer-agent.ts`
- test `src/plugins/practice/main/interviewer-agent.test.ts`
- modify `src/plugins/practice/main/start.ts`
- test `src/plugins/practice/main/start.test.ts`
- modify `src/plugins/practice/main/practice-sessions.ts`
- test `src/plugins/practice/main/practice-sessions.test.ts`
- modify `src/plugins/practice/main/selftest-script.ts`
- modify `src/plugins/practice/manifest.ts`
- modify `src/plugins/practice/contract.ts`
- modify `src/plugins/practice/page/start.ts`
- test `src/plugins/practice/page/start.test.ts`
- modify `src/plugins/practice/page/practice-view.ts`
- modify `src/plugins/practice/page/layout/practice-kit.ts`
- modify `src/plugins/practice/page/layout/read-layout.ts`
- modify `src/plugins/practice/page/practice.css`
- modify `src/plugins/practice/layouts/layout.d.ts`
- modify `src/plugins/practice/layouts/default/layout.js`
- modify `src/plugins/practice/layouts/default/layout.css`
- delete `src/plugins/practice/page/interviewer-pane.ts`
- delete `src/plugins/practice/page/interviewer-pane.test.ts`
- modify `src/plugins/keymap.ts`
- modify `docs/features/layouts/design.md` (the `practice` row loses the ask box)

Consumes:
- `ScopedAgentSpec` (with `owner`), `ScopedAgentStore`, `ScopedAgentRecord`, `ScopedAgent`, `scopedAgentsMainKey`
  in `src/plugins/scoped-agents/contract.ts` ← 02
- `AgentPaneSpec` (with `owner`), `AgentPane`, `scopedAgentsPageKey` in `src/plugins/scoped-agents/contract.ts` ← 02;
  `addAgentPane(spec: AgentPaneSpec): AgentPane` from `scopedAgentsPagePart`'s exports ← 03
- the binds in scope `scoped-agents.ask` (`askSend`, `leaveBox`, `<C-n>`) ← 03
- the pane's log lines under `[scoped-agents]` (03's pinned values) ← 03
- the tree: `Progress.read` and `Progress.setInterviewer` (`main/progress.ts`), `ProblemStore.slugs`, `folder`,
  `readProblem` and `interviewerText` (`main/problem-store.ts`), `INTERVIEWER_INSTRUCTIONS` (`main/instructions.ts`),
  `startPracticeTools`'s `interviewerSlug(session: AgentSession): Promise<string | null>` dep
  (`main/practice-tools.ts`, unchanged)

Produces:
- `export function interviewerAgentSpec(deps: InterviewerAgentDeps): ScopedAgentSpec` and
  `export function createInterviewerStore(deps: InterviewerAgentDeps): ScopedAgentStore` in
  `src/plugins/practice/main/interviewer-agent.ts`, with
  `export interface InterviewerAgentDeps { store: Pick<ProblemStore, 'slugs' | 'folder' | 'readProblem' |
  'interviewerText'>; progress: Pick<Progress, 'read' | 'setInterviewer'> }`
- `PracticeSessions` in `src/plugins/practice/main/practice-sessions.ts` reduced to `{ startImport(request: string):
  Promise<string> }`; `PracticeSessionsDeps` to `{ chat: Pick<ChatMainExports, 'launch' | 'defaultProfile'>; store:
  ProblemStore; files: Pick<Files, 'makeFolder'> }`; `HOST_ID_WAIT_MS` leaves the file (02 has its own)
- `PracticeChannel.invoke` without `askInterviewer` and `interviewerOf` (`src/plugins/practice/contract.ts`)
- `PracticeViewDeps` gains `addAgentPane(spec: AgentPaneSpec): AgentPane` and loses `mountChat`
  (`src/plugins/practice/page/practice-view.ts`)

Decisions:
- No change in behaviour (plan.md § Architecture). The interviewer keeps `Space v i`, its per-attempt lifetime,
  `progress.json`'s `attempts[].interviewer` shape and `read_practice_state`'s refusal text. The one difference 02
  settled (an ask whose attempt changed under it launches instead of refusing) is 02's.
- **Store adapter** (`createInterviewerStore`), scope = the problem's slug, "current attempt" = `attempts.at(-1)`:
  - `read(slug)`: the current attempt's `interviewer`; null for none or no attempt
  - `write(slug, record)`: `progress.setInterviewer(slug, <current attempt's id>, record)`; no attempt throws
    `<slug> has no attempt; open it first.`
  - `entries()`: for each of `store.slugs()`, the current attempt's interviewer when non-null, as `{ scope: slug,
    record }`; a progress file that fails to read is skipped (as `findInterviewer` does today)
  - `superseded(slug)`: the last attempt before the current one whose `interviewer` is non-null (today's `old` in
    `launchInterviewer`); null for none
  - `checkAsk(slug)`: rejects `<slug> has no attempt; open it first.` when the progress file has no attempt;
    resolves otherwise
- `entries` lists current attempts only, so 02's `cleared` no longer moves the host id of an older attempt's
  interviewer. Nothing reads that record again: a resume and `read_practice_state` read the current attempt only,
  and a new launch closes the old row. So nothing the user sees changes.
- **Spec** (`interviewerAgentSpec`): `owner: practiceManifest.id`, `agentId: 'interviewer'`, `folder: () =>
  store.folder()`, `instructions`: `interviewer.md`'s text when present and not blank, else
  `INTERVIEWER_INSTRUCTIONS` (today's `interviewerInstructions`), `title(slug)`: `Interviewer: <problem title>` from
  `store.readProblem(slug)`, `store: createInterviewerStore(deps)`.
- **Main** (`start.ts`): `scopedAgents = api.dependency(scopedAgentsMainKey)`; `interviewer =
  scopedAgents.addScopedAgent(interviewerAgentSpec({ store, progress }))`, which 02 files on Practice's
  registrations; `startPracticeTools`'s `interviewerSlug` becomes `(session) => interviewer.scopeOf(session)`. The
  three `api.events.on('chat.session…')` listeners go, and `PracticeApi` drops its `QualifiedEvents<'chat',
  ChatMainEvents>` argument: only the interviewer needed chat's events. The `askInterviewer` and `interviewerOf`
  handlers go. `createPracticeSessions` gets `{ chat, store, files: services.files }`.
- **Page** (`practice-view.ts`), replacing `createInterviewerPane`:
  - `interviewer = deps.addAgentPane({ owner: 'practice', agentId: 'interviewer', heading: () => openTitle, hint:
    ASK_HINT, setShown: (shown) => workspace.setSidePaneShown(shown), resizeTarget: workspace.sideResizeTarget,
    tookKeys: () => setFocus('interviewer'), leave: () => focusColumn() })`; `workspace.sidePane.append(
    interviewer.element)` as today. `ASK_HINT` moves here from `interviewer-pane.ts`, word for word.
  - **Per-attempt lifetime.** `noteShown` keeps the shown pair (slug, attempt id). When the pair changes, it calls
    `interviewer.scopeOpened(null)` and then `interviewer.scopeOpened(slug)`, so a fresh attempt of the same problem
    drops the mount and the typed text as `problemOpened` did. The same pair calls nothing.
  - `changeFocus`'s `interviewer.columnTookKeys()` → `interviewer.hostTookKeys()`; `hidden()` keeps
    `interviewer.modeHidden()`; `dispose()` keeps `interviewer.dispose()`; the `focusin` guard keeps
    `interviewer.element.contains(...)`. `setLayouts` stops calling `interviewer.redraw()`: the ask box's layout is
    scoped-agents' now, which redraws its panes itself.
  - **Outer panes.** `shown()` sets `{ focus: { move: (direction) => direction === 'right' && store.get().focus !==
    'main' ? false : interviewer.outerPanes.focus.move(direction) }, resize: interviewer.outerPanes.resize }`. The old
    pane took `right` only from `main`; 03's pane takes it whenever it does not hold the keys, so Practice keeps
    `Alt+l` from the list going to the column.
  - **No open problem.** `toggleInterviewer`, where it would open the pane (the pane hidden) with no problem shown,
    toasts `Open a problem first` (info), logs `interviewer needs an open problem` and opens nothing: the copy moves
    from the old pane to Practice, under `[practice]` as before.
  - `InterviewerCommand` loses `askSend` and `askLeave`; their handlers go.
  - **Run and Submit outside Practice.** `<D-'>` and `<D-Enter>` were bound in `practice.ask`; they move to
    `scoped-agents.ask` so Practice's ask box keeps them. That scope also holds Backlog's assistant box (08), so the
    `run` and `submit` page commands do nothing while Practice is hidden, logging `run ignored: practice hidden` or
    `submit ignored: practice hidden`. While Practice shows they run as today.
- **Page part** (`page/start.ts`): `chatPageKey` goes; `scopedAgents = api.dependency(scopedAgentsPageKey)`;
  `createPracticeView` gets `addAgentPane: (spec) => scopedAgents.addAgentPane(spec)` in place of `mountChat`.
- **Manifest**: `dependsOn: { main: ['chat', 'sessions', 'scoped-agents'], page: ['scoped-agents'] }` (plan.md §
  Boundary rules adds `scoped-agents` to both; the page drops `chat`, whose only use was `mountChat`); commands
  `askSend` and `askLeave` and scope `ask` go; `leaveBox` (Esc in the problem and console boxes) stays. The comment
  above the manifest reads that main names `chat` for the import session, `sessions` for its tools and
  `scoped-agents` for the interviewer, and the page names `scoped-agents` for the interviewer's pane.
- **Layout**: `askBox`, `AskBoxInput` and `AskBoxKit` leave practice's contract; the comment lines naming `askBox`
  (its `textBox` slot, its draw moment, its kit scope `practice.ask`) go; `read-layout.ts`'s `askBox: true` goes;
  `default/layout.js`'s `askBox` goes; `default/layout.css`'s block under "The interviewer pane's ask box" goes, and
  its header comment drops "the interviewer's ask box". `practice-kit.ts`'s `PracticeBaseScope` loses `'ask'`, and
  its comment reads "The base scopes the view sets". `practice.css`'s `.practice-interviewer` rule goes (03's
  `.scoped-agents-pane` holds it).
- **Keymap** (`src/plugins/keymap.ts`): `'practice.ask'` leaves the `<C-n>` scope list (03 added
  `'scoped-agents.ask'`); `'practice.ask'` becomes `'scoped-agents.ask'` in the `<D-'>` / `<D-Enter>` scope list; the
  `practice.askSend` and `practice.askLeave` binds go (the `...[…].map` block and the insert-mode `<CR>` bind under
  "The ask box sends on Enter"). `<Leader>vi` → `practice.toggleInterviewer` stays.
- **Self-test** (`main/selftest-script.ts`, group `interviewer`): the pane's lines change owner from `[practice]` to
  `[scoped-agents]` and keep their words; the lines that name no agent gain `interviewer `. Practice's own focus and
  open lines stay `[practice]`. The keys and step order stay.

Pinned values:
- Self-test group `interviewer`, each step's line before → after:
  1. `Space v i`: expect `[practice] ask box shown for lru-cache` → `[scoped-agents] interviewer ask box shown for
     lru-cache`; alsoExpect `/^\[practice\] interviewer pane shown$/` → `/^\[scoped-agents\] interviewer pane
     shown$/` and `/^\[practice\] interviewer focused$/` → `/^\[scoped-agents\] interviewer focused$/`
  2. `how do I start` + Enter: `[practice] interviewer mounted lru-cache` → `[scoped-agents] interviewer mounted
     lru-cache`
  3. `Alt+h`: `[practice] interviewer left` → `[scoped-agents] interviewer left`; alsoExpect
     `/^\[practice\] main focused$/` stays
  4. `Alt+l`: `[practice] interviewer focused` → `[scoped-agents] interviewer focused`
  5. `Alt+h Alt+h`: `[practice] list focused` stays
  6. `j`: `[practice] selected two-sum` stays
  7. Enter: `[practice] ask box shown for two-sum` → `[scoped-agents] interviewer ask box shown for two-sum`;
     alsoExpect `/^\[practice\] opened two-sum$/` stays
  8. `Alt+h`: `[practice] list focused` stays
  9. `k` Enter: `[practice] interviewer mounted lru-cache` → `[scoped-agents] interviewer mounted lru-cache`;
     alsoExpect `/^\[practice\] opened lru-cache$/` stays
  10. `Space v i`: `[practice] interviewer pane hidden` → `[scoped-agents] interviewer pane hidden`
  The group's `why` gains: "The pane is scoped-agents', so its lines log under that plugin."
- `ASK_HINT`: `Ask about the problem. The interviewer asks guiding questions and gives no answers.`
- Refusal and toast texts: `<slug> has no attempt; open it first.` · `Open a problem first` · `Interviewer: <title>`
- `docs/features/layouts/design.md`, the `practice` row: "…the Solution confirm body, the interviewer pane's ask box
  (`askBox`) and the import dialog's body (`importBox`)" → "…the Solution confirm body and the import dialog's body
  (`importBox`)".

GIVEN a problem with one attempt and no interviewer WHEN the interviewer store writes a record for its slug THEN
`progress.json`'s last attempt holds it and `read` returns it
GIVEN attempts a1 (interviewer r0), a2 (none), a3 (current) WHEN `superseded` runs THEN it returns r0's record
GIVEN Practice shows Two Sum's attempt a1 WHEN the problem reopens as due with attempt a2 THEN the pane hears
`scopeOpened(null)` then `scopeOpened('two-sum')`
GIVEN Practice shows with no problem open WHEN `Space v i` runs THEN it toasts `Open a problem first` and the pane
stays hidden
GIVEN Practice is hidden WHEN `practice.run` runs THEN no judge call goes to main and `[practice] run ignored:
practice hidden` logs

Tests:
- `src/plugins/practice/main/interviewer-agent.test.ts` (new), over `createProblemStore` and `createProgress` on the
  in-memory files `src/plugins/practice/main/progress.test.ts` builds them on, with `writeProblem` and `TWO_SUM`
  from `practice-fixtures.test-support.ts`:
  - `read and write keep the current attempt's interviewer: $case` — rows `no attempt` (read null; write rejects
    `two-sum has no attempt; open it first.`), `one attempt` (write then read returns the record; the file's last
    attempt holds it), `two attempts` (write leaves the first attempt's interviewer as it was)
  - `entries lists each problem's current interviewer` — Two Sum's current attempt holds one, a second problem holds
    one on an older attempt only, a third's `progress.json` is not JSON: the result is Two Sum's alone
  - `superseded is the latest earlier attempt's interviewer: $case` — rows `no earlier attempt` (null), `an earlier
    one holds one` (its record), `the latest earlier holds none` (the one before it), `only the current holds one`
    (null)
  - `checkAsk refuses a problem with no attempt` — rejects `two-sum has no attempt; open it first.`; resolves after
    `progress.open`
  - `instructions: $case` — rows `built-in` (`INTERVIEWER_INSTRUCTIONS`), `interviewer.md` (its text), `blank
    interviewer.md` (`INTERVIEWER_INSTRUCTIONS`); moved from the instruction half of `practice-sessions.test.ts`'s
    `askInterviewer launches an owned session and stores it: $case`
  - `the spec names the interviewer` — `owner` `practice`, `agentId` `interviewer`, `folder('two-sum')` the practice
    folder, `title('two-sum')` `Interviewer: Two Sum`
- `src/plugins/practice/main/practice-sessions.test.ts`: keeps `startImport launches a visible session with the
  import instructions`, its setup cut to the import's deps. These cases leave it (02's
  `scoped-agent-service.test.ts` holds their generalized copies): `askInterviewer launches an owned session and
  stores it: $case`, `askInterviewer sends the second ask to the first launch: $case`, `askInterviewer launches afresh
  when chat refuses the resume`, `askInterviewer refuses without a stored interviewer, a profile or its attempt:
  $case`, `askInterviewer on a new attempt closes the old interviewer: $case`, `interviewerOf brings the interviewer
  back: $case`, `cleared moves the stored host id`, `interviewerSlug matches the current attempt only: $case`.
- `src/plugins/practice/main/start.test.ts`: `startPractice` adds `fakeDependency(scopedAgentsMainKey, …)` whose
  `addScopedAgent` records each spec and returns an agent whose `scopeOf` answers a set value.
  - `start wires the tools and hears chat` becomes `start registers the interviewer and wires the tools`:
    contributed tools `[['add_practice_problem', 'read_practice_state']]`; one spec, `owner` `practice`, `agentId`
    `interviewer`
  - `a chat clear before any list starts no watch` becomes `the interviewer's entries before any list start no
    watch`: `await specs[0].store.entries()`, then a write to `problems/two-sum/notes.md` sends nothing
- `src/plugins/practice/page/start.test.ts`: `startPracticePage` adds `fakeDependency(scopedAgentsPageKey, …)` whose
  `addAgentPane` records the spec and returns a fake pane recording `scopeOpened <scope>`, `toggle`, `hostTookKeys`,
  `modeHidden`, `dispose`, with `isShown` false until `toggle`.
  - `keeps the focus in the ask box across a layout change` leaves this file (moved to 03's
    `src/plugins/scoped-agents/page/start.test.ts`)
  - new `hands the pane its scope per attempt: $case` — rows `first open` (`['scopeOpened null', 'scopeOpened
    <slug>']`), `the same attempt refreshed` (no call), `a fresh attempt of the same problem` (`['scopeOpened null',
    'scopeOpened <slug>']`)
  - new `toggleInterviewer: $case` — rows `no open problem` (toast `['Open a problem first', 'info']`, log
    `interviewer needs an open problem`, no `toggle`), `a problem open` (`toggle`)
  - new `the outer panes take right only from main` — after `showMode`, `harness.outerPanes()!.focus.move('right')`
    returns false with the list holding the keys, and reaches the fake pane's `outerPanes` with main holding them
  - new `run and submit do nothing while Practice is hidden` — `run` and `submit` before `showMode` invoke nothing
    and log `run ignored: practice hidden` and `submit ignored: practice hidden`
  - the spec the pane got: `owner` `practice`, `agentId` `interviewer`, `hint` `ASK_HINT`, `heading()` the open
    problem's title (a row in `hands the pane its scope per attempt`'s `first open` assertions)

Done when: `npm run typecheck` and `npm run lint` pass; `npm test` runs the four test files above and
`src/shared/layouts/layout-contracts.test.ts`; `grep -rn "interviewer-pane\|askInterviewer\|interviewerOf\|practice.ask\b\|AskBoxInput" src/plugins/practice src/plugins/keymap.ts` finds nothing; `npm run selftest -- --plugin
practice` passes, its `interviewer` group included. The live check "Practice unchanged" is
`10-final-verification.md`'s.
Commit: one commit for the group

## Proof
