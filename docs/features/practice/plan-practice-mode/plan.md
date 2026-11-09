# Practice mode — plan

Feature: Practice mode (C++ LeetCode-style practice) · Implements: none · Ticket: none
Target: main · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A Practice mode in wigley-ai-gui for solving LeetCode-style problems in C++: a flat problem list, a stacked problem
pane, vim editor and test console, a judge that compiles with clang++ and runs each case, Run and Submit with
LeetCode's verdicts, progress with a review ladder, problems imported only by an agent through a checked MCP tool, and
an interviewer chat pane that asks guiding questions and never gives answers.

## Architecture

Systems touched:

- **sessions** (main and page): rows gain an `owner`; owned rows are skipped by the side bar, the next and previous
  session keys and the pane tree.
- **chat** (main): `LaunchRequest` and `ResumeRequest` gain `instructions` and `owner`, saved with the session; a
  main `resume` export.
- **chat** (page): `mountChat`, the Chat tab's view built into another plugin's element behind one host interface.
- **practice** (new plugin): pure core modules at the plugin root, a main part (problem store, judge, progress, tools,
  import and interviewer sessions), a page part (Practice mode) and a layout (`practice.layout`).

## Preconditions

Each was verified at plan time; `wigley:make` re-runs them before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| clang++ is on the machine | `clang++ --version` | Apple clang version 21.0.0 |
| `Space k p`, `Space v i` and `⌘'` are unbound | `grep -c "<Leader>kp\|<Leader>vi\|<D-'>" src/plugins/keymap.ts` | `0` |
| no practice plugin yet | `ls src/plugins/practice` | no such folder |
| chat has no `mountChat`, no `owner` | `grep -n "mountChat\|owner?:" src/plugins/chat/contract.ts src/plugins/sessions/contract.ts` | nothing |
| `OpenOptions` is `{ select; rowId? }` | `grep -n "interface OpenOptions" -A4 src/plugins/sessions/contract.ts` | `select: boolean; rowId?: string;` |
| chat main exports `launch` but no `resume` | `grep -n "  resume(\|  launch(" src/plugins/chat/contract.ts` | `resume` only on the channel (line ~298), `launch` in `ChatMainExports` |

## Docs written ahead

Commits `2308d790`, `db9fbb63` and the later design commits on the plan's branch hold them:

- `docs/features/practice/design.md` — the settled design; every task reads it.
- `AGENTS.md` — the `practice/` plugin tree entry, chat's new exports (`launch`/`resume` with `instructions` and
  `owner`, page `mountChat`), and the row-with-an-owner paragraph under § A chat pane.
- `docs/features/layouts/design.md` — the `practice` adopter row.

## Mandatory Reads

Every task:

- `AGENTS.md` (repo root) through its last line, or the sections its task names: § Architecture's plugin, registration,
  slot, command, key, focus target, layout, setting and MCP tool bullets.
- `DESIGN.md` for any page task (07, 08, 09).
- `docs/keymap.md` for any task adding a key (07, 08, 09).
- `docs/features/practice/design.md`.
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in the repo (`find . -name 'CLAUDE*.md' -not -path './node_modules/*'`
  finds none).

## Design Overview

```
                         ┌──────────────── Practice mode (page) ───────────────┐
 side bar: problem list  │ problem pane  (Description · Submissions · Notes ·  │  interviewer pane
 (list reducer, `/`)     │               Solution)                             │  ask box → chat's
                         │ editor        solution.cpp (vim, autosave, :w)      │  mountChat(sessionId)
                         │ console       Testcase · Result                     │
                         └──────────────────────┬──────────────────────────────┘
                                                │ practice channel (list, open, save*, run, submit,
                                                │ peek, startImport, askInterviewer, interviewerOf)
                         ┌──────────────────────▼──────────────────────────────┐
                         │ practice main                                       │
                         │  problem store ── files under <folder>/problems/    │
                         │  judge ── prelude + driver → clang++ → per-case run │
                         │  progress ── attempts, submissions, ladder          │
                         │  tools: add_practice_problem, read_practice_state   │──► sessions.contributeTools
                         │  sessions: import (launch), interviewer             │──► chat.launch / chat.resume
                         │            (launch/resume with instructions, owner) │      (owner → hidden row)
                         └─────────────────────────────────────────────────────┘
```

Decisions (all from the interview; the design doc holds the full text):

- New plugin `practice` with main, page and a layout (AGENTS.md § Intent: everything draws through a layout). The
  design review's earlier "no layout" notice was withdrawn for that rule.
