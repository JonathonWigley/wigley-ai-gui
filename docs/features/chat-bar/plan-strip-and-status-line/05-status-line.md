# 05 — Chat status line, branch and status parts

Status: in progress
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/git.ts` · modify `src/main/git/process-git.ts` · test `src/main/git/process-git.test.ts`
           · modify `src/plugins/chat/contract.ts`
           · modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
           · modify `src/plugins/chat/main/start.ts` · modify `src/plugins/chat/main/preview/chat-preview.ts`
           · modify `src/plugins/chat/main/selftest-script.ts`
           · modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js`
           · test `src/plugins/chat/layouts/default/layout.test.ts`
           · modify `src/plugins/chat/page/composer-input.ts` · test `src/plugins/chat/page/composer-input.test.ts`
           · modify `src/plugins/chat/page/composer-kit.ts` · test `src/plugins/chat/page/composer-kit.test.ts`
           · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/start.ts`
           · modify `src/plugins/chat/page/read-chat-layout.ts` · test `src/plugins/chat/page/read-chat-layout.test.ts`
           · modify `src/plugins/chat/page/chat.css`
           · delete `src/shared/vim-mode-label.ts`
           · test every other file whose `ChatSessionState` literal the compiler flags (the chat page and main tests)
Consumes:  `Git.topLevel(folder)` (tree) · `ProcessRunner.run` (tree) · `placeContributedParts`, `createPartStore`
           (`src/shared/page/contributed-parts.ts`, tree) · `CONTROL_IDS`, `controlCommand`
           (`src/plugins/chat/page/control-commands.ts`, tree) · the `turnEnded` agent event (`src/contracts/agent.ts`, tree)
Produces:  in `src/contracts/git.ts`:
             `currentBranch(folder: string): Promise<string | null>;` on `Git`
           in `src/main/git/process-git.ts`: `currentBranch` in `createProcessGit`'s returned object
           in `src/plugins/chat/contract.ts`:
             `export interface ChatStatusPart { id: string; build(parent: HTMLElement, sessionId: string): { dispose?(): void } }`
             `addStatusPart(part: ChatStatusPart): Disposable;` on `ChatPageExports`
             `repo: string;` and `branch: string | null;` on `ChatSessionState`
             `branch: { sessionId: string; repo: string; branch: string | null };` in `ChatChannel['messages']`
           in `src/plugins/chat/layouts/layout.d.ts`:
             `export interface ModelEffortInput { model: ComposerControlInput; effort: ComposerControlInput | null }`
             `ComposerInput` without `modeLabel`, with `repo: string; branch: string | null;`
               `modelEffort: ModelEffortInput | null;` (and `controls` holding every other control)
             `export interface StatusLineKit extends BaseKit` (replaces `ComposerBarKit`), its members exactly:
               `typeHint(parent: HTMLElement): HTMLElement;`
               `modelEffortChip(parent: HTMLElement, input: ModelEffortInput): HTMLButtonElement;`
               `controlChip(parent: HTMLElement, control: ComposerControlInput): HTMLButtonElement;`
               `statusParts(parent: HTMLElement): HTMLElement;` (returns the slot it appended)
               `running(parent: HTMLElement): HTMLElement;`
               `sendButton(parent: HTMLElement): HTMLButtonElement;`
               (`typeHint`, `controlChip`, `running` and `sendButton` keep `ComposerBarKit`'s signatures and comments.
               The kit closes over the `ComposerInput`, so no member takes it again.)
             `statusLine?(parent: HTMLElement, input: ComposerInput, kit: StatusLineKit): PartView<ComposerInput>;` on
               `ChatLayout` (replaces `composerBar`)
             `statusLine(parent: HTMLElement): HTMLElement;` on `ComposerKit` (replaces `bar`)
Decisions: see below.

## Decisions

- **Git.currentBranch.** Run `git -C <folder> symbolic-ref --short -q HEAD`. Exit 0 returns its trimmed stdout (an
  unborn branch returns its name too). Any other exit runs `git -C <folder> rev-parse --short HEAD`: exit 0 returns its
  trimmed stdout (a detached HEAD's short commit), any other exit returns null (no clone, or no commit). It rejects only
  when git cannot start, as `topLevel` does. Add `currentBranch` to the contract's header list of methods that do not
  reject on a failed run (today: `topLevel`, `hasUpstream`, `fetch`, `lastFetch`).
- **Repo and branch in chat main.** `ChatSessionsDeps` gains `git: Pick<Git, 'topLevel' | 'currentBranch'>`; chat main's
  `start.ts` passes `services.git`. `openRow` holds `repo` as `path.basename(projectDir)` and `branch` null, so
  `sessionStarted` always carries both. Then `openRow` starts a branch read. Each `turnEnded` agent event of the row's
  live process starts another (in `processEvents`' `agentEvent`, beside the emit). A read: `topLevel(projectDir)`; a
  non-null top gives `repo = path.basename(top)` and `branch = currentBranch(projectDir)`; null gives the folder name and
  branch null. Chat main sends `branch` only when the repo or branch differs from the held state, and updates the held
  state first. Each read takes the row's next read number; a result applies only when it is the row's latest read and
  the row is still held, so an older read that settles last changes nothing. A rejected read logs
  `[chat] branch not read in <folder name>: <error>` and keeps the held values.
- **Layout preview.** `chat-preview.ts`'s state carries `repo: PREVIEW_PROJECT_DIR` (`Chat preview`) and
  `branch: 'main'`, so the preview draws a branch.
- **Page state.** `chat-view.ts` hears `branch`: it sets the tab's `state.repo` and `state.branch`, draws the status
  line, and logs `[chat] <tab name> is in <repo> on <branch>`, or `[chat] <tab name> is in <repo>, no branch` for null.
  A `branch` for a session chat holds no tab for is ignored. This handler has no unit test (`chat-view.ts` has no test
  harness, and the draw from the held state is `composerInputOf`'s, which is tested); task 11's live check 1 proves it
  by reading these log lines.
- **How the layout finds model and effort.** `composerInputOf` pairs them by chat's own control ids, the ones its pick
  keys already reach (`CONTROL_IDS` in `control-commands.ts`): the control whose `controlCommand` is `pickModel` is the
  model, `pickEffort` the effort. `modelEffort` is `{ model, effort }` when a model control is declared (`effort` null
  when none is); null when no model control is declared, and the effort control then stays in `controls` as a plain
  chip. `controls` holds every other control in declared order, so the permission-mode chip comes first for both the
  Claude adapter and the fake harness, which declare it first. Why: `mode`, `effort` and `model` are already the
  harness-neutral ids chat's `m`, `e` and `o` keys target, and each adapter chooses to declare them; the layout reads
  only the split input and names no id. A `role` field on `SessionControl` was rejected: it would duplicate the id
  vocabulary `CONTROL_IDS` holds, and every adapter would then declare the same fact twice.
- **The model · effort chip.** `kit.modelEffortChip(parent, input)` draws the Chip primitive with the model control's
  label as its label (`Model`) and `<model value> · <effort value>` as its value (the model value alone when `effort` is
  null). A click runs `chat.pickModel`. It holds the `chat.pickModel` key span, then the `chat.pickEffort` key span
  (both from `BarParts.chipKeys`), so `o` and `e` stay anchored. While `effort` is null it holds the `chat.pickModel`
  span only: no chip advertises a control that is not declared, as for any absent control today. It is disabled while
  `model.enabled` is false.
  `controlChip` keeps its rule: a chip holds its pick command's keys when `chipKeyCommands` over `input.controls` gives
  them.
- **Status parts.** `start.ts` makes `createPartStore<ChatStatusPart>()`; `addStatusPart` adds to it. `ChatViewDeps`
  and `ComposerSurfaceDeps` gain `statusParts: Pick<PartStore<ChatStatusPart>, 'parts' | 'onChanged'>` (the view) and
  `Pick<…, 'parts'>` (the surface). The surface keeps one `span.chat-status-parts-slot` element. Inside the composer's
  draw callback (so a rolled-back draw builds them again) it empties the slot and calls `placeContributedParts` into it
  with `{ owner: 'chat', noun: 'status part', holderClass: 'chat-status-parts', wrapperClass: 'chat-status-part' }` and
  the composer draw's `rollback`. So a status part is built at each composer draw (layout change, a composer or status
  part added or removed), not at each status line draw. `kit.statusParts(parent)` appends that slot on every status
  line draw. A second call in one draw throws `status line placed status parts twice`, so the line draws with
  `default`. A status line that never calls it gets the slot at the end of its element. `chat-view.ts` redraws every
  tab's composer on `statusParts.onChanged`, as it does for composer parts.
- **Renames.** `composerBar` → `statusLine` (layout part, `PART_SET` in `read-chat-layout.ts`, the part draws key in
  `composer-kit.ts`); `ComposerBarKit` → `StatusLineKit`; `ComposerKit.bar` → `ComposerKit.statusLine`;
  `ComposerSurface.drawBar` → `drawStatusLine` and `chat-view.ts`'s `drawBar` → `drawStatusLine`; the slot class
  `chat-composer-bar-slot` → `chat-status-line-slot`; the line's class `chat-composer-bar` → `chat-status-line`. No
  alias of an old name stays (AGENTS.md § Intent, no backwards compatibility).
- **No mode label.** Remove `modeLabel` from `ComposerInput`, `composerInputOf`, the default layout and its tests, and
  `.chat-box-mode` from `chat.css`. `composerInputOf` no longer takes `boxMode`; `HeldTab.boxMode` and `STARTING_MODE`
  go, and the editor's `modeChanged` listener becomes a no-op (the `EditorEvents` contract still requires it). Delete
  `src/shared/vim-mode-label.ts`: `composer-input.ts` is its only importer (measured at plan time, re-verify with
  `grep -rn vim-mode-label src`).
- **Default status line**, in this order: `span.chat-status-repo` (the repo), `span.chat-status-branch` (the branch;
  left out when null), `kit.typeHint`, `kit.modelEffortChip` (left out when `modelEffort` is null), one
  `kit.controlChip` per `input.controls` entry, `kit.statusParts`, `kit.running`, `kit.sendButton`. The type hint stays
  because `i` and `a` (`chat.focusBox`, `chat.appendBox`) are not vim's own keys and need an anchor on screen.
- **CSS** (`chat.css`, tokens only): `.chat-status-line` takes the old bar's flex row, wrap and `space-2` gap;
  `.chat-status-repo` and `.chat-status-branch` are `fg-secondary` at `text-11`; `.chat-status-parts-slot` is
  `display: contents`; `.chat-status-parts` is an inline flex row with the `space-2` gap, `min-width: 0` and
  `flex: 0 1 auto`; `.chat-status-part` (each part's wrapper) is `display: flex` with `min-width: 0`. So a status part
  that drops items as it narrows (usage's line, task 08) gets the width the line can spare and can shrink below its
  content. `.chat-running` keeps `margin-left: auto`, so the running dot and Send close the line.
- **Status part contract text.** The `ChatPageExports` comment in `contract.ts` gains: `addStatusPart` throws on an id
  already added; adding or disposing one draws every Chat tab's composer again; a part is built at each composer draw
  and redraws into its wrapper itself when its content changes; it draws in every Chat tab, the preview's included.

## Behaviour

GIVEN a session folder inside a clone on branch `main` WHEN its row opens THEN `sessionStarted` carries the folder's
name and branch null, and a `branch` message follows with the clone top folder's name and `main`.
GIVEN a folder in no clone WHEN its row opens THEN no `branch` message is sent (the held repo is already the folder's
name).
GIVEN a held branch `main` WHEN a `turnEnded` arrives and the clone is now on `feature` THEN one `branch` message
carries `feature`; WHEN the branch is unchanged THEN none is sent.
GIVEN controls Mode, Effort, Model, Verbosity WHEN the status line draws THEN it shows repo, branch, the type hint, one
`Model  Small · Medium` chip holding `o` and `e`, then Mode and Verbosity chips, the status parts, the running dot and
Send.
GIVEN a status part added WHEN the box takes focus (a status line draw) THEN the part is not built again.

## Tests

- `process-git.test.ts`: `currentBranch_$case` (it.each) — symbolic-ref exits 0 with `main\n` → `main`, rev-parse not
  run; symbolic-ref exits 1, rev-parse exits 0 with `abc1234\n` → `abc1234`; both exit 128 → null. Catches a wrong
  fallback order or untrimmed output. `currentBranch_RealClone_BranchThenShortCommitWhenDetached` (in the real-clone
  `describe`, `skipIf(!gitOnPath)`, `isolateGitConfig`) — a fresh clone with one commit returns its branch, and after
  `checkout --detach` returns `rev-parse --short HEAD`'s output. Catches a git flag the scripted runs cannot.
- `chat-sessions.test.ts`: `setUp` gains a fake `git` (default: `topLevel` and `currentBranch` resolve null),
  overridable. `branchRead_$case` (it.each) — clone on `main` → one `branch` message `{ repo: <top's name>, branch:
  'main' }`; no clone → none; `topLevel` rejects → the `branch not read` line, none sent. `agentEvent_TurnEnded_
  ReadsTheBranchAgain` — a branch change sends one message, an unchanged branch none. `branchRead_OlderReadSettlesLast_
  KeepsTheNewer` — two reads resolved out of order send only the newer result. A row added to the existing
  start/sessions assertions: the state carries `repo` (the folder's name) and `branch: null`.
- `composer-input.test.ts`: drop `modeLabel` and `boxMode` from every row. `composerInputOf_Controls_PairsModelAnd
  Effort` (it.each) — Mode, Effort, Model, Verbosity → `modelEffort` Model with Effort, `controls` Mode, Verbosity; no
  Model → `modelEffort` null, `controls` keeps Effort; Model with no Effort → `effort` null. Catches a pairing that
  drops or doubles a control.
- `composer-kit.test.ts`: rename `composerBar_Redraw_LeavesOneAnchorPerHint` → `statusLine_Redraw_LeavesOneAnchorPer
  Hint`. `statusLine_StatusParts_BuiltAtComposerDrawOnly` — a held status part's `build` runs once across a composer
  draw and two status line draws, and its holder sits in each drawn line. `statusLine_StatusPartsPlacedTwice_Draws
  WithDefault` — a user line calling `statusParts` twice draws with `default` and logs the failure.
  `statusLine_ModelEffortChip_RunsPickModelAndHoldsBothKeys` — the click runs `chat.pickModel`; the chip holds the
  `pickModel` then the `pickEffort` key spans; with `effort` null it holds the `pickModel` span only and shows the
  model value alone; it is disabled while the model control is not enabled.
- `layout.test.ts`: `SURFACE_PARTS` and `fakeSurfaceKit` move from `composerBar`/`bar` to `statusLine` and gain
  `modelEffortChip` and `statusParts`; `composer_Default_PlacesEachSlotOnce` expects `statusLine` for `bar`. Replace
  `composerBar_Default_ChipsInControlOrderThenRunningThenSend` with `statusLine_Default_RepoBranchChipsPartsRunningSend`
  (it.each) — full input → `span.chat-status-repo:repo`, `span.chat-status-branch:main`, `typeHint`, `modelEffort`,
  `chip:mode`, `statusParts`, `running`, `send`; branch null → no branch span; `modelEffort` null → no `modelEffort`.
- `read-chat-layout.test.ts`: a row in `readChatLayout_PartsItChanges_ReturnsTheDefaultExport` with `statusLine`; a
  row in `readChatLayout_Malformed_ThrowsNamingIt` with `{ composerBar: builder }` → `composerBar is not a layout part`.
- Self-test (`selftest-script.ts`, `CONTROLS_STEPS`, group `session controls`): add `screenshot: 'status-line'` and
  `checksFit: true` to the existing step `{ keys: ['Escape'], expect: '[chat] picker closed: Model' }`, and add to the
  group's `why`: "the status line draws one model · effort chip". The existing `e` and `o` steps prove both keys still
  open their pickers; `statusLine_ModelEffortChip_RunsPickModelAndHoldsBothKeys` pins both key spans on the joined
  chip, and the whole run's placement check (task 11, on the user's ask only) checks their anchors. The self-test's
  project folder sits in the temp home, in no clone, so no `branch` line is logged there; the branch is a task 11 look.

## Runtime look for task 11

The status line in a real clone: repo and branch, the branch changing after the next turn ends once the clone's branch
changed (task 11, live check 1, gives the route), a detached
HEAD's short commit, and the line in a narrow composer (wrapping, the running dot and Send at the end).

Done when: `npm run lint` and the suite pass; the tests above run; the chat self-test group `session controls` passes
with its screenshot.
Commit:    one commit for the group, its paths by name.

## Proof

