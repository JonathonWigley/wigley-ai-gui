# 05 — Practice main: problem store, judge, progress

Status: not started
Type: Task
Wave: 2 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/practice/manifest.ts` · `src/plugins/practice/contract.ts` ·
           `src/plugins/practice/main/start.ts` · `src/plugins/practice/main/problem-store.ts` ·
           `src/plugins/practice/main/judge.ts` · `src/plugins/practice/main/progress.ts` ·
           `src/plugins/practice/main/practice-runs.ts` ·
           modify `src/plugins/manifests.ts` · `src/plugins/main.ts` · `scripts/check-layers.mts` ·
           test `src/plugins/practice/main/problem-store.test.ts` · `src/plugins/practice/main/judge.test.ts` ·
           `src/plugins/practice/main/progress.test.ts` · `src/plugins/practice/main/practice-runs.test.ts` ·
           `src/plugins/practice/main/start.test.ts`
Consumes:  from 04: `Problem`, `FunctionCase`, `DesignCase`, `JsonValue`, `Difficulty`, `FunctionSignature`,
           `DesignSignature`, `ProblemError`, `parseProblem(json, slug)`, `parseCustomCases(text, signature)`,
           `CustomInput`, `preludeSource()`, `driverSource(problem, solutionPath)`, `stubSource(problem)`,
           `answersMatch(expected, actual, mode)`, `mapCompileErrors(output, solutionPath)`, `ReviewState`,
           `nextReview(state, outcome, today, steps)`, `isDue(state, today)`, `dayOf(epochMs)`.
           From the tree: `MainApi`, `MainPart`, `MainServices` (`src/contracts/plugin.ts` 1018-1080, 962-991);
           `Files` with `watch` and `readIfPresent` (`src/contracts/files.ts` 33-121); `ProcessRunner`
           (`src/contracts/processes.ts` 22-35); `Paths.expandTilde` (`src/contracts/paths.ts` 36); `Clock`, `RandomHex`
           (`src/contracts/ambient.ts`); `definePlugin` (`src/shared/define-plugin`); `errorText`
           (`src/shared/error-text`); `chatMainKey` and `sessionsMainKey` named in `dependsOn` only (06 reads them).
           Test support: `startMainPart`, `fakeDependency` (`src/shared/plugin-part-harness.test-support.ts` 105, 966),
           `createMemoryFiles` (`src/shared/memory-files.ts` 36), `posixPaths` (`src/shared/paths/posix-paths`),
           `createNodeProcesses` (`src/main/processes/node-processes.ts` 16), `createNodeFiles`
           (`src/main/files/node-files.ts` 50, options `{ trashItem, os }` 41-46).
Produces:
- `manifest.ts`: `practiceManifest`.
- `contract.ts`, word for word as plan.md § Shared names, each channel return a `Promise` as every channel contract
  in the tree writes it (`src/plugins/backlog/contract.ts` 159-181):
  `type Verdict = 'accepted' | 'wrongAnswer' | 'timeLimit' | 'runtimeError' | 'compileError'`;
  `interface CaseResult { index: number; source: 'example' | 'custom' | 'hidden'; input: JsonValue; expected:
  JsonValue; output: JsonValue | null; stdout: string; stderr: string; verdict: Verdict; ms: number }`;
  `interface JudgeResult { verdict: Verdict; passed: number; total: number; ms: number; compileOutput: string | null;
  failing: CaseResult | null; cases: CaseResult[] }`; `type ProblemStatus = 'new' | 'attempted' | 'solved'`;
  `interface ProblemSummary { slug: string; title: string; difficulty: Difficulty; tags: string[]; lists: string[];
  status: ProblemStatus; due: boolean }`; `interface Attempt { id: string; started: string; peeked: boolean;
  interviewer: { sessionId: string; hostSessionId: string } | null }`; `interface SubmissionRecord { time: string;
  verdict: Verdict; passed: number; total: number; ms: number; failing: CaseResult | null; code: string }`;
  `interface OpenedProblem { summary: ProblemSummary; statement: string; signature: FunctionSignature |
  DesignSignature; code: string; notes: string; customCases: string; attempt: Attempt; submissions:
  SubmissionRecord[] }`;
  `interface PracticeChannel extends ChannelShape { invoke: { list(): Promise<ProblemSummary[]>; open(slug: string):
  Promise<OpenedProblem>; saveCode(slug: string, text: string): Promise<void>; saveNotes(slug: string, text: string):
  Promise<void>; saveCustomCases(slug: string, text: string): Promise<void>; run(slug: string): Promise<JudgeResult>;
  submit(slug: string): Promise<JudgeResult>; peek(slug: string): Promise<{ approach: string; reference: string }>;
  startImport(request: string): Promise<string>; askInterviewer(slug: string, text: string): Promise<string>;
  interviewerOf(slug: string): Promise<string | null> }; messages: { changed: { slug: string | null } } }`.
- `main/judge.ts`: `type JudgeCase = (FunctionCase | DesignCase) & { source: 'example' | 'custom' | 'hidden' }`;
  `interface JudgeOptions { stopAtFirstFailure: boolean; signal?: AbortSignal }`; `interface JudgeSettings {
  buildFolder: string; compiler: string; flags: string; timeLimitMs: number }`; `interface JudgeDeps { files: Files;
  processes: ProcessRunner; paths: Paths; clock: Clock; settings(): JudgeSettings }`; `interface Judge {
  judge(problem: Problem, codePath: string, cases: JudgeCase[], options: JudgeOptions): Promise<JudgeResult> }`;
  `createJudge(deps: JudgeDeps): Judge`.
- `main/problem-store.ts`: `type ProblemFile = 'problem.json' | 'problem.md' | 'reference.cpp' | 'approach.md' |
  'solution.cpp' | 'notes.md' | 'custom-cases.json' | 'progress.json'`; `interface ProblemStoreDeps { files: Files;
  paths: Paths; folder(): string }`; `interface ProblemStore { folder(): string; buildFolder(): string; slugs():
  Promise<string[]>; hasProblem(slug: string): Promise<boolean>; readProblem(slug: string): Promise<Problem>;
  filePath(slug: string, file: ProblemFile): string; readText(slug: string, file: ProblemFile): Promise<string |
  null>; writeText(slug: string, file: ProblemFile, text: string): Promise<void>; writeBuildFile(relativePath:
  string, text: string): Promise<string>; submissions(slug: string):
  Promise<SubmissionRecord[]>; writeSubmission(slug: string, record: SubmissionRecord): Promise<void>;
  interviewerText(): Promise<string | null>; watch(onChange: (slug: string | null) => void): Disposable }`;
  `createProblemStore(deps: ProblemStoreDeps): ProblemStore`.
- `main/progress.ts`: `interface ProgressFile { status: ProblemStatus; review: ReviewState; attempts: Attempt[] }`;
  `interface ProgressDeps { store: ProblemStore; clock: Clock; randomHex: RandomHex; steps(): readonly number[] }`;
  `interface Progress { read(slug: string): Promise<ProgressFile>; summary(slug: string, problem: Problem):
  Promise<ProblemSummary>; open(slug: string, problem: Problem): Promise<Attempt>; peek(slug: string):
  Promise<void>; recordSubmission(slug: string, result: JudgeResult, code: string): Promise<SubmissionRecord>;
  setInterviewer(slug: string, attemptId: string, interviewer: Attempt['interviewer']): Promise<void> }`;
  `createProgress(deps: ProgressDeps): Progress`.
- `main/practice-runs.ts` (a file plan.md does not list; reason below): `interface LastResult { kind: 'run' |
  'submit'; result: JudgeResult }`; `interface PracticeRunsDeps { store: ProblemStore; progress: Progress; judge:
  Judge }`; `interface PracticeRuns { run(slug: string): Promise<JudgeResult>; submit(slug: string):
  Promise<JudgeResult>; lastResult(slug: string): LastResult | null }`; `createPracticeRuns(deps: PracticeRunsDeps):
  PracticeRuns`.
- `main/start.ts`: `practiceMainPart: MainPart<typeof practiceManifest>`; inside it the `store`, `progress`, `judge`
  and `runs` objects that 06 hands to its tools and sessions.

Decisions:
- **Manifest** (design.md § The mode; the lead's ruling for 05/07/08/09):

  ```ts
  definePlugin({
    id: 'practice',
    label: 'Practice',
    description: 'Adds Practice mode, for solving LeetCode-style problems in C++ with a judge, progress and an interviewer.',
    dependsOn: { main: ['chat', 'sessions'], page: ['chat'] },
    reads: { main: [], page: [] },
    commands: {},
    scopes: { list: 'In the practice list', problem: 'In the practice problem pane', editor: 'In the practice editor',
      console: 'In the practice console' },
    settings: { folder: '~/leetcode', compiler: 'clang++',
      flags: '-std=c++20 -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer', timeLimitMs: 2000,
      reviewSteps: [1, 3, 7, 14, 30, 60] },
    settingInfo: { … one entry per setting, below },
    themeTokens: {},
  })
  ```

  `settingInfo`: `folder` `{ label: 'Practice folder', description: 'The folder holding the problems; ~ is the home
  folder.' }`; `compiler` `{ label: 'Compiler', description: 'The C++ compiler the judge runs, by name on the PATH or
  by full path.' }`; `flags` `{ label: 'Compiler flags', description: 'The flags the judge compiles with, separated by
  spaces.' }`; `timeLimitMs` `{ label: 'Time limit', description: 'Milliseconds one test case may run before Time Limit
  Exceeded.' }`; `reviewSteps` `{ label: 'Review steps', description: 'Days between reviews, one per step of the review
  ladder.' }`.
  - No page command is declared here. The page task that handles a command declares it (07: list, filter, box and
    `showMode`; 08: `run`, `submit`, `nextTab`, `prevTab`; 09: `toggleInterviewer`, `importStart`), because
    `PageStart.commands` (`src/contracts/plugin.ts` 802-807) needs a handler for each declared page command once the
    page part exists. Main handles no command, so `commands` is `{}` (as `src/plugins/agent-lines/manifest.ts` 16).
  - Scopes are declared by the task that binds them: 05 declares `list`, `problem`, `editor` and `console`; 07 adds
    `box`, 08 `confirm`, 09 `ask` and `import`. There is no `interviewer` scope.
  - The `layout` setting, `layouts/layout.d.ts` and `api.layouts.register({ layoutTypes })` land in 07: the
    contract file is 07's, and `start.ts` cannot import `../layouts/layout.d.ts?raw` before it exists.
  - `dependsOn.page: ['chat']` lands now. No page part exists until 07; `scripts/check-layers.mts` reads `hasPage`
    from `page/start.ts` (line 827), so `src/plugins/page.ts` does not list practice until 07 adds the part.
- **Registration.** `src/plugins/manifests.ts`: import `practiceManifest` and list it after `notesManifest` in
  `builtInManifests` (line 57). `src/plugins/main.ts`: import `practiceMainPart` and list it after `notesMainPart`
  (line 51). The host starts it after chat and sessions by `dependsOn`.
- **The folder.** `folder()` is `services.paths.expandTilde(api.settings().folder, services.homeDir)`, read at each
  call, so a settings change applies to the next call. The layout:
  `<folder>/problems/<slug>/` (design.md § Problem files table), `<folder>/interviewer.md`, `<folder>/.build/`.
- **Problem store** (design.md § Seams, Problem store). Every read and write of the practice folder goes through it.
  - `slugs()` lists `<folder>/problems` (not recursive) and keeps the folders; a missing folder is `[]`.
  - `readProblem(slug)` reads `problem.json`, `JSON.parse`s it and calls `parseProblem`. A parse failure or a
    `ProblemError` rethrows as `Error('problems/<slug>/problem.json: <message>')`; a missing file is
    `problems/<slug>/problem.json: missing`.
  - `readText` returns null for a missing file (`readIfPresent`). Callers read a missing `notes.md` and
    `custom-cases.json` as `''`, and a missing `progress.json` as a new problem (below).
  - `submissions(slug)` reads every `submissions/*.json`, newest first by `time`. A file that does not parse is skipped
    and logged by the caller's log line `problems/<slug>/submissions/<name>: <reason>`.
  - `writeSubmission` writes `submissions/<stamp>.json`, `<stamp>` being `record.time` with each `:` and `.` replaced
    by `-` (`2026-11-09T14-03-22-123Z.json`). Reason: `:` cannot be in a Windows file name; the stamp still sorts by
    time.
  - `interviewerText()` reads `<folder>/interviewer.md`, null when missing (06 reads it).
  - `writeBuildFile(relativePath, text)` writes `<folder>/.build/<relativePath>` (folders made by `files.write`) and
    resolves its absolute path. It writes nothing under `problems/`. A `relativePath` that is absolute or holds a `..`
    segment rejects with `build file <relativePath> is outside .build`. 06's import check writes the reference here
    and judges it at the resolved path, so a refused import leaves `problems/<slug>/` as it was.
  - `watch(onChange)` calls `files.watch(<folder>/problems, path => onChange(<first segment of path> or null))`,
    recursive, with an `onError` that logs `watch stopped: <reason>`. `start.ts` sends `changed` with that slug for
    each call. The watch covers the app's own writes too (`progress.json`, `submissions/`, a saved `solution.cpp`),
    so the list's status marks follow a Submit with no extra message. `.build/` is outside `problems/`, so a judge
    run sends nothing. `files.watch` makes `problems/` when it is missing.
- **Progress** (design.md § Progress). `progress.json` is:

  ```json
  { "status": "attempted", "review": { "step": 1, "due": "2026-11-12" },
    "attempts": [{ "id": "a1b2c3d4", "started": "2026-11-09T14:03:22.123Z", "peeked": false, "interviewer": null }] }
  ```

  - A missing `progress.json` reads as `{ status: 'new', review: { step: null, due: null }, attempts: [] }`. A file
    that does not parse, or whose fields have the wrong types, is the error `problems/<slug>/progress.json: <reason>`.
    Reason: treating it as new would overwrite the user's progress at the next write.
  - The current attempt is the last in `attempts`. `today` is `dayOf(clock.now())`; `started` and `time` are `new
    Date(clock.now()).toISOString()` (ISO 8601). Attempt ids are `randomHex()`.
  - `summary(slug, problem)`: the problem's fields, `status` from the file, `due` `isDue(review, today)`.
  - `open(slug, problem)` is idempotent. The page calls it again on each `changed` and after a Submit. It writes only
    in two cases:
    - no attempt yet: it appends a new attempt (`peeked: false`, `interviewer: null`). In this case it also writes
      `stubSource(problem)` to `solution.cpp` when that file is missing; an existing `solution.cpp` (the import's
      stub) stays.
    - `isDue(review, today)` and the current attempt's `started` day (`dayOf(Date.parse(started))`) is before
      `review.due`: it appends a new attempt and writes `stubSource(problem)` to `solution.cpp`. The old code stays in
      its submissions and in git. A fresh attempt therefore starts at most once per due date.
    In every other case it returns the current attempt and writes nothing.
  - `peek(slug)` sets the current attempt's `peeked` to true and `review` to `nextReview(review, 'peeked', today,
    steps())`. With no attempt it appends one first.
  - `recordSubmission(slug, result, code)` first reads `store.submissions(slug)`, then writes the `SubmissionRecord`
    (`time`, the result's `verdict`, `passed`, `total`, `ms`, `failing`, and `code`), then updates the file:
    - `status`: `solved` when the verdict is `accepted` or the status was already `solved`; else `attempted`.
    - `review`: `nextReview(review, 'clean', today, steps())` only when the verdict is `accepted`, the current attempt
      has `peeked` false, and no submission read before the write has `time >= attempt.started` and verdict
      `accepted` (the attempt's first Accepted). The new record is not in that read, so it never counts against
      itself. Every other verdict and a later Accepted leave `review` as it is (design.md: a Wrong Answer does not
      move it).
  - `setInterviewer(slug, attemptId, interviewer)` writes the attempt's `interviewer` (06 calls it).
  - All writes run one at a time, in call order, through one promise chain in `createProgress`. Reason: `open` and a
    Submit can overlap and both rewrite `progress.json`.
- **Judge** (design.md § Judging; § Seams, Judge). `judge(problem, codePath, cases, options)`:
  1. Runs one call at a time, in call order (one promise chain in `createJudge`). Reason: two runs share a build
     folder, and parallel runs skew each other's measured time.
  2. Writes `<build>/.gitignore` = `*\n`, `<build>/prelude.h` = `preludeSource()`, and `<build>/bits/stdc++.h` =
     `#pragma once\n#include "../prelude.h"\n`, `<build>` being `settings().buildFolder`. The last one lets code
     copied from LeetCode with `#include <bits/stdc++.h>` compile.
  3. The run folder is `<build>/<slug>/<code name>/`, `<code name>` the base name of `codePath` without `.cpp`
     (`solution`, `reference`), so a Run's reference build does not overwrite the solution's. It writes `driver.cpp`
     = `driverSource(problem, codePath)` and `cases.json` = the JSON array of each case's driver input: a function
     case's `input`; a design case's `[ops, args]`.
  4. Compiles: `processes.run(compiler, [...flags.split(/\s+/).filter(Boolean), '-I', <build>, '-o', <run
     folder>/program, <run folder>/driver.cpp], { cwd: <run folder>, timeoutMs: 120_000, signal })`. No shell. A
     non-zero exit is `compileError` with `compileOutput` `mapCompileErrors(stderr || stdout, codePath)`. A rejected
     run (`Could not run clang++: …`) is `compileError` with that text as `compileOutput`. A timed-out compile is
     `compileError` with `Compilation took longer than 120 s.` A `compileError` result has `passed 0`, `total
     cases.length`, `ms 0`, `failing null`, `cases []`.
  5. Runs each case in order: writes `''` to `<run folder>/result-<index>.json`, then `processes.run(<run
     folder>/program, [<run folder>/cases.json, String(index), <run folder>/result-<index>.json], { cwd: <run folder>,
     timeoutMs: timeLimitMs, signal })`. `ms` is `clock.now()` after minus before.
  6. Maps each run to a verdict, first rule that holds:
     - `timedOut` → `timeLimit`;
     - `code !== 0`, or stderr holds `==ERROR: AddressSanitizer`, `==ERROR: LeakSanitizer` or `: runtime error: `
       (a sanitizer report) → `runtimeError`;
     - the result file is empty or does not parse → `runtimeError`, with `The program ended before writing its
       answer.` appended to stderr;
     - `answersMatch(case.expected, output, problem.compare)` → `accepted`;
     - else `wrongAnswer`.
  7. `CaseResult`: `index` the case's index in `cases`; `source` the case's; `input` a function case's `input`, a
     design case's `{ ops, args }`; `expected`; `output` the parsed result or null; `stdout` and `stderr` each cut to
     their first 10 000 characters, `\n… (cut)` appended when cut (constant `OUTPUT_LIMIT = 10_000`); `verdict`; `ms`.
  8. With `stopAtFirstFailure` true the judge stops after the first case that is not `accepted`.
  9. `JudgeResult`: `verdict` the first failing case's verdict, else `accepted`; `passed` the count of accepted cases;
     `total` `cases.length` (also when stopped early, as LeetCode's `x / y testcases passed`); `ms` the sum of the run
     cases' `ms`; `compileOutput` null; `failing` the first failing case or null; `cases` every case run.
  A `signal` that aborts rejects the call with the runner's `Stopped <command>` text.
- **Runs** (`practice-runs.ts`, design.md § Judging, Run and Submit). Reason for the extra file: Run's reference step
  and Submit's recording are rules with their own tests, and putting them in `start.ts` would test them only through
  the real judge.
  - `run(slug)`: reads the problem and `custom-cases.json` (`''` when missing) and parses it with
    `parseCustomCases`; a `ProblemError` rejects with `custom-cases.json: <message>`. `CustomInput` has no
    `expected`, so `run` builds each custom `JudgeCase` in two steps:
    1. The reference cases: a function input `{ input }` becomes `{ input, expected: null, visible: true, source:
       'custom' }`; a design input `{ ops, args }` becomes `{ ops, args, expected: [], visible: true, source:
       'custom' }`. The `expected` here is a placeholder of the case's own type. `run` judges `reference.cpp` on these
       cases with `stopAtFirstFailure: false` and ignores each `wrongAnswer` verdict, since the placeholder is no
       answer.
    2. A reference result of `compileError`, or a case of `timeLimit` or `runtimeError`, rejects with `reference.cpp
       fails on custom case <n>: <verdict>; check the input against the constraints.` (`<n>` 1-based;
       `reference.cpp does not compile: <first line of compileOutput>` for a compile error). Else each custom case
       takes that reference case's `output` as its `expected`. For a design case the output is an array (the driver
       writes one); an output that is not an array rejects as the `runtimeError` line above.
    Then it judges `solution.cpp` on the visible cases (`source: 'example'`) followed by the custom cases,
    `stopAtFirstFailure: false`. It records nothing on disk and keeps
    `{ kind: 'run', result }` as the slug's last result.
  - `submit(slug)`: judges `solution.cpp` on every case in file order (`source` `example` for visible, `hidden`
    otherwise), `stopAtFirstFailure: true`; reads `solution.cpp` as the record's `code`; calls
    `progress.recordSubmission`; keeps `{ kind: 'submit', result }` as the last result; resolves the result.
  - `lastResult(slug)`: the last kept result in memory, null when none since the app started. 06's
    `read_practice_state` reads it.
  - Both read the code from disk: the page saves `solution.cpp` before it invokes `run` or `submit` (08).
