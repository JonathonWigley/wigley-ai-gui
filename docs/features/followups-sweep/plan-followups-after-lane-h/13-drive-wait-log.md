# 13 — Drive wait-log and test titles

Status: not started
Type: Batch
Rung: standard · one new optional argument on one drive command, plus a mechanical sweep of test titles
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-ups:
- **The drive `wait-log` misses lines logged before it starts** (`followups.md` L247).
- **`$name_<suffix>` vitest titles lose their case name** (`followups.md` L807). The item names three sites; the tree
  holds 31 of the same break (Decisions). This group fixes every one outside the files other Wave 1 groups edit.

Files:
- A (wait-log):
  - modify `src/main/drive/drive-commands.ts` (`'wait-log'` command)
  - test `src/main/drive/drive-commands.test.ts`
  - modify `scripts/drive-args.mts` (`'wait-log'` usage and parse)
  - modify `.agents/skills/drive/SKILL.md` (the `wait-log` line, about line 150)
- B (titles), each a test file:
  - `src/main/drive/drive-commands.test.ts` (shared with A) · `src/plugins/usage/main/drive-actions.test.ts`
  - `src/plugins/app-update/main/install-command.test.ts` · `src/plugins/app-update/main/start.test.ts` ·
    `src/plugins/app-update/main/updater.test.ts`
  - `src/plugins/chat/main/chat-sessions.test.ts` · `src/plugins/chat/page/chat-view.test.ts` ·
    `src/plugins/chat/page/picker.test.ts`
  - `src/plugins/claude-code/main/claude-code-harness.test.ts`
  - `src/plugins/docs/main/doc-files.test.ts` · `src/plugins/docs/main/start.test.ts` ·
    `src/plugins/docs/page/layout/docs-parts.test.ts` · `src/plugins/docs/page/list-pane.test.ts`
  - `src/plugins/forms/page/layout/layout-panes.test.ts` · `src/plugins/keys/page/start.test.ts`
  - `src/plugins/workflow-large-page.test.ts` · `src/plugins/workflow-large/layouts/default/layout.test.ts` ·
    `src/plugins/workflow/page/workflow-view.test.ts`
  - `src/renderer/plugins/page-api.test.ts` · `src/shared/content-scroll.test.ts`

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main` from the `wigley-ai-gui/` folder):
- `grep -n "const mark = await markLog(window);" src/main/drive/drive-commands.ts` → one line, inside `'wait-log'`'s
  `run`: the wait counts only lines logged after the call.
- `grep -n "wait-log <line>" scripts/drive-args.mts` → two lines, `usage: 'wait-log <line> [{"timeoutMs":n}]'` and the
  `requireCount` message.
- `grep -n "a line already in the log does not count" .agents/skills/drive/SKILL.md` → one line.
- `grep -rnoE "['\`][^'\`]*\\\$[a-zA-Z][a-zA-Z0-9]*_[A-Za-z][^'\`]*['\`]" src scripts --include='*.test.ts' --include='*.test.mts'`
  → 31 hits plus the comment at `src/shared/fake-agent-harness.test.ts` (`$name_suffix`, not a title). On merged
  `main` a later merge may add hits: fix every hit in a file this group lists or no Wave 1 group lists; leave
  `src/plugins/docs/page/tree-view.test.ts` (task 01 edits it) and `src/plugins/chat/main/start.test.ts` (task 18 fixes
  its site).

Consumes: `LogMark`, `markLog`, `waitForNewLogLine` (`src/main/drive/page-driver.ts`), `optionalNumber`
(`src/shared/drive-args.ts`) — in the tree. Nothing from another task.

Produces: the drive command `wait-log` takes `{ line: string, timeoutMs?: number, since?: number }`.

Decisions:
- **A `since` cursor, not a new default.** `wait-log` keeps "logged after the call" as its default, since a driver
  waiting on a line that repeats (`[page] saved`) must not be satisfied by an old one. It gains `since`, the cursor
  `log` already returns as `next` (an oldest-first index into the page log): with it, every line at that index or
  later counts, lines already logged included. `since: 0` scans the whole log. This is the item's second option, "let
  `wait-log` scan the log it already holds", in the form `log` already uses.
- **The mark from the cursor.** With `since` given, `run` builds `const mark: LogMark = { navigation:
  window.navigationCount(), length: since }` in place of `await markLog(window)` and hands it to
  `waitForNewLogLine` unchanged. `linesSince` already reads a log shorter than the mark as reloaded and counts all
  of it, the same rule `log` uses for a `since` past its end. No change in `page-driver.ts`.
- **Validation.** `since` is read with `optionalNumber(args, 'since')`; a value that is not a whole number of 0 or
  more rejects with `wait-log since must be a whole number of 0 or more`, before any read.
- **The description and the usage line.** The command's `description` becomes: `'waits for a page log line equal to
  the whole line, its source prefix included (`[page] …`): one logged after the call, or with `since` (the `next` a
  `log` call returned) one at that index or later, already logged or not'`. `scripts/drive-args.mts`' usage becomes
  `wait-log <line> [{"timeoutMs":n,"since":n}]`; the parse is unchanged (it passes the JSON object through).
