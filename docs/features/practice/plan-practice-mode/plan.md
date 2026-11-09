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
- [ ] [Practice: pure core](04-practice-pure-core.md)

### Wave 2
- [ ] [Chat main: per-session instructions, owner, main resume](02-chat-main-instructions-owner-resume.md) — after 01
- [ ] [Practice main: problem store, judge, progress](05-practice-main.md) — after 04

### Wave 3
- [ ] [Chat page: mountChat](03-chat-page-mount.md) — after 02
- [ ] [Practice: tools, import and interviewer sessions](06-practice-tools-sessions.md) — after 02, 05

### Wave 4
- [ ] [Practice page: mode, list and layout](07-practice-page-list.md) — after 06

### Wave 5
- [ ] [Practice page: problem workspace](08-practice-workspace.md) — after 07

### Wave 6
- [ ] [Practice page: interviewer pane and import box](09-practice-interviewer-import.md) — after 03, 08

### Wave 7
- [ ] [Practice self-test and drive action](10-practice-selftest.md) — after 09

### Wave 8
- [ ] [Doc re-read](11-doc-re-read.md) — after 10

### Wave 9
- [ ] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: aad3781f4f297de5f3763d2bdfe6d3c0916b6ab0

### Groups
- 01 · 9dc961ad · diff read: OpenOptions.owner, SessionRow.owner, sessionRow owner null present; typecheck clean; worker ran the 4 named test files green (271 tests) and lint clean · concerns: a second full-row literal in session-list.test.ts (~:911) needed owner: null, which the task doc did not name
### Contract changes
### Rulings
- 04's `npm run lint` proof moves to 05: check-layers.mts fails a plugin folder with no manifest.ts (line 817), and 05 adds the manifest — typecheck and the five tests prove 04 — a layer break in the root modules surfaces one wave later · lead
- activateExistingRow checks the owner before the no-row check, logging 'activateExistingRow for session <id> with an owner ignored' — the owner rule holds whether a row exists or not — only the log line differs if wrong · group 01 · group 01
- page start.ts pruneKeys still reads the unfiltered rows slot — a row with an owner never gets a place, so the read changes nothing — a stale place survives one reload if wrong · group 01 · group 01
### Review rounds
### Test gate