- **`start.ts`** wiring, in backlog's shape (`src/plugins/backlog/main/start.ts` 1085-1133):
  - `PracticeApi = MainApi<typeof practiceManifest, PracticeChannel>` (06 adds the `Heard` events).
  - builds `store`, `progress` (with `steps: () => api.settings().reviewSteps`), `judge` (with `settings()`:
    `buildFolder` `<folder>/.build` and the three settings), `runs`;
  - handles `list`: every slug's `readProblem` and `progress.summary`; a slug whose problem or progress fails is left
    out and logged once per `list` call: `<the error text>`;
  - handles `open(slug)`: `readProblem`, `progress.open`, then `OpenedProblem` from `summary` =
    `progress.summary(slug, problem)` (read after `progress.open`), `problem.md` (`''` when missing),
    `problem.signature`, `solution.cpp`, `notes.md`, `custom-cases.json`, the attempt and `store.submissions(slug)`;
  - handles `saveCode`, `saveNotes`, `saveCustomCases` through `store.writeText` to `solution.cpp`, `notes.md`,
    `custom-cases.json`;
  - handles `run`, `submit` through `runs`; `peek(slug)` through `progress.peek`, then resolves `{ approach,
    reference }` read from `approach.md` and `reference.cpp`;
  - leaves `startImport`, `askInterviewer` and `interviewerOf` to 06;
  - starts `store.watch(slug => channel.send('changed', { slug }))`, and in `api.onSettingsChanged` disposes it and
    starts a new one when the expanded folder changed;
  - returns `{ commands: {} }`.
