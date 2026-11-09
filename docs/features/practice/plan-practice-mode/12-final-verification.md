# 12 — Final verification

Status: not started
Type: Task
Wave: 9 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     none, unless a check finds a defect; the fix then lands in the task that owns the file, re-proved
Consumes:  every landed task, 01–11
Produces:  the run's proof: the gates green, the self-test green, and the live-check list for the user's wrap-up
Decisions: the user performs live checks in the running app (`~/wigley-agents/AGENTS.md` § Checks for the user); the
           agent runs every check it can reach and lists the rest in the wrap-up, nowhere else

## Gates the agent runs

- `npm run lint` (includes `scripts/check-layers.mts` and `scripts/check-styles.mts`) and `npm run typecheck`, green.
- The tests the run added or edited, picked by reading the run's diff (`wigley:writing-tests` § Picking tests for a
  gate), run by file: the sessions, chat, split and every `src/plugins/practice/**` test file.
- The self-test filtered: `npm run selftest -- --plugin practice --plugin chat --plugin sessions`, green
  (the owned-row and mount changes live there). The whole self-test is not run.
- With no `clang++` on PATH the practice self-test result names `no clang++ on PATH: Run and Submit need it`; on this
  Mac `clang++ --version` answers, so the judge steps must pass.

GIVEN the landed run WHEN the gates above run THEN each is green, or its failure is fixed in its owning task and re-run
Tests:     the picks above
Done when: every gate is green and the live-check list below is in the wrap-up, each item tagged

## Live checks for the user's wrap-up

Each is tagged **expected** (the change doing what it was made to do) or **low-confidence** (wiring or look no test
can see). Drop any a passing self-test step already covers.

Expected:

- `Space k p` shows Practice; again toggles the side bar. The list sorts attempted → new → solved, then difficulty,
  then title; the header counts solved of total per difficulty; `/` filters by the design's words.
- Opening a problem: Description, Submissions, Notes and Solution tabs; `gt`/`gT` cycle them and the console's tabs.
- `solution.cpp` in the vim editor autosaves after typing stops, and `:w` saves at once.
- `⌘'` Run and `⌘↩` Submit against clang++ fill the Result tab; a failing case shows input, expected, output and
  stdout; a compile error points at `solution.cpp:<line>`.
- The Solution tab asks to confirm before showing, and a confirmed peek resets the ladder.
- Enter on a submission shows its code read-only.
- `Space v i` opens the interviewer pane; the first message launches the interviewer, whose chat view mounts in the
  pane; chat's keys act there and Alt+h leaves to the editor.
- An interviewer session never shows in the Sessions side bar, and Option+Shift+o/i never land on it.
- A reason box or image viewer open in a Sessions tab closes when the interviewer is shown.
- `a` on the list opens the import box; the request starts an import session that shows in Sessions.
- In that import session, `add_practice_problem` refuses a deliberately bad case, then succeeds, and the problem
  appears in the list.
- Run and Submit on a real problem give Accepted, Wrong Answer and Compile Error.

Low-confidence:

- C++ highlighting in `solution.cpp` (no page has opened a `.cpp` file in the editor before).
- The stacked column dividers: drag, Alt+Shift+j/k and the `▴ ▾` prompt (the new `axis: 'column'` split CSS).
- The `⌘'` chord on a real keyboard.
- The key-hint placement over the practice scopes: the unscoped Run and Submit anchors and `Ctrl+n` in the new scopes.
- The interviewer pane's look and width at a narrow window, the chat view's session hub at that width, and the import
  box dialog's look.
- After an app relaunch, an interviewer row comes back still hidden and its process carries the interviewer
  instructions (`--append-system-prompt` in the process log).
- An interviewer turn that ends while the window is unfocused raises no OS "Turn finished" alert.
- On Windows without clang++, the self-test's result line names the missing compiler.
- `read_practice_state` answers the interviewer (its host id recorded; it hangs on the order of `sessionOpened` and
  `launch`) and refuses another session.
- An interviewer comes back through `resume` after an app relaunch.
- The sanitizer build's start-up stays inside the 2000 ms time limit on real problems.

## Proof
