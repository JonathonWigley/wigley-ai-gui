# Practice mode — settled design

**Contents**

- **Scope** — what Practice covers and what stays out.
- **The mode** — the plugin, the screen, the list, the keys.
- **Problem files** — the practice folder, one problem's files, `problem.json`.
- **Judging** — the prelude, the driver, Run, Submit, verdicts, compare modes, value types.
- **Progress** — status, attempts, submissions, the review ladder, peeking.
- **Adding problems** — the import session and the `add_practice_problem` tool.
- **The interviewer** — the side pane, its lifetime, its instructions, `read_practice_state`.
- **Chat and sessions changes** — the embeddable chat view, per-session instructions, rows with an owner, main `resume`.
- **Seams** — the modules and what each one owns, and the self-test fixture.

The decisions the user settled in the 2026-11-08 interview (four rounds, the design review and the agent's Decided
notices), kept so the plan is written from them. A decision here stands unless the user changes it.

## Scope

- Practice is a place to solve LeetCode-style problems in C++: a raw vim editor, a compiler, the problem's tests,
  and progress records. No autocomplete, no language server, no other language.
- Problems come in only through an agent: the user never writes a problem file by hand.
- Progress is practical, with no gamification: no streak, no timer, no score, no Due section, no required queue.
- The format follows LeetCode's: a `class Solution` method or a design class, Run and Submit, the Testcase and
  Result console, and LeetCode's verdict names.

## The mode

- The `practice` plugin has a main part, a page part and a layout (`practice.layout`, contract
  `src/plugins/practice/layouts/layout.d.ts`, built-in `default`), and adds Practice mode. Main depends on `chat` and
  `sessions`; the page depends on `chat`.
- **Side bar:** one flat list of every problem, sorted by status (attempted, then new, then solved), then difficulty
  (easy, medium, hard), then title. Each row shows the title, the difficulty, a status mark and a due mark when its
  review date has come. A header line counts solved of total for each difficulty. There is no Due section and no
  grouping by list. A first list read that fails shows its error in place of the rows; a later one keeps the rows and
  toasts.
- **Opening another problem** saves the shown problem's drafts first. A draft that fails to save keeps the shown
  problem open and selected, logs `kept <slug>: a draft did not save` and toasts
  `<title> not opened: a draft did not save`.
- **Filter:** `/` filters the list. Each word narrows it: `easy`, `medium` or `hard` keeps that difficulty; `new`,
  `attempted`, `solved`, `unsolved` (new or attempted) or `due` keeps that status; a word naming one of the problem's
  tags or lists (case-insensitive, whole word) keeps those; any other word matches the title by fuzzy match. A word
  that is a tag or list word of any problem never falls back to title matching.
- **Content, stacked full width:** the problem pane on top with the tabs Description, Submissions, Notes and Solution;
  the editor holding `solution.cpp` in the middle; the console at the bottom with the tabs Testcase and Result. The
  interviewer pane sits to the right of the whole column, hidden until toggled. Every divider is a `Split`, its size
  kept in `uiState`.
- **Notes tab:** a vim box over the problem's `notes.md`, autosaved.
- **Solution tab:** shows `approach.md` and `reference.cpp`. Opening it asks to confirm first, because opening it
  marks the attempt as peeked.
- **Submissions tab:** every submission of the problem, newest first, each with its verdict, passed count, runtime
  and time; Enter on one shows its code read-only.
- **Editor:** the editor host's document editor with `fileName: 'solution.cpp'` (C++ highlighting from the installed
  language data). It autosaves after typing stops, and `:w` saves at once.