- **Two layer extras.** Add a `practice` entry to `PLUGIN_EXTRAS` in `scripts/check-layers.mts` (beside `primer`,
  line 121):
  - `contract`: `contract.ts` imports `Difficulty`, `JsonValue`, `FunctionSignature` and `DesignSignature` from
    `./problem`. `scripts/layer-rules.mts` `folderEntries` lets `<plugin>/contract.ts` reach only `src/contracts` and
    the dependencies' contracts, and `problem.ts` is in layer `src/plugins/practice`. Precedent: forms
    (`contract: { layers: ['src/plugins/forms'] }`, check-layers.mts 86), whose contract imports `./manifest`.
  - `sublayers`: `src/plugins/practice/main/judge.test.ts` runs the real `createNodeProcesses` and `createNodeFiles`
    over a temp folder, which the plugin's main layer cannot import.

  ```ts
  practice: {
    // Its contract names the problem types of `./problem`.
    contract: { layers: ['src/plugins/practice'] },
    sublayers: {
      // Compiles and runs generated drivers with the machine's clang++ through the real process and file adapters.
      'src/plugins/practice/main/judge.test.ts': {
        layers: ['src/contracts', 'src/shared', 'src/shared/paths', 'src/plugins/practice',
          'src/plugins/practice/contract.ts', 'src/plugins/practice/main', 'src/main/processes', 'src/main/files'],
        packages: ['node:'],
      },
    },
  },
  ```

  Precedent: `src/main/git/process-git.test.ts` 576-600 runs the real git the same way, behind a PATH check.

