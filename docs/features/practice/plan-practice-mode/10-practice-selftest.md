# 10 — Practice self-test and drive action

Status: done
Type: Task
Wave: 7 · Depends on: 09
Plan: [plan.md](plan.md)

Files:     create `src/plugins/practice/main/selftest-fixture.ts` · create `src/plugins/practice/main/selftest-script.ts` ·
           modify `src/plugins/practice/main/start.ts` · test `src/plugins/practice/main/selftest-fixture.test.ts`

Consumes:  `SelfTestScript`, `SelfTestGroup`, `SelfTestStep`, `DriveHost`, `DriveAction` in `src/contracts/plugin.ts`
           `parseProblem(json: unknown, slug: string): Problem` ← 04
           The practice folder main resolves from the `folder` setting, `~` expanded against `services.homeDir` ← 05
           The `changed` message on PracticeChannel ← 05, sent for the whole list
           The `[practice] …` log lines tasks 07, 08 and 09 emit (listed under Decisions)
           Patterns: `src/plugins/backlog/main/selftest-script.ts` (`holdsWithin`, `open` chaining each run's fixture
           after the one before), `src/plugins/backlog/main/selftest-fixture.ts`, `src/plugins/chat/main/start.ts`
           `addDriveActions` (`drive.add`)

Produces:  `selftest-fixture.ts`: `PRACTICE_FIXTURE_SLUGS = ['two-sum', 'lru-cache'] as const`;
           `writePracticeFixture(deps: { files: Files; paths: Paths }, folder: string): Promise<void>`.
           `selftest-script.ts`: `practiceSelfTestScript(deps: PracticeSelfTestDeps): SelfTestScript` with
           `interface PracticeSelfTestDeps { files: Files; paths: Paths; processes: ProcessRunner; folder(): string;
           compiler(): string; reload(): void }`.
           Drive action `practice.writeFixture` (`api.drive.add('writeFixture', …)`).

Decisions:
- The fixture lives in the default practice folder, `<temp home>/leetcode`. The script's `settings` stay `{}`: script
  settings reach only the config main serves the page, and main parts start on the defaults (AGENTS.md § Running and
  testing). The default `folder` (`~/leetcode`) expands against the self-test's temp home.
- `writePracticeFixture` writes in place. Main watches `<folder>/problems/` recursively from its `start` (05: `store
  .watch` calls `files.watch`, which makes `problems/` when it is missing), so the fixture never removes
  `problems/` itself. It lists the entries of `<folder>/problems/` and trashes each one (`files.trash`, which deletes
  for good outside a live run), then writes each fixture problem's five files. A rerun so starts with no progress, no
  submissions and no interviewer, and the watch keeps running.
- The fixture writes `problem.json`, `problem.md`, `reference.cpp`, `approach.md` and `solution.cpp` per problem.
  It writes no `notes.md`, `custom-cases.json` or `progress.json`: 05's store reads a missing one as empty or new.
- `two-sum` `problem.json`, verbatim:
  `{"title":"Two Sum","difficulty":"easy","tags":["array","hash table"],"lists":["Blind 75"],"signature":{"kind":"function","method":"twoSum","params":[{"name":"nums","type":"vector<int>"},{"name":"target","type":"int"}],"returns":"vector<int>"},"compare":"anyOrder","cases":[{"input":[[2,7,11,15],9],"expected":[0,1],"visible":true},{"input":[[3,2,4],6],"expected":[1,2],"visible":true},{"input":[[3,3],6],"expected":[0,1],"visible":false}]}`
- `two-sum` `solution.cpp` and `reference.cpp` are both this correct solution, so Run passes:
  `class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        unordered_map<int, int> seen;\n        for (int i = 0; i < (int)nums.size(); i++) {\n            auto found = seen.find(target - nums[i]);\n            if (found != seen.end()) {\n                return {found->second, i};\n            }\n            seen[nums[i]] = i;\n        }\n        return {};\n    }\n};\n`
