# 15 — Git.commitPaths removed

Status: done
Type: Task
Rung: standard · removes one contract member, its adapter, its tests and two fakes; no behaviour changes
Wave: 3 · Depends on: 01, 05 (each lists `AGENTS.md`)
Plan: [plan.md](plan.md)

Follow-up: **`Git.commitPaths` has no caller** (`followups.md` L640).

Files:     modify `src/contracts/git.ts` · modify `src/main/git/process-git.ts` · test `src/main/git/process-git.test.ts` ·
           test `src/plugins/backlog/main/start.test.ts` · test `src/plugins/docs/main/plugin-status.test.ts` ·
           modify `AGENTS.md` (§ the source tree, the `git/` entry)

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main` from the `wigley-ai-gui/` folder):
- `grep -rn "commitPaths" src scripts` → only `src/contracts/git.ts` (the member), `src/main/git/process-git.ts` (the
  header comment and the adapter), `src/main/git/process-git.test.ts` (four tests), and the two fakes
  `src/plugins/backlog/main/start.test.ts` and `src/plugins/docs/main/plugin-status.test.ts`. No production caller. If a
  caller appeared, stop: the item's other option ("name the next caller") applies, and the task is struck.
- `grep -n "and a commit of named paths" AGENTS.md` → one line, ending the `git/` entry's list; the next line opens
  `only → the only place the app runs \`git\``.

Consumes: nothing from another task.

Produces: `Git` (`src/contracts/git.ts`) without `commitPaths`.

Decisions:
- **Remove, not keep.** Nothing calls it since Backlog's Commit went; the item offers removal or naming a caller, and
  no plan in flight names one (the scheduled-tasks plan's tasks do not use git).
- **What goes.** The `commitPaths` member and its comment in `git.ts`; the adapter entry in `process-git.ts`, and
  "and `commitPaths`" in its header comment, which becomes "one run per call (two for `fileAtHead`, up to two for
  `currentBranch`)"; the tests `commitPaths_Paths_AddThenCommitOnly`, `commitPaths_NoPaths_RejectsWithoutRunning`,
  `commitPaths_UnrelatedFileStaged_CommitsOnlyPathsAndKeepsItStaged` and
  `commitPaths_PathWithGlobCharacter_CommitsOnlyThatFile`; the `commitPaths: vi.fn<Git['commitPaths']>(…)` line in
  each fake. Imports the removed tests alone used go too (`mkdirSync` stays: other real-clone tests use it).
- **AGENTS.md.** The `git/` entry's list drops its last clause: "…, the commit that first added a text to a file
  (`firstAdded`), and a commit of named paths\n only → the only place…" becomes "…, and the commit that first added a
  text to a file (`firstAdded`) → the only place…". The Backlog self-test fixture clause after it stays. The
  scheduled-tasks merge adds a `login-start/` entry just above `git/`; anchor on the text, not the line.

GIVEN the merged tree WHEN this lands THEN `grep -rn commitPaths src scripts AGENTS.md` prints nothing and every
`satisfies Git` fake still compiles.

Tests: no new test; the four removed tests go with the member. `process-git.test.ts`, `backlog/main/start.test.ts` and
`docs/main/plugin-status.test.ts` pass unchanged otherwise.

Done when: compiles (`npm run typecheck`); `npm test` runs the three named test files green; `npm run lint` clean.

Commit: one commit for the group, e.g. "Remove Git.commitPaths, which nothing calls since Backlog's Commit went
(follow-up: Git.commitPaths has no caller)"

## Proof

Commit 8213e6a96 · proof: diff read: commitPaths gone from contract, adapter, tests, two fakes and AGENTS.md git/ entry; grep empty; typecheck and lint clean · concerns: none