GIVEN a folder holding two problems, one with a bad `problem.json` WHEN `list` is invoked THEN it resolves the good
one's summary and logs `problems/<slug>/problem.json: <field>: <reason>`.
GIVEN a problem whose review is due and whose attempt started before the due day WHEN `open` is invoked twice THEN the
first call starts a new attempt and writes the stub, and the second returns the same attempt and writes nothing.
GIVEN a first Accepted with no peek WHEN it is submitted THEN `progress.json` holds `status: 'solved'` and the ladder
moved one step; a second Accepted in the same attempt does not move it.
GIVEN a solution that fails case 2 of 3 WHEN submitted THEN the result is `passed 1`, `total 3`, two cases run, and a
submission file is written.
GIVEN custom cases WHEN Run is invoked THEN the reference's outputs are the custom cases' expected answers.
GIVEN a solution that dereferences a null pointer WHEN judged with clang++ THEN the verdict is `runtimeError`.

Tests:
- `judge.test.ts`:
  - `maps each run to a verdict` — `it.each` over a runner double built in the test (a `ProcessRunner` whose compile
    call returns a scripted result and whose case call writes a scripted text into the memory files at the result
    path, then returns a scripted `ProcessResult`); rows `{ compile, run, resultText, verdict }`: compile exit 1
    with stderr `<codePath>:3:1: error: x` → `compileError`, `compileOutput` `solution.cpp:3:1: error: x`; compile
    rejects `Could not run clang++: ENOENT` → `compileError` holding that text; run `timedOut` → `timeLimit`; run code
    `-1` → `runtimeError`; run code 0 with stderr `x.cpp:2:3: runtime error: signed integer overflow` →
    `runtimeError`; code 0 with result `''` → `runtimeError`; result `[0,1]` with expected `[0,1]` → `accepted`;
    result `[1,0]` → `wrongAnswer`. Catches each mapping rule flipped or skipped.
  - `stops at the first failure only when asked` — three cases, the second's result wrong: with
    `stopAtFirstFailure: true` → `cases.length` 2, `passed` 1, `total` 3, `failing.index` 1; with false →
    `cases.length` 3, `passed` 2. Catches a stop that ignores the option and a `total` that counts only run cases.
  - `writes the build files` — after one call the memory files hold `<build>/.gitignore` = `*\n`, `prelude.h` and
    `bits/stdc++.h`. Catches the self-ignoring `.gitignore` left out (design.md § Problem files).
  - `describe.skipIf(!clangOnPath)('createJudge with clang++', …)`, `clangOnPath` from `execFileSync('clang++',
    ['--version'], { stdio: 'ignore' })` in a try, as `process-git.test.ts` 576-585; a `mkdtempSync` folder under
    `tmpdir()`, removed in `afterEach`; `createNodeFiles({ trashItem: (path) => rm(path, { recursive: true, force:
    true }), os: <'macos' | 'windows' | 'linux' from process.platform> })`, `createNodeProcesses()`, `posixPaths`,
    a real clock, `timeLimitMs` 1000 and the manifest's default `flags`:
    - `round-trips every value type through a design class` — one design problem `Echo` (constructor no params)
      with methods `nextInt(int) → int` (x + 1), `twice(long long) → long long`, `half(double) → double`,
      `flip(bool) → bool`, `next(char) → char`, `shout(string) → string` (s + "!"), `grid(vector<vector<int>>) →
      vector<vector<int>>` (appends the row `{0}`), `names(vector<string>) → vector<string>` (reversed),
      `flags(vector<bool>) → vector<bool>` (each flipped), `tail(ListNode*) → ListNode*` (head->next),
      `left(TreeNode*) → TreeNode*` (root->left), `reset() → void`; one case with ops in that order and args `[[],
      [7], [3000000000], [2.5], [true], ["a"], ["q\"\\\n"], [[[1,2],[3]]], [["x","y"]], [[true,false]], [[1,2,3]],
      [[1,2,3,null,4]], []]`; expected `[null, 8, 6000000000, 1.25, false, "b", "q\"\\\n!", [[1,2],[3],[0]],
      ["y","x"], [false,true], [2,3], [2,null,4], null]`. Verdict `accepted`. Catches a wrong conversion in either
      direction for any type, an unescaped string, `vector<bool>` failing to compile, a broken level order, and the
      design dispatch. The solution is written in the test as a literal.
    - `judges a function solution` — `it.each` over Two Sum with these solutions as literals: correct, and printing
      `hi` with `cout` → `accepted` with `cases[0].stdout` `hi\n` and `output` `[0,1]`; returns `{}` →
      `wrongAnswer`; `while (true) {}` → `timeLimit`; `int* p = nullptr; return {*p};` → `runtimeError`; a missing
      `;` on line 4 → `compileError` with `compileOutput` holding `solution.cpp:4:`; a solution starting `#include
      <bits/stdc++.h>` → `accepted`. Catches the user's stdout mixed into the answer, a sanitizer crash missed, the
      compile-error rewrite, and the `bits/stdc++.h` shim.