- `lru-cache` `problem.json`, verbatim:
  `{"title":"LRU Cache","difficulty":"medium","tags":["design","hash table","linked list"],"lists":["Blind 75"],"signature":{"kind":"design","className":"LRUCache","constructor":[{"name":"capacity","type":"int"}],"methods":[{"name":"get","params":[{"name":"key","type":"int"}],"returns":"int"},{"name":"put","params":[{"name":"key","type":"int"},{"name":"value","type":"int"}],"returns":"void"}]},"compare":"exact","cases":[{"ops":["LRUCache","put","put","get","put","get","put","get","get","get"],"args":[[2],[1,1],[2,2],[1],[3,3],[2],[4,4],[1],[3],[4]],"expected":[null,null,null,1,null,-1,null,-1,3,4],"visible":true}]}`
- `lru-cache` `solution.cpp` is a wrong solution that compiles and returns from every path, so Submit reports Wrong
  Answer and never Runtime Error (a stub with no return fails `-fsanitize=undefined` at run time):
  `class LRUCache {\npublic:\n    LRUCache(int capacity) {}\n\n    int get(int key) {\n        return -1;\n    }\n\n    void put(int key, int value) {}\n};\n`
  Its `reference.cpp` is a correct list-plus-map LRU cache.
- `problem.md` is `# <title>\n\nThe self-test's <title>.\n`; `approach.md` is `The self-test's approach.\n`.
- The judge groups run the machine's real compiler. Main's `compiler` setting is at its default, `clang++`, under
  the self-test. On a machine where `<compiler> --version` cannot run, the run step fails on its line, and the
  result adds the problem `no <compiler> on PATH: Run and Submit need it`, so the report names the cause. The
  self-test runs on the user's Macs and Windows (AGENTS.md § Intent); a Windows machine needs LLVM's clang++ on PATH.
- The judge steps wait in two steps: one for the `started` line, one keyless step for the verdict. One step waits
  5 s (`STEP_TIMEOUT_MS`, `src/main/drive/page-driver.ts`). A sanitizer compile of a two-sum driver took 1.5 s and
  one case 0.35 s on this Mac at plan time.
- The interviewer group launches over the fake agent harness. The self-test runs every session on it
  (`src/main/main.ts` `modeServicesOf`, `selfTest`), and chat's `launch` works there (the context-sources,
  agent-strip and usage scripts call it). The fake spawns nothing. The import group starts a session the same way.
- `open(run)` chains each run's fixture after the one before (backlog's `written` chain), calls `reload()` once it
  is written, and returns `shownLine: '[practice] loaded 2 problems'`. Its result waits (`holdsWithin`, 60 s, poll
  25 ms) for the checks below and lists each that never held.
- The chain starts at `Promise.resolve()`. `PracticeSelfTestDeps` has no `started` (backlog's has one, for the
  fixture repo its main writes at start). Practice's main writes no fixture at start, and its watch starts
  synchronously in `start`; the self-test's `open` runs only after every part has started (`src/contracts/plugin.ts`
  901-905), so the watch is live before the first write.
- The list follows a Submit with no extra step. The Submit writes `progress.json` and `submissions/`, 05's watch
  sends `changed` for those writes, and 07's `changed` handler reloads the list. The `interviewer` group's step 6
  rests on this.
- Result checks: `<folder>/problems/lru-cache/submissions/` holds exactly one `.json` file, whose `verdict` is
  `wrongAnswer`; and the compiler check above.
