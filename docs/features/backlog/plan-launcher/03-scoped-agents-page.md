# 03 — Scoped agents page: the agent pane, its layout and its keys

Status: not started
Type: Task
Rung: deep · async pane lifecycle across page and main: in-flight asks and reads against scope changes, and a key
hand-off with a host
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/scoped-agents/page/agent-pane.ts`
- create `src/plugins/scoped-agents/page/agent-pane.css`
- create `src/plugins/scoped-agents/page/start.ts`
- create `src/plugins/scoped-agents/page/layout/read-layout.ts`
- create `src/plugins/scoped-agents/page/layout/scoped-agents-kit.ts`
- create `src/plugins/scoped-agents/layouts/layout.d.ts`
- create `src/plugins/scoped-agents/layouts/default/layout.js`
- create `src/plugins/scoped-agents/layouts/default/layout.css`
- modify `src/plugins/scoped-agents/main/start.ts` (registers the layout contract)
- modify `src/plugins/page.ts`
- modify `src/plugins/keymap.ts`
- modify `docs/features/layouts/design.md` (the owners table gains a `scoped-agents` row)
- test `src/plugins/scoped-agents/page/agent-pane.test.ts`
- test `src/plugins/scoped-agents/page/start.test.ts`

Practice keeps its own `interviewer-pane.ts`, `askBox` part and `practice.ask` binds in this task. Task 04 moves
Practice onto the pane and deletes them. So Practice works unchanged at this task's commit.

Consumes:
- `scopedAgentsManifest` in `src/plugins/scoped-agents/manifest.ts` ← 02: commands `askSend` and `leaveBox` (page,
  scope `ask`), scope `ask`, setting `layout` (default `'default'`)
- `AgentPaneSpec`, `AgentPane`, `ScopedAgentsPageExports` and the page `DependencyKey` (`scopedAgentsPageKey`) in
  `src/plugins/scoped-agents/contract.ts` ← 02
- the channel type in `src/plugins/scoped-agents/contract.ts` (`ScopedAgentsChannel`) ← 02, with
  `invoke.ask(owner, agentId, scope, text): Promise<string>` and `invoke.sessionOf(owner, agentId, scope): Promise<string | null>`
- `src/plugins/scoped-agents/main/start.ts` ← 02 (this task adds one line to it)
- the tree: `chatPageKey` and `ChatMount` (`src/plugins/chat/contract.ts`), `createLayoutParts`
  (`src/shared/page/layout-host/layout-parts.ts`), `appSlot`, `requireElementIn`, `keepingFocusAndScroll`,
  `inputFrame`, `boxHint`, `createBaseKit` and `ownerBaseKitDeps`, `readLayoutParts`, `startDrawingPagePart`

Produces:
- `export function createAgentPane(deps: AgentPaneDeps, spec: AgentPaneSpec): AgentPaneView` in
  `src/plugins/scoped-agents/page/agent-pane.ts`, with:
  - `export interface AgentPaneView extends AgentPane { send(): void; leaveBox(): void }` — what the `askSend` and
    `leaveBox` commands run on the pane that holds the keys
  - `export interface AgentPaneDeps` — `ask(scope: string, text: string): Promise<string>`,
    `sessionOf(scope: string): Promise<string | null>` (both already bound to the owner and agent id), `editor:
    EditorHost`, `keys: KeyHints`, `log(line: string): void`, `toast(text: string, tone: ToastTone): void`,
    `setScope(scope: 'ask'): void`, `setResizeTarget(target: ResizeTarget | null): void`,
    `setFocusTarget(target: FocusTarget | null): void`, `mountChat(element: HTMLElement, sessionId: string):
    ChatMount`, `drawAskBox(parent: HTMLElement, input: AskBoxInput, frame: HTMLElement):
    DrawnPart<ScopedAgentsPane>`, `heldKeys(pane: AgentPaneView | null): void` (the page part's record of the pane
    that holds the keys)
- `scopedAgentsPagePart: PagePart<typeof scopedAgentsManifest>` in `src/plugins/scoped-agents/page/start.ts`, whose
  `exports(consumer)` returns `ScopedAgentsPageExports`: `addAgentPane(spec: AgentPaneSpec): AgentPane`, the pane
  filed with `consumer.track`
- in `src/plugins/scoped-agents/layouts/layout.d.ts`: `ScopedAgentsPane { element: HTMLElement }`, `AskBoxInput {
  heading: string; hint: string }`, `ScopedAgentsKit extends BaseKit {}`, `AskBoxKit extends ScopedAgentsKit {
  textBox(parent: HTMLElement): HTMLElement }`, `ScopedAgentsLayout { askBox?(parent: HTMLElement, input:
  AskBoxInput, kit: AskBoxKit): ScopedAgentsPane }`, `CompleteScopedAgentsLayout extends Required<ScopedAgentsLayout>`
- `readScopedAgentsLayout(module: unknown, name: string): ScopedAgentsLayout` in
  `src/plugins/scoped-agents/page/layout/read-layout.ts`
- `createScopedAgentsKit(services: OwnerKitServices, rollback: RollbackDeps): ScopedAgentsKit` in
  `src/plugins/scoped-agents/page/layout/scoped-agents-kit.ts`, its keys in `scoped-agents.ask`
- binds in scope `scoped-agents.ask` in `src/plugins/keymap.ts` (pinned values below)

Decisions:
- The pane is `interviewer-pane.ts` moved and generalized; every rule it has today holds, keyed on the scope where it
  was keyed on the pair (slug, attempt id). The pane changes no behaviour: plan.md § Architecture decisions' one
  change (the ask race) is main's (02). The per-attempt lifetime stays Practice's: Practice calls `scopeOpened(null)`
  and then `scopeOpened(slug)` when the attempt changes (task 04).
- **The open scope's identity.** The pane holds one object for the open scope (`{ scope }`), made new by each
  `scopeOpened(scope)` call that changes the open scope (a call with the scope already open makes none).
  `scopeOpened(null)` and `dispose` set it to null. Every `sessionOf` and `ask` answer, resolved or rejected,
  compares the object captured at its call with the current one, and an answer whose object is not current is
  dropped: no mount, no ask box, no log, no toast, no change to `isSending` or `takesKeysOnAnswer`. A string compare
  is not enough: Practice reopens a fresh attempt as `scopeOpened(null)` then the same slug, and an answer for the
  old attempt must not land in the new one (the old pane's `Pair` object did this).
- Mapping from the old pane: `problemOpened(slug, attemptId)` → `scopeOpened(scope)`; `columnTookKeys` →
  `hostTookKeys`; `deps.view.setFocus('interviewer')` → `spec.tookKeys()`; `deps.view.focusColumn()` →
  `spec.leave()`; `deps.workspace.setSidePaneShown` → `spec.setShown`; `deps.workspace.sideResizeTarget` →
  `spec.resizeTarget`; `deps.focus() === 'interviewer'` → the pane's own `hasKeys`; `interviewerOf` →
  `sessionOf`; `askInterviewer` → `ask`; `problemTitle()` → `spec.heading()`; `ASK_HINT` → `spec.hint`.
- `outerPanes.focus.move`: `left` while the pane holds the keys runs `spec.leave()` and returns true; `right` while
  the pane is shown and does not hold the keys takes the keys and returns true; any other move returns false. The old
  pane took `right` only while the host's focus was `main`; a host that must refuse `right` from another of its panes
  wraps `outerPanes` (Practice does, task 04), since `AgentPaneSpec` is fixed in plan.md.
- `scopeOpened(null)` drops the mount and the ask box, as another scope does, and leaves no scope open. `toggle()`
  with no scope open shows nothing, logs `<agentId> has no scope` and toasts nothing: the host's copy for that case
  is the host's (Practice's `Open a problem first` moves to Practice, task 04).
- `toggle()` while shown hides the pane: it clears a pending `takesKeysOnAnswer` (so a later `sessionOf` answer
  takes no keys), runs `spec.leave()` only while the pane holds the keys, sets the pane hidden, calls
  `spec.setShown(false)` and logs `<agentId> pane hidden`. `toggle()` while hidden, with a scope open, sets the pane
  shown, calls `spec.setShown(true)`, logs `<agentId> pane shown`, and then takes the keys (a mount shows) or sets
  `takesKeysOnAnswer` and asks `sessionOf`, as today.
- `modeHidden()`: clears `takesKeysOnAnswer`; while the pane holds the keys, runs `spec.leave()` and then gives up
  the keys as `hostTookKeys` does (a no-op when the host's `leave` already called `hostTookKeys`). It keeps the pane
  shown (`isShown()` stays true, no `setShown` call), so the pane is open when the host shows again. While the pane
  does not hold the keys it changes nothing but `takesKeysOnAnswer`.
- `refresh()` does nothing while the pane is hidden or no scope is open (the next `toggle` asks `sessionOf`). While
  shown, it asks `sessionOf` for the open scope and applies the answer as the toggle's answer does: a shown mount
  stays; a session id with no mount destroys the ask box and mounts it; null keeps a shown ask box and its text, and
  shows one when none shows. It takes no keys the pane does not hold. An answer for a scope no longer open is dropped.
- `redraw()` draws the ask box again, reading `spec.heading()`, keeping the focus in its frame (`keepingFocusAndScroll`
  as today). The page part's `layouts.show` `setLayouts` sets the parts and calls `redraw()` on every live pane; a
  host calls `redraw` only when its heading changes.
- The pane sets its own plugin's base scope: `setScope('ask')` is `api.keys.setScope('ask')` of the
  `scoped-agents` page part, so the scope in force is `scoped-agents.ask`. It then sets `setFocusTarget(null)` and
  `setResizeTarget(spec.resizeTarget)`, in that order, as today.
- The page part keeps one record of the pane that holds the keys (`heldKeys`): a pane sets it to itself where it
  takes the keys and to null where it gives them up (`hostTookKeys`, `modeHidden`, `dispose`). `askSend` runs `send`
  on that pane and `leaveBox` runs `leaveBox` on it; with none, each does nothing.
- The owner in each channel call is the spec's `owner` (plan.md § Architecture decisions, the owner field): the host
  passes its own plugin id. `addAgentPane` binds `ask` and `sessionOf` to `(spec.owner, spec.agentId, scope)`.
- The log lines go out under `[scoped-agents]` (the page part's `services.log`). Each names the agent id, so the
  interviewer's lines keep today's words after the prefix wherever they named the interviewer.
- Each disposal is idempotent: the consumer's stop and the page part's own dispose may both dispose one pane. After
  `dispose`, every method is a no-op and every pending answer is dropped.
- The layout is a plugin layout (AGENTS.md § Architecture, A layout): main registers the contract text with
  `api.layouts.register({ layoutTypes })` (as `src/plugins/practice/main/start.ts` does, `layoutTypes` imported from
  `../layouts/layout.d.ts?raw`), and the page part shows it with `api.layouts.show<ScopedAgentsLayout>` (as
  `src/plugins/practice/page/start.ts` does). `createLayoutParts` owns `default` before the first set, and falls back
  per part.
- `scopedAgentsPagePart` joins `pageParts` in `src/plugins/page.ts` just before `backlogPagePart`, with its import in
  the file's import block, as 02 places the main part before `backlogMainPart`.
- The keys move to `scoped-agents.ask` in this task by addition: the `practice.ask` binds stay until task 04 removes
  them, so Practice's ask box keeps its keys between the two commits. A bind in a scope no view sets is never in
  force, so the placement check passes.

Pinned values:
- Log lines (`<agentId>` is the spec's agent id, `<scope>` the open scope; Practice's interviewer reads
  `interviewer`): `<agentId> pane shown` · `<agentId> pane hidden` · `<agentId> focused` · `<agentId> left` ·
  `<agentId> ask box shown for <scope>` · `<agentId> mounted <scope>` · `<agentId> not mounted <scope>: <error>` ·
  `<agentId> not read <scope>: <error>` · `<agentId> ask ignored: empty` · `<agentId> ask ignored: sending` ·
  `<agentId> ask failed: <error>` · `<agentId> has no scope`
- Toasts: `Could not start the <agentId>: <error>` (error) on a rejected ask; the read's or the mount's error text
  (error) on a failed `sessionOf` or `mountChat`
- DOM classes: the pane's element `div.scoped-agents-pane` with `tabIndex = -1`; the ask frame `inputFrame()` plus
  `scoped-agents-ask-box`; the send anchor `span.scoped-agents-ask-send`; its box hint `boxHint('scoped-agents-ask-keys',
  [sendAnchor])`. The send anchor: `keys.anchor(sendAnchor, 'scoped-agents.askSend', { scope: 'scoped-agents.ask',
  where: 'box', label: 'send' })`.
- `agent-pane.css` (imported by `page/start.ts`): `.scoped-agents-pane { display: grid; grid-template: minmax(0, 1fr)
  / minmax(0, 1fr); height: 100%; min-height: 0; outline: none; }`, the rule `.practice-interviewer` holds in
  `src/plugins/practice/page/practice.css` today.
- Default `askBox` (`layouts/default/layout.js`): root `div.scoped-agents-ask`; `h3.scoped-agents-ask-title` with
  `input.heading`; `p.scoped-agents-ask-hint` with `input.hint`; then `kit.textBox(root)`; returns `{ element: root }`.
  `layouts/default/layout.css` holds the three `.practice-ask*` rules of
  `src/plugins/practice/layouts/default/layout.css` (the block under "The interviewer pane's ask box"), renamed to
  `.scoped-agents-ask[data-layout-owner='scoped-agents']`, `[data-layout-owner='scoped-agents'] .scoped-agents-ask-title`
  and `[data-layout-owner='scoped-agents'] .scoped-agents-ask-hint`, with the same declarations.
- `layout.d.ts`'s header comment follows practice's: the root carries `data-layout="<name>"` and
  `data-layout-owner="scoped-agents"`; `askBox`'s `textBox` places the app's ask frame (`ui-input
  scoped-agents-ask-box`, holding the vim box and the send hint) and returns it; left out, the frame is appended at the
  end of the part's root; a second call throws `textBox placed twice`, so the part draws with `default`; `askBox`
  draws into a pane each time its open scope shows with no session, and again on each layout set; kit scope
  `scoped-agents.ask`.
- Binds added in `src/plugins/keymap.ts`, beside Practice's ask binds:
  - `{ keys: '<CR>', scope: 'scoped-agents.ask', command: 'scoped-agents.askSend', where: 'box' }`
  - `{ keys: '<Esc>', scope: 'scoped-agents.ask', command: 'scoped-agents.leaveBox', where: 'box' }`
  - `{ keys: '<CR>', scope: 'scoped-agents.ask', command: 'scoped-agents.askSend', mode: 'insert' }`
  - `'scoped-agents.ask'` joins the scope list of the `<C-n>` → `chat.startNewSession` binds
- `docs/features/layouts/design.md` owners table: a row `| \`scoped-agents\` | \`scoped-agents.layout\` | the agent
  pane's ask box (\`askBox\`), drawn for Practice's interviewer and Backlog's assistant |` after the `practice` row.