- `problem-store.test.ts` (memory files, `posixPaths`):
  - `readProblem names the file and the field` — a `problem.json` with `"difficulty": "Easy"` → rejects with a
    message starting `problems/two-sum/problem.json: difficulty`; a missing file → `problems/two-sum/problem.json:
    missing`.
  - `watch reports the slug of each change` — rows: a write to `problems/two-sum/solution.cpp` → `two-sum`; a write to
    `problems/two-sum/submissions/x.json` → `two-sum`. Catches a slug taken from the wrong segment.
  - `submissions come newest first` — three records written with times out of order → read newest first, file names
    holding no `:`.
  - `writeBuildFile writes under .build only` — `two-sum/import/reference.cpp` → resolves
    `/home/u/leetcode/.build/two-sum/import/reference.cpp`, the file holds the text, and no path under `problems/`
    exists; `../problems/two-sum/x` and `/etc/x` → reject with `is outside .build`. Catches an import check that
    writes into the problem folder.
- `progress.test.ts` (memory files, a clock the test sets, steps `[2, 5]`):
  - `open starts an attempt only when it should` — rows `{ given, today, opens, attempts, stubWritten }`: no progress →
    1 attempt, stub not rewritten; not due → same attempt, nothing written; due, attempt started before the due day →
    2 attempts, stub written; due, attempt started on the due day (opened twice) → still 2 attempts after the second
    open. Catches a fresh attempt on every open and a due problem that never refreshes.
  - `recordSubmission moves status and ladder` — rows `{ history, verdict, peeked, status, review }`: first
    `accepted`, no peek → `solved`, `{0, today+2}`; `wrongAnswer` on a new problem → `attempted`, review unchanged;
    second `accepted` in the same attempt → review unchanged; `accepted` after a peek → `solved`, review as the peek
    left it; `wrongAnswer` after solved → stays `solved`. Catches a ladder move on a non-clean solve and a solved
    status lost.
  - `peek drops the ladder to its first step` — `it.each` rows: from `{1, …}` (solved) → `{0, today+2}` and `peeked`
    true; status `new` with no attempt → one attempt, `peeked` true, `{0, today+2}`, status still `new`; status
    `attempted` with `{null, null}` → `{0, today+2}`. A never-solved problem becomes due after a peek, as design.md
    § Progress says ("drops the problem to the first step").
  - `a malformed progress.json is an error naming it` — `{"status": 3}` → rejects with
    `problems/two-sum/progress.json:`.