- `scrollsItself: ['.practice-list .ui-row-label']`: the fit check lets a row title clip to an ellipsis inside its
  own box rather than count as overflow (`kit.row`'s label is `span.ui-row-label`, `src/shared/page/ui/row.ts` 29;
  07's side bar is `div.practice-list`). The fixture titles are short, so the run does not exercise the ellipsis.
  `pageBinds: []`.
- The drive action: `drive.add('writeFixture', { description: 'Writes the Practice fixture into the practice folder (the folder setting, default <home>/leetcode), replacing every problem in its problems folder: Two Sum (a function problem, anyOrder, with a correct solution.cpp) and LRU Cache (a design problem whose solution.cpp get always returns -1, so Submit gives Wrong Answer). Tells the page to list again. Returns { folder, problems }.', args: '{}', run })`.
  `run` resolves to `{ folder, problems: ['two-sum', 'lru-cache'] }`.
- Main start: under `runMode === 'selfTest'` it hands the script with `services.selfTest?.run(...)`. When `api.drive`
  is not null it adds the action. `reload` sends the `changed` message for the whole list.

Groups and steps (`keys` → `expect`; `alsoExpect` and `why` where given). Each group's `why` is the text after its
name.

- `list` — Space k p shows Practice with both fixture problems, Two Sum (easy) above LRU Cache (medium), the list
  holding the keys; j and k move the cursor; / with a difficulty word keeps only that difficulty, and / then Esc
  clears it.
  1. `[' ', 'k', 'p']` → `[practice] shown`; `checksFit: true`; `screenshot: 'list'`
  2. `['j']` → `[practice] selected lru-cache`; why: the list holds the keys on the first show (07).
  3. `['k']` → `[practice] selected two-sum`
  4. `['/', ...'medium']` → `[practice] selected lru-cache`; why: the filter hides Two Sum, so the cursor moves to
     the match.
  5. `['Enter']` → `[practice] filter medium`
  6. `['/', 'Escape', 'k']` → `[practice] selected two-sum`; why: / then Esc clears the filter, so Two Sum shows
     above again.
- `open and run` — Enter opens Two Sum's statement, editor and console with the problem pane holding the keys; Cmd+'
  compiles the fixture's correct solution with the real compiler and runs both examples to Accepted.
  1. `['Enter']` → `[practice] opened two-sum`; `alsoExpect: [/^\[practice\] problem focused$/]`;
     `checksFit: true`; `screenshot: 'workspace'`; why: each open focuses the problem pane, so the statement reads
     first (08).
  2. `["<D-'>"]` → `[practice] run started two-sum`
  3. `[]` → `[practice] run two-sum: accepted 2/2`; `screenshot: 'run-result'`
- `solution peek` — Option+j and Option+k move between the problem pane and the editor; the Solution tab asks to
  confirm before it opens, and y opens it and marks the attempt peeked.
  1. `['<A-j>']` → `[practice] editor focused`
  2. `['<A-k>']` → `[practice] problem focused`
  3. `['g', 't']` → `[practice] problem tab Submissions`
  4. `['g', 't']` → `[practice] problem tab Notes`
  5. `['g', 't']` → `[practice] solution confirm asked`; `screenshot: 'solution-confirm'`
  6. `['y']` → `[practice] peeked two-sum`
- `submit wrong answer` — Submit of LRU Cache, whose get always returns -1, fails the design case with Wrong Answer
  and records one submission.
  1. `['<A-h>']` → `[practice] list focused`; why: the problem pane is the column's left edge, and the outer panes
     turn left down while the column holds the keys, so Option+h reaches the list through the mode's side bar.
  2. `['j']` → `[practice] selected lru-cache`
  3. `['Enter']` → `[practice] opened lru-cache`
  4. `['<D-Enter>']` → `[practice] submit started lru-cache`
  5. `[]` → `[practice] submit lru-cache: wrongAnswer 0/1`; `screenshot: 'wrong-answer'`
- `interviewer` — Space v i opens the interviewer pane on LRU Cache's ask box; Enter launches the interviewer over
  the fake harness and mounts its chat view; Option+h leaves the chat view for the column and Option+l returns;
  another problem shows its own ask box, and LRU Cache brings its interviewer back; Space v i hides the pane.
  1. `[' ', 'v', 'i']` → `[practice] ask box shown for lru-cache`;
     `alsoExpect: [/^\[practice\] interviewer pane shown$/, /^\[practice\] interviewer focused$/]`;
     `checksFit: true`; `screenshot: 'ask-box'`
  2. `[...'how do I start', 'Enter']` → `[practice] interviewer mounted lru-cache`; `screenshot: 'interviewer-chat'`
  3. `['<A-h>']` → `[practice] interviewer left`; `alsoExpect: [/^\[practice\] main focused$/]`; why: the chat
     view turns Option+h down at its left edge, so Practice's outer panes give the column the keys.
  4. `['<A-l>']` → `[practice] interviewer focused`
  5. `['<A-h>', '<A-h>']` → `[practice] list focused`
  6. `['j']` → `[practice] selected two-sum`; why: the submit made LRU Cache attempted, and the list reloaded through
     main's `changed`, so LRU Cache sorts above Two Sum.
  7. `['Enter']` → `[practice] ask box shown for two-sum`; `alsoExpect: [/^\[practice\] opened two-sum$/]`; why:
     Two Sum's attempt has no interviewer.
  8. `['<A-h>']` → `[practice] list focused`
  9. `['k', 'Enter']` → `[practice] interviewer mounted lru-cache`;
     `alsoExpect: [/^\[practice\] opened lru-cache$/]`; why: reopening the problem brings back its attempt's
     interviewer.
  10. `[' ', 'v', 'i']` → `[practice] interviewer pane hidden`
- `import` — a on the list opens the import box; Enter on an empty box keeps it open; a request starts an import
  session through chat's launch and closes the box; Esc closes it with nothing started.
  1. `['<A-h>']` → `[practice] list focused`
  2. `['a']` → `[practice] import box opened`; `checksFit: true`; `screenshot: 'import-box'`
  3. `['Enter']` → `[practice] import refused: empty`
  4. `[...'add two sum', 'Enter']` → `[practice] import started: add two sum`;
     `alsoExpect: [/^\[practice\] import box closed$/]`
  5. `['a', 'Escape']` → `[practice] import box closed`

The lines each owner task logs, which these steps expect verbatim (the page prints `log(text)` as
`[practice] <text>`):
- 07: `shown`; `loaded <n> problems` on each list load, a reload after `changed` included; `selected <slug>`;
  `opened <slug>`; `filter <text>` when the filter box closes; `list focused`; `main focused`.
- 08: `problem focused`; `editor focused`; `problem tab <title>` on each problem pane tab change; `solution confirm
  asked`; `peeked <slug>`; `run started <slug>` and `run <slug>: <verdict> <passed>/<total>`; `submit started
  <slug>` and `submit <slug>: <verdict> <passed>/<total>`. `<verdict>` is the `Verdict` value (`accepted`,
  `wrongAnswer`).
- 09: `interviewer pane shown`, `interviewer pane hidden`, `ask box shown for <slug>`, `interviewer mounted <slug>`,
  `interviewer focused`, `interviewer left`, `import box opened`, `import box closed`, `import refused: empty`,
  `import started: <request>`.

GIVEN an empty home WHEN `writePracticeFixture` runs THEN `<folder>/problems/two-sum/` and
`<folder>/problems/lru-cache/` each hold `problem.json`, `problem.md`, `reference.cpp`, `approach.md` and
`solution.cpp`, and nothing else.
GIVEN a folder holding `problems/lru-cache/submissions/1.json` and `problems/old/problem.json` WHEN
`writePracticeFixture` runs THEN neither file exists after it, and `<folder>/problems/` itself still exists.
GIVEN `npm run selftest -- --plugin practice` on a machine with clang++ WHEN it runs THEN every group passes and the
result holds no problem.

Tests:     `selftest-fixture.test.ts` on `createMemoryFiles` and `posixPaths` (backlog's fixture test shape):
- `every fixture problem parses` — table over `PRACTICE_FIXTURE_SLUGS`: `parseProblem(JSON.parse(<written
  problem.json>), slug)` does not throw; row `two-sum` → `signature.kind` `function`, `compare` `anyOrder`, 3 cases;
  row `lru-cache` → `signature.kind` `design`, `compare` `exact`, 1 case. Catches a fixture that drifts from 04's
  schema, which would fail the self-test as a load error far from its cause.
- `writes each problem's five files` — the first GIVEN; asserts the sorted file list of each problem folder.
- `a rerun starts with no earlier progress` — the second GIVEN. Catches a rerun that counts two submissions, and a
  fixture that removes the folder main watches.

Done when: `npm run typecheck` passes, `npm run lint` passes, `npm test -- src/plugins/practice/main` passes, and
           `npm run selftest -- --plugin practice` passes. Live checks go to task 12 — Final verification.
Commit:    one commit for the group

## Proof

Commit 364c0343 + 430f11f4 · proof: diff read: selftest-fixture (PRACTICE_FIXTURE_SLUGS), selftest-script, start.ts drive action practice.writeFixture and script handover present; selftest isolation shown (selfTest runMode mkdtemp home); typecheck clean; worker ran practice/main tests 91 green and lint clean; npm run selftest -- --plugin practice failed 3 checksFit (08 CSS overflow), fixed in 430f11f4, rerun all passed · concerns: ResizeObserver loop errors from the vite client around interviewer steps, not failing; tab strip keeps default ui-tabs margin inside the bar (sessions zeroes it) — check visually
