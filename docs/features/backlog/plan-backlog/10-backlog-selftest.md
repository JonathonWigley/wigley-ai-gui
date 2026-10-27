# 10 — Backlog self-test

Status: not started
Type: Task
Wave: 5 · Depends on: 09
Plan: [plan.md](plan.md)

Files:     create `src/plugins/backlog/main/selftest-fixture.ts` (+ `.test.ts` when docs' fixture has one) · create
           `src/plugins/backlog/main/selftest-script.ts` · modify `src/plugins/backlog/main/start.ts` (hand the script
           to `services.selfTest?.run`, as `src/plugins/docs/main/start.ts` does) · modify
           `src/plugins/docs/main/selftest-fixture.ts` (the backlog repo's index entries, appended after the existing
           entries so `sessionDocument`'s positions `[0, 1, 4, 5]` still pick the same entries) · modify
           `src/plugins/docs/main/selftest-script.ts` (every machine entry count it expects, e.g.
           `machine index rebuilt: 10 entries`, grows by the entries added; measured at plan time, re-verify)
Consumes:  `backlogMainPart`, every backlog page command and key ← 08, 09 · existing: `SelfTestScript`,
           `SelfTestGroup`, `SelfTestStep` (`src/contracts/plugin.ts`), docs' fixture and script as the pattern
           (`src/plugins/docs/main/selftest-fixture.ts`, `selftest-script.ts`)
Produces:  `backlogSelfTestScript(deps): SelfTestScript` in `selftest-script.ts`
Decisions: a key behaviour the agent adds gets a self-test step in its plugin's script (AGENTS.md § Running and
           testing) · the fixture builds its own features homes in the self-test's temp home, never a real one
           (writing-tests § Build the data you assert against) · the docs index must list the fixture's homes: write
           them where docs' fixture already makes the index find a repo, and read docs' fixture to see how

## Fixture

- The git repo: `<temp home>/dev/backlog-repo`, with `docs/features/followups.md` (section-shaped: three items, one
  tagged `agent-ready`, one untagged, one struck through) and `docs/features/backlog-x/plan-x/plan.md` with two task
  docs. The backlog fixture writes these files, then runs `git init`, `git add` and `git commit` through
  `services.processes`, so `uncommitted` starts false. This is the one named exception to "the git adapter is the only
  place the app runs `git`" (AGENTS.md `git/` entry, edited ahead). Set `user.name` and `user.email` with `-c` on the
  commit so the run needs no global git identity. A rerun removes the folder first.
- The list-shaped home: docs' existing `~/wigley-features/selftest-repo/followups.md`
  (`- **First follow-up** — waits.`). Docs' own steps may add items to it before Backlog runs, so Backlog's steps
  assert only on titles Backlog wrote or on `First follow-up`.
- The index: docs' fixture writes the machine `index.json`. Add the backlog repo's entries there (one `followup`
  entry per item with `meta.tags`, one `plan`, two `task`), built with docs' `entry` helper. Backlog's fixture writes
  only its repo's files and the git setup.

## Groups (each with a `why`)

Each step waits on a pinned `[backlog] …` log line from task 09 § Log lines. File text is checked by reading the
file in a step; the commit subject by `git log -1 --format=%s` run through `services.processes` (the same named exception as the
fixture's setup); a mismatch is reported through `problems(result)` as docs' script reports a failed check.

1. **open** — `Space k b` shows Backlog; the side bar lists `backlog-repo` and `selftest-repo`; opening the git home
   lists two follow-ups (the done one hidden), the plan, and `agent-ready` on one row. Screenshot `backlog-home`.
2. **done and filter** — `Space v d` shows the struck item; `Space v a` shows only the tagged item; `/` with a title
   fragment narrows the list.
3. **tag** — `t` on the untagged item writes `*agent-ready*:` to its Contents line (the script reads the file) and the
   home shows the uncommitted Tag.
4. **create and edit** — `a`, type a title, one line and body, `Cmd+Enter`: the file gains the Contents line and
   section. `i` on it, change the title, save: heading and Contents line both change. Screenshot `backlog-editor`
   while the editor is open.
5. **delete** — `d`, `y`: the section and its Contents line are gone.
6. **outside change** — a step's `writeFile` appends an item to the list-shaped file; the list shows it without a
   rescan.
7. **commit** — `C` on the git home: `[backlog] committed <root>`, the uncommitted Tag clears, and the subject of
   `git log -1 --format=%s` starts with `Follow-ups edited in Backlog:`.
8. **plan** — selecting the plan renders `plan.md`; `<CR>` expands its task rows; selecting a task row renders it.

Tests:     the self-test itself. `selftest-fixture.test.ts` only if docs keeps one for its fixture.
Done when: `npm run selftest` passes every group, including every other plugin's; the agent has looked at both
           screenshots against `DESIGN.md` and reports what it saw.
Commit:    one commit for the group

## Proof
