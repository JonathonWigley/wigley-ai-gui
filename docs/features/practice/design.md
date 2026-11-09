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
- **Seams** — the modules and what each one owns.

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
  grouping by list.
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
  | `j` `k` `gg` `G` `Enter` | list | move, open the problem |
  | `/` | list | filter |
  | `a` | list | start an import session from a one-line request |
  | `⌘'` | every Practice scope, the editor included | Run |
  | `⌘↩` | every Practice scope, the editor included | Submit |
  | `gt` / `gT` | problem pane, console | next / previous tab of that pane |
  | `Space v i` | any | show or hide the interviewer pane |
  | `⌥h` `⌥j` `⌥k` `⌥l` | core | move between the list, the problem pane, the editor, the console and the interviewer |

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
  | `notes.md` | the user's notes | user |
  | `custom-cases.json` | the user's own Testcase inputs | user |
  | `progress.json` | status, attempts, review step and date | app |
  | `submissions/<time>.json` | one Submit: verdict, counts, runtime, the failing case, the code | app |

- `interviewer.md` at the folder's root, when present, replaces the built-in interviewer instructions.
- `.build/` at the folder's root holds the prelude, generated drivers and binaries. The app writes
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
  and a crash ends only its case.
- **Run** runs the visible cases and the user's custom cases, and records nothing. A custom case's expected answer
  comes from running `reference.cpp` on it, as LeetCode's Run does.
- **Submit** runs every case in order, stops at the first that fails, and records a submission.
- **Verdicts:** Accepted, Wrong Answer, Time Limit Exceeded, Runtime Error (a non-zero exit or a sanitizer report),
  Compile Error.
- **A failed case** shows its input, the expected answer, the output and the case's stdout; a Runtime Error also
  shows stderr. **Compile errors** show the compiler's output with each location rewritten to `solution.cpp:<line>`.
- **Runtime** is the measured wall time of the cases, on the sanitizer build: a number for comparing the user's own
  attempts, not a LeetCode percentile.
- **Compare modes** (`compare` in `problem.json`): `exact`; `anyOrder` (the top-level list sorted before comparing);
  `anyOrderDeep` (each inner list sorted, then the outer list); `float` (numbers within `1e-5`, absolute or relative).
- **Value types:** `int`, `long long`, `double`, `bool`, `char`, `string`, `vector`s and nested `vector`s of these,
  `ListNode*` and `TreeNode*` in LeetCode's array form (`[1,2,null,3]`). The import tool refuses a problem whose
  signature uses any other type.

## Progress

- Status is new (never submitted), attempted (submitted, never Accepted) or solved (Accepted at least once).
- **An attempt** is one go at a problem: it starts when the problem first opens, and again at each fresh start. It
  records its start time, whether the Solution tab was opened (peeked), its interviewer session, and its submissions.
- **The review ladder** is the `reviewSteps` setting, default `[1, 3, 7, 14, 30, 60]` days. A clean solve — the
  attempt's first Accepted Submit, with no peek — moves the problem one step up and sets its next review date that many
  days ahead. Opening the Solution tab drops the problem to the first step. A Wrong Answer does not move it.
- **Opening a problem:** a due problem (its review date reached) opens on a fresh stub in a new attempt; the old code
  stays in its submissions and in git. Any other problem opens on its last code in its current attempt.
- Problem lists (Blind 75, Graphs and the like) come from the agent at import, in `problem.json`'s `lists`.

## Adding problems

- `a` on the list opens a one-line box; the request ("add the Blind 75 graph problems") starts an import session
  through chat's `launch` in the practice folder with the default profile, carrying the built-in import
  instructions. It is an ordinary chat session with its own row in the Sessions side bar.
- `add_practice_problem` is an MCP tool every session lists. It takes the problem's `problem.json` fields, the
  statement, the reference solution and the approach. It refuses a bad schema or an unsupported type, then compiles the
  reference and runs it on every case; on any case where the reference disagrees with the expected answer it refuses,
  naming each failing case, and writes nothing. On success it writes the problem's files with a stub `solution.cpp`. A
  slug already present is refused unless the call sets `replace: true`, which rewrites the import's files and keeps the
  user's solution, notes, custom cases, progress and submissions.

## The interviewer

- The interviewer pane replaces separate hint and review commands. The interviewer answers questions about the
  problem's setup directly, asks guiding questions, and never reveals a solution or gives a direct answer; it lets
  the user fail.
- **Lifetime:** one interviewer per attempt. The pane shows a plain ask box until the user's first message, which
  launches the interviewer with that message; the pane then shows the chat view of that session. Reopening the
  problem brings the same session back (resumed if its row is gone); a new attempt starts a fresh one and closes the
  old attempt's interviewer, which has no Sessions row the user could close it from.
- Talking to the interviewer is not a peek.
- **Instructions:** built into the plugin; `interviewer.md` in the practice folder replaces them when present. They
  reach the harness as the session's own instructions, not as a message.
- The interviewer reads the user's screen through `read_practice_state`, a tool every session lists but only
  interviewer sessions may call: it returns the problem's statement, signature, the current code, the last Run or
  Submit result and the attempt's state. Any other session gets an error result.
- Interviewer sessions run in the practice folder with the default profile and have no row in the Sessions side bar.

## Chat and sessions changes

- **Embeddable chat view:** chat's page exports `mountChat(element, sessionId)`, which builds a chat view of a
  session chat holds into the element and returns a handle with `shown`, `hidden` and `dispose`; a session whose
  record or row has not reached the page yet is drawn once both arrive. The Chat tab and the
  mount fill one small host interface (attach, shown, hidden, visible), so the view stays one module with two
  adapters. A session shows in one place: an session with an owner is never placed in a Sessions pane.
- **Per-session instructions:** `LaunchRequest.instructions` (and `ResumeRequest.instructions`) carry text this
  session alone passes to its harness after the global `addInstructions` texts. They are saved with the session, so
  they hold across `/clear`, a relaunch and a resume.
- **Rows with an owner:** `LaunchRequest.owner` and `ResumeRequest.owner` name the plugin a session belongs to.
  Sessions keeps the owner on the row, and chat saves it with the session and passes it back on restore; the Sessions
  side bar, the next and previous session keys and pane placement skip such a row, and it is never the selected row
  and raises no "Turn finished" alert.
- **Known limits:** a tab or popup another plugin opens for an interviewer session (a forms round, the primer) waits
  for a Sessions row that never shows, so it never appears. A saved interviewer session still lists in the start
  prompt's resume list for the practice folder; resuming it from there opens it as an ordinary visible session.
- **Main `resume`:** chat's main part exports `resume(request)`, the channel's resume with the same new fields, so a
  plugin can bring back a saved session it owns.

## Seams

- **Problem store** (main): reads and validates `problem.json` and its siblings, writes the app's files. The list,
  the judge and both tools read through it, so a bad file gets one error naming the file and the field.
- **Judge** (main): takes the problem, the code and the cases, receives `ProcessRunner` and `Files`, and returns a
  verdict per case. Run, Submit and the import tool's reference check all go through it.
- **Pure functions**, each with table tests: driver source from a signature, answer comparison per compare mode, the
  next review step and date from an outcome (with an injected clock), compile-error line mapping, and the list's
  sort and filter reducer.
- **Tools:** `add_practice_problem` and `read_practice_state`, contributed through sessions' `contributeTools`; the
  second checks the calling session against Practice's interviewer ids at call time, since the tool list is global.
