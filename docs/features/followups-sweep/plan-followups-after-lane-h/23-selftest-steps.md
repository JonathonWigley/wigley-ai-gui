# 23 — Self-test click step and step helpers

Status: not started
Type: Batch
Rung: deep · rests on two low-confidence claims the worker checks in a filtered self-test run: a runtime main command bound by a script's page bind crosses page → main → page through the Bridge, and a click on an unfocused pane's hub head reaches the head on the first press
Wave: 4 · Depends on: 15 (each lists `AGENTS.md`)
Plan: [plan.md](plan.md)

Follow-ups (`followups.md`): **Self-test has no click step** (L869) · **Chat self-test steps by single presses** (L850) ·
**Docs page test seam for a session's host id change** (L777) · **`forms.choose` with an arg through `runCommand`
across the Bridge is not proved live** (L224).

Files:
- modify `src/contracts/plugin.ts`
- modify `src/main/selftest-runner.ts`
- test `src/main/selftest-steps.test.ts`
- modify `src/plugins/sessions/contract.ts`
- modify `src/plugins/sessions/main/selftest-script.ts`
- modify `src/plugins/forms/main/selftest-script.ts`
- modify `src/plugins/forms/main/start.ts`
- modify `src/plugins/chat/main/selftest-script.ts`
- modify `src/plugins/app-update/main/selftest-script.ts` (one comment)
- modify `docs/features/app-update/design.md` (one sentence)
- modify `AGENTS.md`

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main`; the scheduled-tasks branch changes none of these files):
- `grep -n "^export interface SelfTestStep" -A13 src/contracts/plugin.ts` → fields `writeFile`, `remove`, `keys`,
  `expect`, `alsoExpect`, `checksFit`, `screenshot`, `why`, `width`, `repeat`, `timeoutMs`; no `click`.
- `grep -n "^export async function click" src/main/drive/page-driver.ts` → one line: `click(window, selector, button,
  count)`, which throws before sending anything when the selector matches nothing, has no size, lies outside the
  window or is covered at its centre.
- `grep -n "function stepNextTo\|function stepToRow" src/plugins/sessions/main/selftest-script.ts src/plugins/forms/main/selftest-script.ts`
  → `stepNextTo(label)` in sessions (max `PROJECT_DIRS.length - 1`) and `stepToRow(key, label)` in forms (max
  `STEP_TO_ROW_PRESSES_MAX = 13`): the two copies of one shape.
- `grep -c "<A-S-[io]>" src/plugins/chat/main/selftest-script.ts` → 24: chat steps rows by single presses.
- `grep -n "sourceReplaced" src/plugins/docs/page/docs-view.ts src/plugins/docs-session-tab/page/start.ts` → the view's
  `sourceReplaced` rebuilds only `if (hasRun)`; docs-session-tab calls it on a row's host id change.
- `grep -n "SESSION_SOURCE_TITLE =" src/plugins/docs/main/index-sources.ts` → `'session index'`; `resultLine` in
  `docs-view.ts` logs `<title> rebuilt: <n> entries`, `<title> read: <n> entries` or `<title>: <message>`.
- `grep -n "runIndex(" src/plugins/docs/page/docs-view.ts` → `runIndex` is the only caller of `resultLine`. It runs
  from `showFirstTime` (once per view, behind `hasRun`), `rescan`, `outsideChange` and `sourceReplaced`.
  `grep -n "outsideChange(" src/plugins/docs/page/start.ts` → called only from `changedIn`, when another view saves,
  creates, moves or trashes a doc in the app. `grep -n "title: SESSION_SOURCE_TITLE" -A3 src/plugins/docs/main/index-sources.ts`
  → a session source has `load` and no `rebuild`, so `canRebuild` is false and `showFirstTime` runs one load only.
  `grep -n "MACHINE_SOURCE_TITLE =" src/plugins/docs/main/index-sources.ts` → `'machine index'`: Docs mode's view
  logs another title. Docs main logs no `session index` line.
- `grep -n "cannot click" docs/features/app-update/design.md` → line ~112: `app-update.pressButton` "clicks the drawn
  button, since the self-test cannot click".
- `grep -n "order: [0-9]" src/plugins/docs-session-tab/page/start.ts src/plugins/chat/page/chat-view.ts` → Docs tab
  `order: 1`, Chat tab `order: 2`: `<A-i>` (`sessions.prevTab`) from a Chat tab shows its Docs tab.
- `grep -rn "commands.register(" src/plugins --include=*.ts | grep -v test` → nothing: no plugin registers a runtime
  command yet. `PluginCommands.register(short, decl, handler)` in `src/contracts/plugin.ts` adds one qualified by the
  plugin id.
- `grep -n "'<Leader>zf\|' ', 'z', 'f'" -r src/plugins` → nothing: `Space z f` is free. (`Space z a u` is app-update's
  self-test-only bind, the pattern this task follows.)
- `grep -n "'is-focused'" src/shared/page/pane-tree/pane-tree-view.ts` and `grep -n "chat-side-section-head" src/plugins/chat/page/side-sections.ts`
  → the focused `.pane-tree-slot` carries `is-focused` when two or more panes show; a hub head is a
  `button.chat-side-section-head` whose click toggles its section.

Consumes:  nothing from another task. `click` (`src/main/drive/page-driver.ts`), `formsChooseCommand`
           (`src/plugins/forms/contract.ts`), `PluginCommands.register`, `formsScope` (`src/plugins/forms/ids.ts`) — in the tree.

Produces:
- `click?: string` on `SelfTestStep` in `src/contracts/plugin.ts`
- `export function stepToSessionRow(key: '<A-S-o>' | '<A-S-i>', until: string, max: number): SelfTestStep` in
  `src/plugins/sessions/contract.ts`

Decisions:
- **The click step (L869).** `SelfTestStep.click` is a CSS selector. `runStep` clicks it once, with the left button
  and a click count of 1 (`click(window, step.click, 'left', 1)`), after the write and the removal and before the
  keys; the log mark is taken before, as for the write, so a line the click alone causes counts. A step may click
  and press keys; a repeating step clicks once, before its first press, and repeats only the keys. When `click`
  throws (no match, no size, outside the window, covered), the step fails without pressing its keys, reported as
  `<label> -> <expect>: <the error's text>`. `isCurrent` is checked before the click as before the write.
  `stepLabel` names it `click <selector>`, after the write and removal parts and before the keys. The contract's
  comment above `SelfTestStep` gains a sentence saying so, and the AGENTS.md § Running and testing self-test paragraph
  (the sentence listing `writeFile`, `remove` and `screenshot`) gains `a step's click` the same way. No step check
  is added: a selector is checked by the click itself.