- `practice-runs.test.ts` (memory files, a judge double that records its calls and returns scripted results):
  - `run takes custom expected answers from the reference` — custom text `[[[3,3],6]]`; the double answers the
    reference call with output `[0,1]`; the solution call receives two cases, the second with `source: 'custom'` and
    `expected` `[0,1]`, and `stopAtFirstFailure` false. A second row, a design problem with custom text
    `[{"ops":["Counter","get"],"args":[[1],[]]}]`: the reference call receives `expected` `[]`, its `wrongAnswer` is
    ignored, and the solution call's custom case has the reference's output `[null,1]` as `expected`. Catches custom
    cases judged against nothing and a placeholder answer taken as a refusal.
  - `run refuses when the reference fails a custom case` — reference case `runtimeError` → rejects naming `custom case
    1`; no solution call.
  - `submit runs every case, stops at the first failure, and records it` — the double sees `stopAtFirstFailure` true
    and sources `example` then `hidden`; one submission file is written; `lastResult` is `{ kind: 'submit' }`.
- `start.test.ts` (`startMainPart(practiceMainPart, { dependencies: [fakeDependency(chatMainKey, …),
  fakeDependency(sessionsMainKey, …)], services: { homeDir: '/home/u' } })`, problems written into `harness.files`
  under `/home/u/leetcode/problems/`):
  - `list leaves out a bad problem and logs it` — one good, one with a bad `problem.json` → one summary; the log holds
    the bad file's path.
  - `open returns the summary with the attempt` — `open('two-sum')` on a new problem → `summary.slug` `two-sum`,
    `summary.title` the problem's, and `attempt.id` the id `progress.json` holds.
  - `sends changed with the slug of a changed file` — a write to `problems/two-sum/notes.md` → `harness.sent` holds
    `{ message: 'changed', data: { slug: 'two-sum' } }`. Proves the watch wiring once.

Done when: `npm run typecheck` passes, `npm run lint` passes (layers with the new extra, styles, oxlint, oxfmt), and
the test gate runs the five test files above, all green, the clang suite included (clang++ is on this machine: plan.md
§ Preconditions).
Commit:    one commit for the group

## Proof