GIVEN a pane whose scope has no session WHEN the host toggles it THEN it logs `interviewer pane shown`, `interviewer
ask box shown for two-sum`, `interviewer focused`, sets scope `ask` and focuses the box at its end
GIVEN the ask box holding `how do I start` WHEN `askSend` runs THEN the channel's `ask` gets `('practice',
'interviewer', 'two-sum', 'how do I start')`, and the answer's session mounts in place of the box
GIVEN the pane holds the keys WHEN `Alt+h` reaches its outer panes THEN `spec.leave()` runs and the pane logs
`interviewer left` once the host takes the keys
GIVEN a mounted pane WHEN the host opens another scope THEN the mount is disposed and `sessionOf` is asked for the new
scope while the pane shows
GIVEN a shown pane on its ask box WHEN the host made an ask itself and calls `refresh()` THEN the box goes and the
answered session mounts

Tests:
- `src/plugins/scoped-agents/page/agent-pane.test.ts`, `describe('createAgentPane')`. Its setup moves from
  `src/plugins/practice/page/interviewer-pane.test.ts`'s `paneSetup`: the fake channel becomes the deps' `ask` and
  `sessionOf` (recording `sessionOf <scope>` in `events`); the fake view becomes the spec's `tookKeys` (records
  `tookKeys`, sets the fake focus to the pane) and `leave` (records `leave`, then calls `pane.hostTookKeys()`); the
  spec is `{ owner: 'practice', agentId: 'interviewer', heading: () => 'Two Sum', hint: 'Ask about the problem.', … }`;
  `openTwoSum` runs `scopeOpened('two-sum')` then `toggle()`. The setup's `setScope`, `setFocusTarget` and `setResizeTarget` record
  `setScope <scope>`, `setFocusTarget <target or null>` and `setResizeTarget` in `events`; the spec's `setShown`
  records `setShown <shown>` in the spec's calls beside `tookKeys` and `leave`. Moved cases, each with its new name
  and the change to its assertions:
  - `opens on the ask box when the scope has no session` (was `opens on the ask box when the attempt has no
    interviewer`): logs `['interviewer pane shown', 'interviewer ask box shown for two-sum', 'interviewer focused']`;
    `events` holds `setScope ask`, `setFocusTarget null`, `setResizeTarget` in that order; the spec's calls start
    `['setShown true']`
  - `mounts the session's chat when the scope has one` (was `mounts the interviewer's chat when the attempt has
    one`): logs contain `interviewer mounted two-sum`
  - `send: $case` — the four rows as today (`a question`, `blank`, `a second send while pending`, `rejected`); asks
    record `[scope, text]`; lines `interviewer mounted two-sum`, `interviewer ask ignored: empty`, `interviewer ask
    ignored: sending`, `interviewer ask failed: no harness`; the rejected row's toast `['Could not start the
    interviewer: no harness', 'error']`
  - `keeps the focus in the ask box across a redraw` — as today, plus: the spec's `heading` returns `LRU Cache`
    before `redraw()`, and the redrawn part's `input.heading` reads `LRU Cache`
  - `keeps the keys on the mount that replaces the ask box` — unchanged
  - `drops a sessionOf answer once $case` (was `drops an interviewer answer once $case`): rows `another scope opened`
    (`scopeOpened('lru-cache')`), `the pane disposed`, and `the scope closed and reopened as the same scope`
    (`scopeOpened(null)` then `scopeOpened('two-sum')` before the first answer lands; the first answer mounts
    nothing and takes no keys, and only the second `sessionOf two-sum` answer is applied)
  - `takes no keys on a later answer once the read failed` — the second open is `scopeOpened(null)` then
    `scopeOpened('two-sum')`; toasts `[['no harness', 'error']]`
  - `keeps the keys in the pane when the chat view fails to mount` — line `interviewer not mounted two-sum: no view`
  - `remounts only when the scope changes: $case` (was `… when the pair changes`): rows `the same scope keeps the
    mount` (events `['sessionOf two-sum']`), `the same scope keeps the typed text` (live box texts `['draft']`), `the
    scope closed and opened again` (the next step is `scopeOpened(null)` then `scopeOpened('two-sum')`; events
    `['sessionOf two-sum', 'dispose s1', 'sessionOf two-sum']`), `another scope` (`scopeOpened('lru-cache')`; events
    `['sessionOf two-sum', 'dispose s1', 'sessionOf lru-cache']`)
  - `outer panes: $case` — rows `left from the pane` (calls `['leave']`, logs `['interviewer left']`), `right from
    the host` (was `right from the column`; calls `['tookKeys']`, logs `['interviewer focused']`), `right with the
    pane hidden`, and the four `up`/`down` rows; the `column` state is reached with `pane.leaveBox()` as today
  - `gives up the keys when the host takes them` (was `… when the column takes them`): `hostTookKeys()` twice hides
    the mount once and logs `interviewer left` once
  - `modeHidden: $case` (was `modeHidden hides the mount and keeps it`) — rows `while the pane holds the keys` (the
    mount reads `{ hidden: 1, disposed: 0 }`; the spec's calls end `['leave']`; `isShown()` true), `while the pane
    does not hold the keys` (after `pane.leaveBox()`: no further `leave`, the mount's counts unchanged, `isShown()`
    true), `before the answer lands` (`toggle()`, `modeHidden()`, then the `sessionOf` answer: the box shows, no
    `tookKeys`)
  - `opens nothing with no scope` (replaces `toasts and opens nothing with no open problem`): `toggle()` before any
    `scopeOpened` leaves `isShown()` false, asks nothing, toasts nothing, and logs `['interviewer has no scope']`
  New cases:
  - `toggle: $case` — rows `open` (spec calls `['setShown true', 'tookKeys']`, logs start `interviewer pane
    shown`), `hide while holding the keys` (the second `toggle()`: spec calls add `leave` then `setShown false`; logs
    end `interviewer pane hidden`; `isShown()` false), `hide while not holding the keys` (after `pane.leaveBox()`:
    the hide adds `setShown false` and no `leave`), `hide before the answer lands` (`toggle()` twice, then the
    `sessionOf` answer: no `tookKeys`)
  - `drops an ask answer once $case` — `send()` on the box, then before the answer: rows `another scope opened`,
    `the pane disposed`, `the scope closed and reopened as the same scope`; the answer mounts nothing and logs
    nothing, and in the reopened rows a `send()` on the new box with text asks again (not `ask ignored: sending`)
  - `refresh: $case` — rows `a host-made ask mounts its session` (ask box shown; `refresh()`; `sessionOf` answers
    `s3`: the box is destroyed, `s3` mounts, the mount's `shown` is 1 since the pane held the keys), `a shown mount
    stays` (mounted `s1`; answer `s1`: no second mount, no dispose), `hidden asks nothing` (scope open, pane never
    shown: `events` stays `[]`)
- `src/plugins/scoped-agents/page/start.test.ts`, `describe('scoped-agents page part')`, over
  `startDrawingPagePart` with `fakeDependency(chatPageKey, …)` whose `mountChat` records its calls; a pane comes from
  `harness.started().exports!(consumer)` with a recording consumer:
  - `keeps the focus in the ask box across a layout change` — moved from
    `src/plugins/practice/page/start.test.ts`: the pane's `.scoped-agents-ask-box` holds the focused element across
    `harness.showLayouts({ layouts: new Map([['default', defaultLayout]]), user: 'default' })`
  - `askSend sends from the pane that holds the keys` — two panes (`interviewer` scope `two-sum`, `assistant` scope
    `global`, owner `backlog`), the second toggled last; `askSend` invokes `ask` with `('backlog', 'assistant',
    'global', <text>)`;
    with no pane holding the keys, `askSend` invokes nothing
  - `the toggled pane sets the ask scope` — `harness.scope()` reads `scoped-agents.ask` after a toggle onto the ask
    box
  - `askSend does nothing once the pane gave up the keys: $case` — a pane toggled onto its ask box with text typed,
    then rows `hostTookKeys`, `modeHidden`, `dispose`; `askSend` and `leaveBox` then invoke nothing and run no further
    `leave`; in the `dispose` row a second `dispose()` throws nothing and changes nothing
  - `a consumer's stop disposes its panes` — the consumer's tracked handles, disposed, remove the panes' ask boxes
    and dispose their mounts; `stops with nothing live` (`harness.counts()` equals `noCounts` after `harness.stop()`)

Done when: `npm run typecheck` passes; `npm run lint` passes (the layer check finds the page part in
`src/plugins/page.ts`, and the style check passes the moved CSS); `npm test` runs the two test files above and
`src/shared/layouts/layout-contracts.test.ts` (which picks up the new `layout.d.ts`). This task changes no self-test
script: Practice still draws its own pane until 04. The live checks of the pane are `10-final-verification.md`'s.
Commit: one commit for the group

## Proof