- **SKILL.md.** The `wait-log` line becomes: "`wait-log` matches a whole page log line, its source prefix included
  (`[page] …`), logged after the call starts; a line already in the log does not count unless `since` is given:
  `{"since":n}` with the `next` an earlier `log` returned counts every line from there on, so a driver reads a line a
  page start already logged with `log` once, then `wait-log` from its `next`."
- **Titles: the whole category.** Vitest reads `$key` up to the first character outside `[\w.$]`, so `$name_Sets…`
  reads the key `name_Sets…` and prints `undefined` for it. The fix follows the repo's note in
  `fake-agent-harness.test.ts` (`agentsTurn_$case`): the variable part sits at the end of the title, or the row
  carries its whole tail. Per site:
  - where the field is a label only (not passed to the code under test), the row's label grows to the whole tail and
    the title ends on it: `failNextPoll_$name` with `name: 'MessageGiven_NextPlanUsageRejects'` and
    `'NoMessage_NextPlanUsageRejects'`;
  - where the field is data the test passes in (`drive-commands.test.ts`' `name`, a setting path), the row gains a
    `case` field holding the tail and the title becomes `setting_$case`. The six cases, in row order:
    `Transparency_SetsItAtItsDottedPathKeepsTheRestAndIsApplied`,
    `NestedNewKey_SetsItAtItsDottedPathKeepsTheRestAndIsApplied`,
    `NewObject_SetsItAtItsDottedPathKeepsTheRestAndIsApplied`, then `TrailingDot_IsRefusedAndTheFileIsUnchanged`,
    `LeadingDot_IsRefusedAndTheFileIsUnchanged`, `ParentNotAnObject_IsRefusedAndTheFileIsUnchanged`;
  - every other site picks one of the two by the same rule, and a title with several variables
    (`sidePane_Checked$checked_Of$total_FillsTheBarTo$percent`) moves every variable but the last into a trailing
    `($a of $b)`-style suffix or a `case` field, so no `$key` is followed by a word character.
  No test's body, rows' data or assertion changes.

GIVEN a page whose log already holds `[a] done` WHEN `wait-log` runs with `{ line: '[a] done', since: 0 }` THEN it
returns `{ found: true }` without waiting.
GIVEN the same log WHEN `wait-log` runs with no `since` THEN it still returns `{ found: false }` after its timeout.
GIVEN a log of two lines WHEN `wait-log` runs with `since: 2` and the matching line is logged later THEN it returns
`{ found: true }`; WHEN the line was the first of the two THEN `{ found: false }`.

Tests (in `drive-commands.test.ts`, beside `waitLog_MatchingLineLoggedBeforeTheCall_ResolvesNotFound`, which stays):
- `waitLog_SinceZeroLineAlreadyLogged_ResolvesFound`: log `['[a] done']`, args `{ line: '[a] done', since: 0,
  timeoutMs: 100 }` → `{ found: true }`.
- `waitLog_SinceAfterTheMatchingLine_ResolvesNotFound`: log (newest first) `['[a] other', '[a] done']`, args
  `{ line: '[a] done', since: 1, timeoutMs: 100 }` → `{ found: false }`.
- `waitLog_SinceNotAWholeNumber_Rejects`: `it.each` over `-1`, `1.5` → rejects with
  `wait-log since must be a whole number of 0 or more`.
- B: no new test; each renamed title is checked by reading `npm test`'s output for the file (no `undefined` in a
  title the file prints).

Done when: compiles (`npm run typecheck`); `npm test` runs `src/main/drive/drive-commands.test.ts` with the three new
tests green and every file in B green; the precondition grep prints only the leftover sites in the two files named
there and the fake-agent-harness comment; `npm run lint` clean.

Commit: one commit for the group, e.g. "Drive wait-log takes a since cursor; test titles end on their variable
(follow-ups: wait-log misses earlier lines, `$name_<suffix>` titles)"