- **Keys** (all checked against `docs/keymap.md` and `src/plugins/keymap.ts`):

  | Key | Scope | Action |
  |---|---|---|
  | `Space k p` | any | show Practice; again: toggle the side bar |
  | `j` `k` `gg` `G` | list | move |
  | `Enter` / `l` | list | open the problem; `l` keeps the focus in the list |
  | `/` | list | filter; `Enter` accepts, `Esc` cancels (scope `practice.box`, pushed while the filter box is open) |
  | `a` | list | open the import box (scope `practice.import`, pushed): `Enter` starts the import from a one-line request, `Esc` cancels |
  | `⌘'` | every Practice scope, the editor included | Run |
  | `⌘↩` | every Practice scope, the editor included | Submit |
  | `gt` / `gT` | problem pane, console | next / previous tab of that pane |
  | `j` `k` `gg` `G` `Enter` `Esc` | problem pane | move over the Submissions rows, open a submission's code, back to the rows |
  | `i` / `Esc` | problem pane, console | edit the Notes or Testcase box / leave it |
  | `Ctrl-j` `Ctrl-k` `Ctrl-Shift-j` `Ctrl-Shift-k` | problem pane, console | scroll a line / half a page |
  | `y` `n` `Esc` | the Solution confirm (scope `practice.confirm`, pushed) | open the tab / keep solving |
  | `Space v i` | any | show or hide the interviewer pane; with Practice hidden and the pane shown, it only shows Practice |
  | `Enter` / `Esc` | the interviewer's ask box (scope `practice.ask`) | send the first message / leave the box |
  | `⌥h` `⌥j` `⌥k` `⌥l` | core | move between the list, the problem pane, the editor, the console and the interviewer |

  `practice.ask` is a base scope the view sets through `setScope`, so it sits in the `<C-n>` list beside the list,
  problem, editor and console scopes and is never pushed; `practice.box`, `practice.confirm` and `practice.import` are
  pushed over the base scope while their box or prompt is open. A click into the list or into a pane of the column
  hands that pane the keys.

  The interviewer's mounted chat view holds chat's own keys, so there `⌘↩` sends the message and Run and Submit wait
  until the keys leave the view.

  Every non-vim key gets its anchor where it acts (`AGENTS.md` § Key hints).

## Problem files

- The practice folder is the `folder` setting, default `~/leetcode`: plain files the user may commit to git.
- One problem is `problems/<slug>/` holding:

  | File | Holds | Written by |
  |---|---|---|
  | `problem.json` | title, difficulty, tags, lists, kind, signature, compare mode, cases | import |
  | `problem.md` | the statement, examples and constraints | import |
  | `reference.cpp` | the agent's reference solution | import |
  | `approach.md` | the agent's approach write-up | import |
  | `solution.cpp` | the user's code; a stub from the signature at import and at each fresh attempt | import, user |
  | `solution.<attempt id>.cpp` | a due problem's earlier code, kept as a fresh attempt starts | app |
  | `notes.md` | the user's notes | user |
  | `custom-cases.json` | the user's own Testcase inputs | user |
  | `progress.json` | status, attempts, review step and date | app |
  | `submissions/<time>.json` | one Submit: verdict, counts, runtime, the failing case, the code | app |

- `interviewer.md` at the folder's root, when present, replaces the built-in interviewer instructions.
- `.build/` at the folder's root holds the prelude, generated drivers, binaries and a snapshot of the code each judge
  call compiles, so the code recorded with a submission is the code that ran. The app writes
  `.build/.gitignore` holding `*`, so the folder ignores itself without the user's own `.gitignore` changing.
- `problem.json` kinds:
  - `function`: a `Solution` class with one method; the signature names the method, its parameters (name and type)
    and its return type. A case is `{ "input": [<one JSON value per parameter>], "expected": <JSON value> }`.
  - `design`: a class the user writes (LRU Cache and the like); the signature names the class, its constructor's
    parameters and each method's parameters and return type. A case is LeetCode's own form:
    `{ "ops": ["LRUCache","put","get"], "args": [[2],[1,1],[1]], "expected": [null,null,1] }`, `null` for the
    constructor and each void call.
  - Each case has `visible: true` or `false`; visible cases are the examples Run uses.

## Judging

- Solutions compile against a prelude header the app writes, holding every standard header and `using namespace
  std;`, because Apple clang has no `<bits/stdc++.h>`. The prelude also declares LeetCode's `ListNode` and
  `TreeNode`.
- The app generates a driver per problem from its signature: it includes the prelude and `solution.cpp`, reads one
  case from a cases file named on its command line, calls the solution, and writes the result as JSON to a result
  file named on its command line, so the user's own `cout` output stays separate. `ProcessRunner` takes no stdin, which
  is why the driver reads files.
- Compile command, flags and time limit are settings: `compiler` (default `clang++`), `flags` (default
  `-std=c++20 -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer`) and `timeLimitMs` (default `2000`).