- Flat list, no Due section; a due mark per row (round 4).
- One interviewer per attempt, owned and hidden from Sessions (rounds 3 and 5).
- The judge runs one process per case; Run computes custom cases' expected answers from `reference.cpp`.
- The review ladder: a clean solve (the attempt's first Accepted, no peek) steps up; a peek resets to the first step;
  a Wrong Answer does not move it.
- Build output lives in `<folder>/.build/`, which ignores itself through its own `.gitignore` holding `*`.

Out of scope: other languages, autocomplete, a LeetCode account or network fetch, a streak, timer or score, a
per-session MCP tool list (the interviewer tool refuses other sessions at call time instead).

## File Structure

Existing files modified:

- `src/plugins/sessions/contract.ts`, `src/plugins/sessions/main/session-list.ts` and its saved-row code, the
  sessions page side bar order and pane placement, the next and previous session commands (01)
- `src/plugins/chat/contract.ts` (02 main part; 03 page part), `src/plugins/chat/main/chat-sessions.ts` and its
  saved-session record, `src/plugins/chat/main/start.ts` (02)
- `src/plugins/chat/page/chat-view.ts`, `src/plugins/chat/page/start.ts` (03)
- `src/plugins/manifests.ts`, `src/plugins/main.ts`, `scripts/check-layers.mts` (05: a `practice` entry in
  `PLUGIN_EXTRAS` with `contract: { layers: ['src/plugins/practice'] }`, because `contract.ts` imports the problem
  types from `./problem` (forms' precedent), and a sublayer for `main/judge.test.ts`, the real clang++ test, reaching
  `node:`, `src/main/processes` and `src/main/files`). 07 adds no contract extra: its `contract.ts` imports nothing
  from `layouts/`, and `layouts/layout.d.ts` writes its types inline in backlog's shape. A 07 change that makes
  `contract.ts` import `./layouts/layout` adds `'src/plugins/practice/layouts'` to that extra (workflow's precedent,
  check-layers.mts 186).
- `src/plugins/page.ts`, `src/plugins/keymap.ts`, `docs/keymap.md` (07; 08 and 09 add their binds)
- `src/shared/page/ui/split.ts`, `split.css`, `split.test.ts` and AGENTS.md § A resize target (08): `createSplit` gains
  `axis: 'column'` and `sizedPane: 'end'` for the stacked dividers and the interviewer's side slot, and `Split` gains
  `setEndHidden`
- `src/shared/plugin-part-harness.test-support.ts` (08): `countingEditors` gains a working `createDocument`

New files, all under `src/plugins/practice/`:

| Path | Task | Why |
|---|---|---|
| `problem.ts` | 04 | the `problem.json` types and `parseProblem`, shared by main and the tests |
| `driver.ts` | 04 | prelude, driver and stub sources from a `Problem` |
| `compare.ts` | 04 | answer comparison per compare mode |
| `compile-errors.ts` | 04 | compiler output rewritten to `solution.cpp:<line>` |
| `ladder.ts` | 04 | the review ladder |
| `manifest.ts`, `contract.ts` | 05 | the plugin, its settings, main commands, scopes `list`/`problem`/`editor`/`console`, and channel. Each page task adds the page commands it handles (`PageStart.commands` needs a handler per declared page command) and the scopes it binds: 07 `box`, 08 `confirm`, 09 `ask` and `import`. 07 adds the `layout` setting and `api.layouts.register` in `main/start.ts` |
| `main/start.ts`, `main/problem-store.ts`, `main/judge.ts`, `main/progress.ts`, `main/practice-runs.ts` | 05 | the main part; `practice-runs.ts` holds Run and Submit orchestration and `lastResult`, apart so it tests with a judge double |
| `main/practice-tools.ts`, `main/practice-sessions.ts`, `main/instructions.ts` | 06 | tools, import and interviewer sessions, built-in instruction text |
| `page/start.ts`, `page/practice-state.ts`, `page/practice-view.ts`, `page/practice.css`, `layouts/layout.d.ts`, `layouts/default/layout.js`, `layouts/default/layout.css`, `page/layout/read-layout.ts`, `page/layout/practice-kit.ts` | 07 | the mode, the list reducer, the layout |
| `page/problem-workspace.ts` (and the modules it splits into) | 08 | problem pane, editor, console, and the row split whose end is the interviewer's slot (`sizedPane: 'end'`, uiState key `interviewerWidth`), hidden until 09 shows it |
| `page/interviewer-pane.ts`, `page/import-box.ts` | 09 | the interviewer pane, which fills 08's side slot and builds no divider, and the import box |
| `main/selftest-script.ts`, `main/selftest-fixture.ts` | 10 | the self-test |

Boundary rules: the root modules (`problem.ts`, `driver.ts`, `compare.ts`, `compile-errors.ts`, `ladder.ts`) are pure,
import nothing outside `src/contracts`, and are read by `main/` and `page/` alike. `main/` reaches chat and sessions only
through `chatMainKey` and `sessionsMainKey`; `page/` reaches chat only through `chatPageKey`. No `PLUGIN_EXTRAS` entry
unless a task names why.

### Shared names

Names more than one task uses. A task that produces one writes it exactly so; a task may add members a later task
does not consume.

- `src/plugins/sessions/contract.ts` (01): `OpenOptions.owner?: string`; `SessionRow.owner: string | null`.
- `src/plugins/chat/contract.ts` (02): `LaunchRequest.instructions?: readonly string[]`, `LaunchRequest.owner?: string`,
  the same two on `ResumeRequest`; `ChatMainExports.resume(request: ResumeRequest): Promise<string>`.
- `src/plugins/chat/contract.ts` (03): `interface ChatMount extends Disposable { shown(): void; hidden(): void }`;
  `ChatPageExports.mountChat(element: HTMLElement, sessionId: string): ChatMount`. A mount made before the
  session's `chat.session` key or its row reaches the page returns at once and attaches when both arrive; it throws
  only for a row with no owner, a session already mounted, or a stopped page. The host needs no wait of its own.
- `problem.ts` (04): `type Difficulty = 'easy' | 'medium' | 'hard'`; `type CompareMode = 'exact' | 'anyOrder' |
  'anyOrderDeep' | 'float'`; `type ValueType` (the supported C++ types as written in a signature: `int`, `long long`,
  `double`, `bool`, `char`, `string`, `vector<T>` nested, `ListNode*`, `TreeNode*`; plus `void` for a design method's
  return); `interface Param { name: string; type: ValueType }`; `interface FunctionSignature { kind: 'function';
  method: string; params: Param[]; returns: ValueType }`; `interface DesignSignature { kind: 'design'; className:
  string; constructor: Param[]; methods: { name: string; params: Param[]; returns: ValueType }[] }`; `type JsonValue`;
  `interface FunctionCase { input: JsonValue[]; expected: JsonValue; visible: boolean }`; `interface DesignCase { ops:
  string[]; args: JsonValue[][]; expected: JsonValue[]; visible: boolean }`; `interface Problem { slug; title;
  difficulty; tags: string[]; lists: string[]; signature: FunctionSignature | DesignSignature; compare: CompareMode;
  cases: (FunctionCase | DesignCase)[] }`; `parseProblem(json: unknown, slug: string): Problem`, throwing
  `class ProblemError extends Error { readonly field: string }`; `parseValueType(text: string): ValueType | null`;
  `vectorElement(type: ValueType): ValueType | null`; `type CustomInput`; `parseCustomCases(text: string, signature):
  CustomInput[]` (`custom-cases.json` is a JSON array of a function case's input arrays, or `{ops, args}` for a design
  problem); `problemJson(problem: Problem): string`.
- `driver.ts` (04): `preludeSource(): string`; `driverSource(problem: Problem, solutionPath: string): string`;
  `stubSource(problem: Problem): string`.
- `compare.ts` (04): `answersMatch(expected: JsonValue, actual: JsonValue, mode: CompareMode): boolean`.
- `compile-errors.ts` (04): `mapCompileErrors(output: string, solutionPath: string): string`.
- `ladder.ts` (04): `interface ReviewState { step: number | null; due: string | null }` (`due` a `YYYY-MM-DD` day);
  `nextReview(state: ReviewState, outcome: 'clean' | 'peeked', today: string, steps: readonly number[]): ReviewState`;
  `isDue(state: ReviewState, today: string): boolean`; `addDays(day: string, days: number): string`; `dayOf(epochMs:
  number): string`.
- `contract.ts` (05): `type Verdict = 'accepted' | 'wrongAnswer' | 'timeLimit' | 'runtimeError' | 'compileError'`;
  `interface CaseResult { index: number; source: 'example' | 'custom' | 'hidden'; input: JsonValue; expected:
  JsonValue; output: JsonValue | null; stdout: string; stderr: string; verdict: Verdict; ms: number }`; `interface
  JudgeResult { verdict: Verdict; passed: number; total: number; ms: number; compileOutput: string | null; failing:
  CaseResult | null; cases: CaseResult[] }`; `type ProblemStatus = 'new' | 'attempted' | 'solved'`; `interface
  ProblemSummary { slug; title; difficulty: Difficulty; tags: string[]; lists: string[]; status: ProblemStatus; due:
  boolean }`; `interface Attempt { id: string; started: string; peeked: boolean; interviewer: { sessionId: string;
  hostSessionId: string } | null }`; `interface SubmissionRecord { time: string /* ISO 8601 */; verdict: Verdict; passed: number;
  total: number; ms: number; failing: CaseResult | null; code: string }`; `interface OpenedProblem { summary:
  ProblemSummary; statement: string; signature: FunctionSignature | DesignSignature; code: string; notes: string;
  customCases: string; attempt: Attempt; submissions: SubmissionRecord[] }`; `interface PracticeChannel extends
  ChannelShape` with these invoke members, each returning a `Promise` of the type written (05 writes them as
  `Promise<…>`): `list(): ProblemSummary[]`, `open(slug): OpenedProblem`, `saveCode(slug, text)`,
  `saveNotes(slug, text)`, `saveCustomCases(slug, text)`, `run(slug): JudgeResult`, `submit(slug): JudgeResult`,
  `peek(slug): { approach: string; reference: string }`, `startImport(request: string): string`,
  `askInterviewer(slug, text): string`, `interviewerOf(slug): string | null`, and message `changed` with payload
  `{ slug: string | null }` (the list or an open problem changed on disk, the app's own writes included, so the page
  never reloads a draft it has just saved: it replaces text only when the draft is saved and the text differs). The page
  saves `solution.cpp` before it invokes `run` or `submit`. `open` is called again on `changed` and after Submit, so it is idempotent: it starts a
  fresh attempt only when the problem is due and its current attempt started before the due date.
- `contract.ts` (07, 08): `interface PracticePlace { selectedSlug: string | null; openSlug: string | null; filter:
  string }` (07; 08 adds `pane`, `problemTab`, `consoleTab`), `practicePlaceSlot` (id `practice.place`),
  `practiceOpenProblemRowCommand: CommandKey<string, 'practice.openProblemRow'>` (07); `practiceShowTabCommand`,
  `practiceOpenSubmissionRowCommand` (08).
- `page/practice-state.ts` (07): `type PracticeFocus = 'list' | 'main' | 'interviewer'`; 07 never sets `interviewer`,
  09 does. `initialPracticeState().focus` is `list`.
- `page/practice-view.ts` (07, 08): `PracticeView.setFocus(focus: PracticeFocus): void` (07), the one setter of focus;
  each render applies the base scope, resize target and focus target from focus, and none while focus is
  `interviewer`. `PracticeView.focusColumn(): void` (08) gives the column its keys back. `applyOpened(problem:
  OpenedProblem): void` (08) is the one function that applies an `open` result; 09 calls its `problemOpened` there.
- `layouts/layout.d.ts` (07): `ListKit.importHint(parent): HTMLElement`, an empty `span.practice-import-hint` 09
  fills with the `practice.importStart` anchor.
- `src/shared/page/ui/split.ts` (08): `SplitOptions.axis?: 'row' | 'column'`, `SplitOptions.sizedPane?: 'start' |
  'end'`, `SplitDividerOptions.axis?`, `Split.setEndHidden(hidden: boolean): void`.
- `page/problem-workspace.ts` (08): `ProblemWorkspace.sidePane: HTMLElement`, `setSidePaneShown(isShown: boolean):
  void`, `sideResizeTarget: ResizeTarget`.
- `page/interviewer-pane.ts` (09): `InterviewerPane.problemOpened(slug: string, attemptId: string): void`, which
  remounts only when the pair changes; `columnTookKeys(): void`.
- `main/judge.ts` (05): `createJudge(deps)` returning `{ judge(problem: Problem, codePath: string, cases: JudgeCase[],
  options: JudgeOptions): Promise<JudgeResult> }`, `interface JudgeOptions { stopAtFirstFailure: boolean; signal?:
  AbortSignal }` (Submit stops at the first failure; Run and the import check do not), `JudgeCase` being a case with
  its `source`.
- `main/problem-store.ts` (05): `createProblemStore(deps)` — every read and write of the practice folder.
  `ProblemStore.writeBuildFile(relativePath: string, text: string): Promise<string>` writes under `<folder>/.build/`
  only and resolves the absolute path; 06's import check writes the reference there and judges it, so a refused
  import writes nothing under `problems/<slug>/`.
- `main/progress.ts` (05): attempts, submissions, status and the ladder over the store.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Sessions: owned rows](01-sessions-owned-rows.md)
- [x] [Practice: pure core](04-practice-pure-core.md)

### Wave 2
- [x] [Chat main: per-session instructions, owner, main resume](02-chat-main-instructions-owner-resume.md) — after 01
- [x] [Practice main: problem store, judge, progress](05-practice-main.md) — after 04

### Wave 3
- [x] [Chat page: mountChat](03-chat-page-mount.md) — after 02
- [x] [Practice: tools, import and interviewer sessions](06-practice-tools-sessions.md) — after 02, 05

### Wave 4
- [x] [Practice page: mode, list and layout](07-practice-page-list.md) — after 06

### Wave 5
- [x] [Practice page: problem workspace](08-practice-workspace.md) — after 07

### Wave 6
- [x] [Practice page: interviewer pane and import box](09-practice-interviewer-import.md) — after 03, 08

### Wave 7
- [x] [Practice self-test and drive action](10-practice-selftest.md) — after 09

### Wave 8
- [x] [Doc re-read](11-doc-re-read.md) — after 10

### Wave 9
- [x] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: aad3781f4f297de5f3763d2bdfe6d3c0916b6ab0

### Groups
- 01 · 9dc961ad · diff read: OpenOptions.owner, SessionRow.owner, sessionRow owner null present; typecheck clean; worker ran the 4 named test files green (271 tests) and lint clean · concerns: a second full-row literal in session-list.test.ts (~:911) needed owner: null, which the task doc did not name
- 02 · 4a6843cd · diff read: LaunchRequest/ResumeRequest instructions+owner, ChatMainExports.resume, SavedSession.instructions/owner present; typecheck clean; worker ran chat-sessions and open-sessions tests green (477), oxlint+oxfmt clean on chat (check-layers blocked by in-flight 04) · concerns: none
- 04 · 22cf5824 · diff read: every Produces export present in problem/driver/compare/compile-errors/ladder; typecheck clean; worker ran 5 test files green (88), oxlint+oxfmt clean, scratch clang++ build of prelude and three drivers clean and run; lint layer check deferred to 05 (lead ruling) · concerns: the driverSource guard refusing a quote or line break in the path has no test row (05's clang suite proves driver paths); long long row uses Number.MAX_SAFE_INTEGER + 1 since oxlint refuses the literal
- 03 · 626a107b · diff read: ChatMount, ChatPageExports.mountChat, ChatTabs.mount, ChatViewDeps.ownerOf/onRowAdded, TabHost present; npm run typecheck clean; worker ran chat-view + chat-commands tests (208 passed) · concerns: mount before page ready() attaches at once if key present, untested; dispose logs 'chat view unmounted: <name>' (unspecified log line); lint blocked only by 05's in-progress practice files
- 05 · e307542a · diff read: practiceManifest, contract types and PracticeChannel, judge/problem-store/progress/practice-runs exports, practiceMainPart present; typecheck clean; npm run lint clean over all practice (closes 04's deferred lint proof); worker ran src/plugins/practice tests 148 green incl. real clang · concerns: case time includes sanitizer crash report, slow symbolizing may read as TLE (ProcessRunner has no env option for ASAN_OPTIONS symbolize=0); UBSan null load exits 0, runtimeError only via stderr rule; files.watch creates <folder>/problems at start; no .exe so not Windows-ready (out of scope)
- 06 · afe8e279 · diff read: INTERVIEWER/IMPORT_INSTRUCTIONS, both tool definitions, PracticeToolsDeps, startPracticeTools, HOST_ID_WAIT_MS, PracticeSessionsDeps/PracticeSessions/createPracticeSessions present, start.ts wires events, tools and channel; typecheck clean; worker ran practice tests 175 green and lint clean · concerns: PracticeToolsDeps.log unused; AGENTS.md ~322 lists only launch/resume/defaultProfile as chat exports practice uses (also profileOf, send, close); tests use a hand-fired Timers double, not fake timers; tests store row-0 where doc says row-1
- 07 · bf1cce38 · diff read: practice-state exports, PracticeView/createPracticeView/setFocus/openProblemRow, PracticePlace/practicePlaceSlot/practiceOpenProblemRowCommand, layout.d.ts types, PracticeBaseScope/createPracticeKit present; keymap kp, list keys, page registration, layout register reviewed; typecheck clean; worker ran 18 files 224 tests and lint clean · concerns: practice-state.ts duplicates problem.ts's private DIFFICULTIES; layouts design.md lacks a practice adopter row (task 11); view.dispose disposes its draws though backlog's does not, untested; changed-reread test checks via practice.place
- 08 · 8de85a0e · diff read: Split axis/sizedPane/setEndHidden, createProblemWorkspace/ProblemWorkspace/WorkspacePane, focusColumn/applyOpened, workspace-state and case-text exports, practiceShowTabCommand/practiceOpenSubmissionRowCommand, PracticePlace pane/problemTab/consoleTab present; AGENTS.md and DESIGN.md split prose read; typecheck clean; worker ran 77 files 1952 tests and lint clean · concerns: edits outside Files: DESIGN.md (stale Split entry) and practice-state.ts (placeOf); task doc said 'type' drives the code editor but it reaches the last box, so typeDocument was added; split layout, confirm placement, real editor :w/:wq/:q and focus moves unchecked live (task 12)
- 09 · dff5247b · diff read: createInterviewerPane/InterviewerPane, createImportBox/ImportBox, six manifest commands, ask and import scopes, askBox/importBox parts, keymap vi/a/ask/import binds present; typecheck clean; worker ran 21 files 275 tests and lint clean · concerns: import-box.ts copies rename-dialog.ts's restoreFocus closure (shared helper would need rename-dialog edit); ask frame's CodeMirror box is moved not remounted on layout redraw, unchecked live; pane holding keys with nothing shown sets practice.ask and focuses the root, untested; keys.anchor takes an options object, not the doc's positional scope
- 10 · 364c0343 + 430f11f4 · diff read: selftest-fixture (PRACTICE_FIXTURE_SLUGS), selftest-script, start.ts drive action practice.writeFixture and script handover present; selftest isolation shown (selfTest runMode mkdtemp home); typecheck clean; worker ran practice/main tests 91 green and lint clean; npm run selftest -- --plugin practice failed 3 checksFit (08 CSS overflow), fixed in 430f11f4, rerun all passed · concerns: ResizeObserver loop errors from the vite client around interviewer steps, not failing; tab strip keeps default ui-tabs margin inside the bar (sessions zeroes it) — check visually
- 11 · a1d139d2 · diff read of five docs against code: AGENTS.md chat exports/sessions owner/practice entry, layouts practice row, chat-panes owned-session line, agent-chat per-session instructions, practice design keys/scopes/tools/interviewer/import/self-test; lint clean · concerns: design.md does not name the 'chat view unmounted' and 'watch not started' log lines
- 12 · 961cd4a4 · lint, typecheck green; test gate 3037 green; filtered selftest practice+chat+sessions all passed; clang++ present so judge steps ran; live-check list carried to the wrap-up · concerns: none
### Contract changes
- driverSource include of solutionPath: a C string literal with \ and " escaped → the path written verbatim, driverSource throwing on a path holding " or a line break · why: clang reads an #include "…" path literally with no escape processing, so escaping breaks any backslash path · consumers: 05 · group 04
- 05 main/problem-store.ts ProblemStoreDeps gains log: PluginLog (logs unparsable submission files and 'watch stopped: <reason>'); consumers: 06 builds nothing from it (only start.ts builds the store)
- PracticeViewDeps.opened(problem) set the title-bar context and called mode.picked() → opened only sets the context; a separate picked() dep is called by Enter, a row click and focusMain · why: l and the restore-on-load open keep list focus, and picked() closes a narrow window's side-bar overlay, moving focus to main · consumers: 08, 09 · group 07
- PracticeView also has showTab, openSubmissionRow and mayStop; PracticeViewDeps gains editor, uiState, timers, run(CommandId), addOverlay, and pushScope takes 'box' | 'confirm' · why: start.ts routes arg commands and mayStop through the view; the workspace needs those deps · consumers: 09 · group 08
- placeOf(state) returns Pick<PracticePlace, 'selectedSlug' | 'openSlug' | 'filter'>; the view merges the workspace's pane and tabs · why: PracticePlace gained fields the list does not own · consumers: none outside the view · group 08
- countingEditors.createDocument returns a counted no-op DocumentEditor; adds typeDocument(text) driving the last document editor · why: the testcase box mounts after the code editor, so type reaches the box · consumers: practice start tests · group 08
- PracticeViewDeps gains showMode(), setOuterPanes(panes), mountChat(element, sessionId); pushScope takes 'box' | 'confirm' | 'import'; PracticeView gains hidden() and shown() sets outer panes; PracticeBaseScope gains 'ask' and PracticeKitScope 'import'; InterviewerPaneDeps takes drawAskBox, focus(), problemTitle(); ImportBoxDeps takes drawBody · why: the view builds pane and box and owns the parts; ask is a main-view scope · consumers: start.ts, 10, 11 · group 09
### Rulings
- 04's `npm run lint` proof moves to 05: check-layers.mts fails a plugin folder with no manifest.ts (line 817), and 05 adds the manifest — typecheck and the five tests prove 04 — a layer break in the root modules surfaces one wave later · lead
- activateExistingRow checks the owner before the no-row check, logging 'activateExistingRow for session <id> with an owner ignored' — the owner rule holds whether a row exists or not — only the log line differs if wrong · group 01 · group 01
- page start.ts pruneKeys still reads the unfiltered rows slot — a row with an owner never gets a place, so the read changes nothing — a stale place survives one reload if wrong · group 01 · group 01
- resume selects only when request.owner is undefined, so an empty-string owner opens unselected — follows the Decisions line literally — an empty owner string is no real caller · group 02 · group 02
- function driver calls new Solution() then solution->method — keeps large member arrays off the stack — none, leaks not reported · group 04 · group 04
- the driver declares each call's result with the signature's return type before to_json — one to_json overload is picked when the user's return converts — none · group 04 · group 04
- vector element errors carry the element path; ListNode*/TreeNode* errors carry the whole value's path; a missing required field reads 'required'; design ops/args length mismatch fails at cases[i].args, ops/expected at cases[i].expected; design methods may be empty — the plan named none of these — only error paths differ if wrong · group 04 · group 04
- 03: only mount paths call root.remove() (dispose, row removal, view.dispose); Sessions tabs' roots are dropped by sessions · group 03
- 03: a row leaving also deletes a waiting mount (handle goes dead) and its awaitingRow entry · group 03
- 03: visibleTab requires lastShown still held (tabs.get(id) === lastShown); lastShown is kept after removal for otherSessionShown · group 03
- 03: onRowAdded re-runs add only for sessions in awaitingRow; a row before its key waits for the key's arrival · group 03
- 03: test harness rowAdded(sessionId, owner) sets owner then fires; ownerOf returns null for a session absent from owners · group 03
- 05: hasProblem(slug) true only when problem.json exists · group 05
- 05: submit reads solution.cpp before judging so recorded code is the judged code · group 05
- 05: recordSubmission and peek append an attempt when progress.json has none · group 05
- 05: start.ts catches a watch that cannot start and logs 'watch not started: <reason>' · group 05
- 05: reference refusal names the verdict by its id · group 05
- 05: real-clang judge tests use timeLimitMs 3000 · group 05
- 05: shared fixtures in main/practice-fixtures.test-support.ts · group 05
- 06: add_practice_problem refuses a blank or non-string slug · group 06
- 06: add_practice_problem writes problem.json last · group 06
- 06: Added/Replaced follows whether the slug existed, not the replace flag · group 06
- 06: askInterviewer calls per slug run serially on a promise chain · group 06
- 06: host-id timeout logs 'interviewer <id> not closed: <reason>' when the close rejects; failed cleared logs 'interviewer <id> host id not moved: <reason>' · group 06
- 06: opened while hostIdOf waits hands the id straight to the waiting read · group 06
- 06: read_practice_state prints failing case as Input/Expected/Output/Stdout/Stderr JSON lines, (empty) for no solution, None. for no attempt · group 06
- 06: askInterviewer rejects '<slug> has no interviewer; ask again.' when a new attempt opened between reads · group 06
- 07: PracticeAction loadFailed sets message, keeps isLoaded and rows; no layout surface shows message · group 07
- 07: placeRestored keeps openSlug only when a loaded problem holds it · group 07
- 07: an open overtaken by a later open is dropped (request counter) · group 07
- 07: resize target null for list and main focus; 08 replaces main · group 07
- 07: select and focus return the same state when nothing changes · group 07
- 07: default problemRow builds icon and marks then passes them to kit.row as leading/trailing · group 07
- 07: layout.css rules all scoped under [data-layout-owner='practice'] · group 07
- 08: applyOpened on the shown slug refreshes in place keeping tabs, pane and drafts; another slug saves old drafts first · group 08
- 08: reload re-reads the open problem outside the open-request counter, dropped if an open started or openSlug changed; failure logs 'not refreshed <slug>: <err>' with no toast · group 08
- 08: the place never stores the solution tab · group 08
- 08: empty noSubmissions draws with the practice.problem kit · group 08
- 08: setBaseScope only when the confirm's asked flips; a pane change while the confirm shows dismisses it as confirmNo · group 08
- 08: scroll keys act on the problem body, or the console body when the console holds keys · group 08
- 08: the workspace mounts into main as soon as an open lands, before show() finishes saving old drafts · group 08
- 08: a peek answer after leaving the problem is logged and dropped · group 08
- 09: practice.ask is a base scope set via setScope (main-view scope in the C-n list), not pushed; import is pushed · group 09
- 09: opening the pane with a live mount takes keys at once without re-asking interviewerOf · group 09
- 09: opening takes keys when the interviewerOf answer lands; hide, modeHidden or a pair change first cancels · group 09
- 09: toggleInterviewer with Practice hidden and the pane shown only shows Practice · group 09
- 09: a click into the ask box gives the pane the keys; a click into a mounted chat view does not · group 09
- 09: logs 'interviewer not read <slug>: <err>' and 'interviewer not mounted <slug>: <err>' with error toasts · group 09
- 09: import box closes its scope with dispose(), sends trimmed requests, logs 'import failed' even after close · group 09
- 10's filtered selftest failed only checksFit at the workspace's minimum width (split panes and pane headers overflow 368px), caused by 08's layout CSS: the overflow is fixed in the practice layout CSS by a fix dispatch, never by dropping checksFit — a real overflow stays visible — lead
- 10: drive action via api.drive?.add and script via services.selfTest?.run, no explicit runMode check · group 10
- 10: result checks compiler and submission in parallel; exactly-one submission read once the first .json appears · group 10
- 10: groups are a module constant · group 10
- 10 fix: header wraps, tabs bar shrinks with ui-tabs--scroll strip; narrow console actions drop under the tabs · group 10
- 11: layouts design.md already had a practice row; rewritten against layout.d.ts instead of added · group 11
- chat/page/start.test.ts fake Sessions addTab runs a visible tab's shown() inside addTab, per the SessionTabView contract; the view's visibleTab now depends on shown() having run (03) — the real sessions page calls tab.shown() on each visible change and the chat+sessions self-test passed — lead
- Review round 1: determined behaviour-preserving items ride the per-file fix dispatches (one writer per file per round) instead of a lead-applied commit
- re-review 1 coverage: backlog/main/selftest-script.ts (W4 holdsWithin move) owned by no lane; lead read the diff (pure move to shared/holds-within.ts, backlog selftest green) and the cycle-2 lane owns it
- fix cycle 2: picks per § Review rule — #1 startWatching() from the list handler; #8 applyOpened refreshes a re-picked shown slug; stale-comment recommendations (contract.ts open comment, practice-view.ts ask-box comment) ride the same per-file dispatches
### Review rounds
- Round 1 at 48989f35: 8 lanes (correctness A–E, plan-and-design P1–P3), NEEDS FIXES — 1 Critical, 13 Important, 38 Minor; open items take recommended picks per § Review rule; report /tmp/claude-practice-mode/review-48989f35.md
- re-review 1 (correctness R1+R2, 48989f35..cc813ebb, pinned cc813ebb): NEEDS FIXES — 1 Important (repeat of #41: lazy watch starts on slugs(), reached by /clear), 6 Minor, 1 pre-existing open (re-pick of shown slug during a waiting show); report /tmp/claude-practice-mode/review-cc813ebb.md
### Test gate
- picks (writing-tests § Picking tests for a gate over aad3781f..HEAD): src/plugins/sessions src/plugins/chat src/plugins/practice src/plugins/notes/page/start.test.ts src/shared/page/ui src/plugins/keymap.test.ts src/plugins/manifests.test.ts src/shared/layouts src/shared/plugin-part-harness.test.ts src/plugins/backlog/page/start.test.ts src/plugins/forms/page/start.test.ts src/plugins/primer/page/start.test.ts src/renderer/plugins/page-api.test.ts src/main/built-in-themes.test.ts; plus npm run selftest -- --plugin practice --plugin chat --plugin sessions
- result: lint and typecheck green; picks 111 files 3037 tests green after 961cd4a4 (first run failed 5 in chat/page/start.test.ts: harness published no sessions row and its fake addTab never ran shown(); fixed in the test only); npm run selftest -- --plugin practice --plugin chat --plugin sessions all passed
- fix cycle 1 (95c996c9..cc813ebb): typecheck + lint green; vitest 129 files / 3338 tests green; filtered selftest --plugin practice --plugin chat --plugin sessions --plugin backlog all passed