- **The chat click step.** In chat's `session hub` group, between the `Enter` step (`[page] Enter ran
  sessions.pickerChoose`, which leaves the new right pane focused) and the `<A-w>` step, add two steps:
  1. `{ click: '.pane-tree-slot:not(.is-focused) .chat-side-section-head', keys: [], expect: '[chat] section Main agent collapsed', why: 'The first click in an unfocused pane reaches the hub head it lands on.' }`
  2. `{ click: '.pane-tree-slot.is-focused .chat-side-section-head', keys: [], expect: '[chat] section Main agent expanded', why: 'The click focused that pane, and its head expands the section again for the groups after.' }`
  The left pane shows chat-selftest, whose hub's only head is Main agent (`PANE_KEYS_STEPS`' `G` step says so). The
  `<A-w>` step after them stays as it is (`[sessions] pane closed`) and now closes the left pane, the focused one,
  leaving the picked session's pane: every session the picker lists here is one of chat's own, so the `stop all`
  group after it still starts on a Chat tab. It gains a `why`: "The clicks left the left pane focused, so it closes."
- **One row-step helper (L850).** `stepToSessionRow(key, until, max)` in sessions' contract, next to
  `DRIVE_SESSION_DEFAULTS`: returns `{ keys: [key], expect: \`[page] ${key} ran ${command}\`, repeat: { until, max }, why }`,
  where `command` is `sessions.nextSession` for `<A-S-o>` and `sessions.prevSession` for `<A-S-i>`, and `why` is forms'
  text today ("Rows opened together can tie on their stamps and earlier scripts can leave rows open, so this script's
  rows draw in no fixed order."). Sessions owns the commands and the activation line, and all three scripts already
  import its contract. `until` is the whole line, so chat can wait on its own. Forms' `stepToRow` and
  `SESSION_STEP_COMMANDS` and sessions' `stepNextTo` go; their call sites call the helper with
  `` `[sessions] activated ${label}` `` and their own max (forms `STEP_TO_ROW_PRESSES_MAX`, 13; sessions
  `PROJECT_DIRS.length - 1`, 2).
- **Chat's row steps.** Every chat step whose keys are exactly `['<A-S-o>']` or `['<A-S-i>']` and whose `expect` is
  `[chat] Chat tab shown in <name>` becomes `stepToSessionRow(key, \`[chat] Chat tab shown in ${name}\`, CHAT_STEP_TO_ROW_PRESSES_MAX)`,
  a new chat constant of 13 with forms' comment (past this script's other rows and the rows earlier scripts left open,
  once round the list). A step that keeps a `why` keeps it by spreading (`{ ...stepToSessionRow(…), why }`, as forms
  spreads `checksFit`). Left as they are: the steps where the row key is one of several keys or the `expect` is
  another line (`TWO_SESSIONS_STEPS`' Effort-picker and Folder-picker steps and its `['i', …'hi', 'Escape', 'v',
  '<A-S-i>']` step, `ROW_ACTIVITY_STEPS`' send-then-`<A-S-o>` step and its `<A-S-i>` step expecting `row activity …
  none`): each proves what leaving a session does, and a repeat would replay its other keys. Before converting, check
  that the Chat tab line logs in the same task as the press's `[page] <key> ran …` line: follow `sessions.nextSession`
  in `src/plugins/sessions/page/start.ts` to `publishFocused` and the `tab.shown()` call (`showTab`), with no `await`,
  timer or frame between. If one sits between, the `until` is `` `[sessions] activated ${label}` `` instead, with
  `label` the row label the filtered run's report prints for that row at that step.
- **The Docs tab rebuild (L777).** In chat's `CLEAR_STEPS`, after the step to chat-second and before the `/reset`
  send, add `{ keys: ['<A-i>'], expect: '[docs] Docs tab shown', alsoExpect: [SESSION_INDEX_LINE], why: "chat-second's Docs tab shows, so the clear's new host id rebuilds it." }`
  and `{ keys: ['<A-o>'], expect: '[chat] Chat tab shown in chat-second' }`; the `/reset` step's `alsoExpect` gains
  `SESSION_INDEX_LINE` and a `why`: "The new host id rebuilds the Docs tab that has shown." `SESSION_INDEX_LINE` is a
  chat-script constant `/^\[docs\] session index( rebuilt| read)?: /` with a comment naming docs' `resultLine` and
  `SESSION_SOURCE_TITLE` (chat main may not import docs, so the title is written out).
- **Why the `/reset` step's session index line comes only from `sourceReplaced`.** The line names no session. So the
  step proves the rebuild only while no other view can log the line between the `/reset` send and its expect. No other
  view can, by the Preconditions. `resultLine` logs only from `runIndex`. `showFirstTime` runs once per view, and
  chat-second's single load logs before the `<A-i>` step passes (its `alsoExpect` waits for the line). A session
  source has no rebuild, so no second run follows that load. `rescan` runs only on its key. `outsideChange` runs only
  when a view saves, creates, moves or trashes a doc in the app, and chat's steps edit no doc. `sourceReplaced` runs
  on a row's host id change, and in this window only chat-second's `/reset` changes one. Docs mode's view logs
  `machine index`, not `session index`. Main's `docChanged` events reach only the doc pane, not `runIndex`. So the
  expect stays as written. If the filtered run shows a `session index` line in that window from another cause, treat
  it as a finding under **A failing proving step** below.
- **`forms.choose` across the Bridge (L224).** Forms' main part, when `selfTest` is not null, registers a runtime main
  command before handing the script: `api.commands.register('selfTestChoose', { label: 'choose from main (self-test)', group: 'items', runsIn: 'main', arg: 'number' }, ({ arg }) => api.commands.run(formsChooseCommand, arg))`,
  its Disposable filed by the API. Forms' script `PAGE_BINDS` gains `{ keys: [' ', 'z', 'f', 'c'], scope: formsScope('forms'), command: 'forms.selfTestChoose', arg: 2 }`
  with a comment: the page runs a main command through `bridge.runCommand` with the arg, and main runs the page's
  `forms.choose` with the arg it got, so the arg crosses the Bridge both ways. A leader bind is left out of the
  placement check, so it needs no anchor. In `FINDING_PICKS_STEPS`, after `{ keys: ['2'], expect: '[forms] cleared the choice on finding 1' }`,
  add `{ keys: [' ', 'z', 'f', 'c'], expect: '[forms] chose 2 on finding 1', why: "Space z f c runs main's forms.selfTestChoose with 2 through the page's bridge.runCommand; main runs forms.choose with the 2 it got, back on the page." }`
  and `{ keys: [' ', 'z', 'f', 'c'], expect: '[forms] cleared the choice on finding 1', why: 'The same number from main clears the pick, so the steps after start as before.' }`.
  This is the self-test's form of the item's live proof (a round showing the row, the command run from the page and
  from main): it runs on every forms self-test.
- **App-update's wording.** App-update's script binds `Space z a u` because "it cannot click". That comment becomes
  untrue once the click step lands, so reword it to "the button has no key" without changing the step. Reword the same
  reason in `docs/features/app-update/design.md` (line ~112, "since the self-test cannot click") to "since the button
  has no key".
- **A failing proving step.** The click steps, the `Space z f c` steps and the `/reset` step's `alsoExpect` prove
  claims. When one fails in the filtered run, it is an app bug: report it as a finding in the group's report. Never
  rewrite, soften or drop the step to make the run pass (another selector, another expected line, a removed
  `alsoExpect`). Fix the app within this task when the fix is in this task's Files or in the click path task 03
  changed. When the worker cannot fix it within the task, strike the step, and write the step, the failure and the
  reason in plan.md's Run log (§ Rulings).

GIVEN a step with `click` WHEN it runs THEN the click lands before its keys, a line it alone causes counts, and a
selector that cannot be clicked fails the step naming why, pressing nothing.
GIVEN chat's, forms' and sessions' scripts WHEN a step moves to a named row THEN it presses until that row's line,
whatever order tied rows draw in.
GIVEN chat-second's Docs tab has shown WHEN `/reset` gives the row a new host id THEN the Docs tab logs a session index
line again.
GIVEN a forms round on finding 1 WHEN `Space z f c` runs THEN `[forms] chose 2 on finding 1` logs, the 2 having gone
page → main → page.

Tests (`src/main/selftest-steps.test.ts`, under `describe('runScript')`, built like `runStep_Remove_TrashesBeforeTheKeys`
over `page(…)`, whose fake gains an `elementFromPoint` answer as `pageWithTargetAt60x40` in `page-driver.test.ts` does):
- `runStep_Click_ClicksBeforeTheKeys` — a step `{ writeFile, click: '.target', keys: ['j'], expect: '[t] j' }`: the
  recorded order is `write …`, the `mouseDown`/`mouseUp` pair, then `key j`; failures 0; the report line is
  `[selftest] PASS write p/a.txt, click .target, j -> [t] j`.
- `runStep_ClickLogsTheLine_PassesWithNoKeys` — the page logs `[t] clicked` on `mouseUp`; a step `{ click: '.target',
  keys: [], expect: '[t] clicked' }` passes.
- `runStep_ClickOnACoveredTarget_FailsWithoutPressing` — the fake answers `cover: 'div.scrim'`; the step fails (1
  failure), no `keyDown` is sent, and the report line ends `: .target is covered at its centre by div.scrim`.

Done when: compiles (`npm run typecheck`); `npm test` runs `src/main/selftest-steps.test.ts` green; `npm run lint`
clean; `npm run selftest -- --plugin chat --plugin forms --plugin sessions --plugin app-update` passes, or a failing proving step is reported and struck under **A failing proving step**. The click and
Bridge steps are proved by that run; the final verification task re-reads its report.

Commit:    one commit for the group, e.g. "Self-test click step, one row-step helper, a Docs tab rebuild step and
           forms.choose across the Bridge (follow-ups: Self-test has no click step; Chat self-test steps by single
           presses; Docs page test seam for a session's host id change; forms.choose through runCommand not proved)"

## Proof