- Each case runs as its own process, under the time limit, so one slow case reports Time Limit Exceeded on that case
  and a crash ends only its case. A program's stdout and stderr are each read up to 1 MB; the rest is dropped.
- A compiler that cannot start is an error (`Could not run <compiler>: <reason>`), not a Compile Error: Run and Submit
  show the error in place of a verdict, and Submit records nothing.
- **Run** runs the visible cases and the user's custom cases, and records nothing. A custom case's expected answer
  comes from running `reference.cpp` on it, as LeetCode's Run does.
- **Submit** runs every case in order, stops at the first that fails, and records a submission.
- **Verdicts:** Accepted, Wrong Answer, Time Limit Exceeded, Runtime Error (a non-zero exit or a sanitizer report),
  Compile Error. A sanitizer report is a Runtime Error even when the run also ran past the time limit, since writing the
  report can take that long.
- **A failed case** shows its input, the expected answer, the output and the case's stdout; a Runtime Error also
  shows stderr. **Compile errors** show the compiler's output with each location rewritten to `solution.cpp:<line>`.
- **Runtime** is the measured wall time of the cases, on the sanitizer build: a number for comparing the user's own
  attempts, not a LeetCode percentile.
- **Compare modes** (`compare` in `problem.json`): `exact`; `anyOrder` (the top-level list sorted before comparing);
  `anyOrderDeep` (each inner list sorted, then the outer list); `float` (numbers within `1e-5`, absolute or relative).
- **Value types:** `int`, `long long`, `double`, `bool`, `char`, `string`, `vector`s and nested `vector`s of these,
  `ListNode*` and `TreeNode*` in LeetCode's array form (`[1,2,null,3]`). The import tool refuses a problem whose
  signature uses any other type. A tree's trailing nulls are trimmed as `problem.json` is read, and a tree with values
  past its last node is refused.

## Progress

- Status is new (never submitted), attempted (submitted, never Accepted) or solved (Accepted at least once).
- **An attempt** is one go at a problem: it starts when the problem first opens, and again at each fresh start. It
  records its start time, whether the Solution tab was opened (peeked), its interviewer session, and its submissions.
- **The review ladder** is the `reviewSteps` setting, default `[1, 3, 7, 14, 30, 60]` days. A clean solve — the
  attempt's first Accepted Submit, with no peek — moves the problem one step up and sets its next review date that many
  days ahead. Opening the Solution tab drops the problem to the first step. A Wrong Answer does not move it.
- **Opening a problem:** a due problem (its review date reached) opens on a fresh stub in a new attempt; old code that
  is not the stub is kept as `solution.<previous attempt id>.cpp`, and stays in its submissions. Any other problem opens
  on its last code in its current attempt.
- Problem lists (Blind 75, Graphs and the like) come from the agent at import, in `problem.json`'s `lists`.

## Adding problems

- `a` on the list opens a one-line box; the request ("add the Blind 75 graph problems") starts an import session
  through chat's `launch` in the practice folder with the default profile, carrying the built-in import
  instructions. It is an ordinary chat session with its own row in the Sessions side bar.
  The box refuses a blank request with `Type what to import.` under it. A launch that fails keeps the box open with
  the error under it and logs `import failed: <error>`.
- `add_practice_problem` is an MCP tool every session lists. It takes the problem's `problem.json` fields, the
  statement, the reference solution and the approach. Every refusal starts `Refused:` and writes nothing: a blank or
  non-string `slug`, `statement`, `reference` or `approach`; a bad schema or an unsupported type (the message names the
  field path); a reference that does not compile (with the compiler's output); and a reference that disagrees with the
  expected answer, which names the count and each failing case as `case <n> (visible|hidden)` with its input, expected
  and got values. A slug already present is refused unless the call sets `replace: true`, which rewrites the import's
  files and keeps the user's solution, notes, custom cases, progress and submissions. On success it writes the
  statement, reference and approach, a stub `solution.cpp` (unless a replace keeps the user's), and `problem.json`
  last, so a list read on the first change sees every file. It answers `Added <slug>` or `Replaced <slug>` by whether
  the slug existed, not by the flag.

## The interviewer

- The interviewer pane replaces separate hint and review commands. The interviewer answers questions about the
  problem's setup directly, asks guiding questions, and never reveals a solution or gives a direct answer; it lets
  the user fail.
- **Lifetime:** one interviewer per attempt. The pane shows a plain ask box until the user's first message, which
  launches the interviewer with that message; the pane then shows the chat view of that session. Reopening the
  problem brings the same session back (resumed if chat no longer holds it); a resume chat refuses clears the stored
  interviewer, and the next ask launches a fresh one. A new attempt's first message launches a
  fresh one and closes the latest earlier interviewer that chat still holds, since that one has no Sessions row the
  user could close. Asks for one problem run one at a time. A launch that gets no host session id from chat within
  two seconds is closed and fails; a failed read or mount of the interviewer shows an error toast and logs
  `interviewer not read <slug>` or `interviewer not mounted <slug>`.
- Talking to the interviewer is not a peek.
- **Instructions:** built into the plugin; `interviewer.md` in the practice folder replaces them when present. They
  reach the harness as the session's own instructions, not as a message.
- The interviewer reads the user's screen through `read_practice_state`, a tool every session lists but only
  interviewer sessions may call: it returns Markdown: the problem's statement, signature, the current code, the last
  Run or Submit result (`None since the app started.` before any; a failing case as Input, Expected, Output and Stdout
  lines, with Stderr for a Runtime Error) and the attempt's state. It never returns the reference or the approach. Any
  other session gets an error result.
- Interviewer sessions run in the practice folder with the default profile and have no row in the Sessions side bar.

## Chat and sessions changes

- **Embeddable chat view:** chat's page exports `mountChat(element, sessionId)`, which builds a chat view of a
  session chat holds into the element and returns a handle with `shown`, `hidden` and `dispose`; a session whose
  record or row has not reached the page yet is drawn once both arrive. The Chat tab and the
  mount fill one small host interface (attach, shown, hidden, visible), so the view stays one module with two
  adapters. A session shows in one place: a session with an owner is never placed in a Sessions pane.
- **Per-session instructions:** `LaunchRequest.instructions` (and `ResumeRequest.instructions`) carry text this
  session alone passes to its harness after the global `addInstructions` texts. They are saved with the session, so
  they hold across `/clear`, a relaunch and a resume.
- **Rows with an owner:** `LaunchRequest.owner` and `ResumeRequest.owner` name the plugin a session belongs to.
  Sessions keeps the owner on the row, and chat saves it with the session and passes it back on restore; the Sessions
  side bar, the next and previous session keys and pane placement skip such a row, and it is never the selected row
  and raises no "Turn finished" mark.
- **Known limits:** a tab or popup another plugin opens for an interviewer session (a forms round, the primer) waits
  for a Sessions row that never shows, so it never appears. While chat holds an interviewer's row, the start
  prompt's saved sessions leave it out. Once chat no longer holds it, it lists in the start prompt's resume list for
  the practice folder, and resuming it from there opens it as an ordinary visible session.
- **Main `resume`:** chat's main part exports `resume(request)`, the channel's resume with the same new fields, so a
  plugin can bring back a saved session it owns. When chat holds a row for the session, a resume whose owner differs
  from the row's (no owner counting as one) rejects, naming both.

## Seams

- **Problem store** (main): reads and validates `problem.json` and its siblings, writes the app's files, and
  watches `problems/` from its first list on, so an app start that never lists creates no folder. The list,
  the judge and both tools read through it, so a bad file gets one error naming the file and the field.
- **Judge** (main): takes the problem, the code and the cases, receives `ProcessRunner` and `Files`, and returns a
  verdict per case. Run, Submit and the import tool's reference check all go through it.
- **Pure functions**, each with table tests: driver source from a signature, answer comparison per compare mode, the
  next review step and date from an outcome (with an injected clock), compile-error line mapping, and the list's
  sort and filter reducer.
- **Self-test:** the plugin hands the self-test a script and offers the `practice.writeFixture` drive action, which
  writes two problems into the practice folder, replacing every problem there: `two-sum` (a function problem with a
  correct `solution.cpp`) and `lru-cache` (a design problem whose `get` always returns -1, so Submit gives Wrong
  Answer), then tells the page to list again.
- **Tools:** `add_practice_problem` and `read_practice_state`, contributed through sessions' `contributeTools`; the
  second checks the calling session against Practice's interviewer ids at call time, since the tool list is global.
