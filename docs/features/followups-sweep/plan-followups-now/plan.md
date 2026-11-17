# Follow-ups sweep, unblocked — plan

Feature: follow-ups sweep · Implements: none · Ticket: none
Target: main (the `ai` repo; paths below are under `wigley-ai-gui/` unless they start with `wigley-ai-gui/`) · Written: 2026-11-17

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Land every *agent-ready* follow-up in `docs/features/followups.md` that is still true on `main` and whose code no
running plan rewrites: 24 items in 17 groups, each a bug fix, a missing refusal, a test cleanup or a small shared
primitive. The plan runs headless: every decision is settled below or in its task document, and no task asks the user.
When the run closes, each landed item is gone from `followups.md`.

## Architecture

Systems touched, all inside `wigley-ai-gui`:

- **Chat page**: the activity run's step header (`src/plugins/chat/page/activity-runs.ts`).
- **Plugin loader and switch**: `src/main/plugin-catalog/user-folder-source.ts`, `src/main/plugins/plugin-switch.ts`,
  `src/renderer/renderer.ts`, `src/renderer/page-part-loader.ts`.
- **Drive and self-test tooling**: `scripts/drive.mts`, `src/main/drive/page-driver.ts`, two plugins' self-test scripts.
- **Page parts' stop refusals**: `docs-session-tab` and `session-stash` page parts.
- **Shared plan reading**: `src/shared/plan-copies.ts`.
- **Config push** in the page: `src/renderer/config-push.ts`.
- **Restored view state**: primer's state (`primer-state.ts`) and practice's workspace state (`workspace-state.ts`).
- **Unity pool runner**: `src/plugins/unity-pool/main/pool-cli.ts`.
- **Backlog view focus**: `src/plugins/backlog/page/backlog-view.ts`.
- **CSS and UI primitives**: the sessions default layout's CSS, the input frame, the Tag tone set, a new shared
  waveform primitive, the gallery and `DESIGN.md`.
- **Tests**: a sweep of test names, restated text and a dead test, and one shared JSON helper reused.

## Preconditions

Each was checked at plan time (2026-11-17, `main` at 9b671bd16). `wigley:make` re-runs them before the first dispatch.
Run the commands from the `ai` clone's root. A `\|` in a command is the table's escape for `|`.

| Claim | Command | Expected |
|---|---|---|
| No running branch changes a file this plan's tasks list | `for b in lane-h-harness-seams lane-e-extension-points chatroom scheduled-tasks-plan; do git diff --name-only main...$b -- wigley-ai-gui; done \| sort -u > /tmp/claude-502/running.txt` then, for each path in every task's Files line, `grep -cx "wigley-ai-gui/<path>" /tmp/claude-502/running.txt` | `0` for every path, except the shared files below. A branch that has merged into `main` drops out of the check. A new path that now appears means that branch moved into it: re-read the task against the branch before dispatch |
| The shared files hold disjoint hunks: 01's `src/plugins/chat/page/activity-runs.test.ts`, `layout.d.ts`, `layout.js`, `layout.test.ts` and `docs/features/agent-chat/design.md` (Lane H); 02's `src/main/main.ts` (Lane H, Lane E) and `AGENTS.md` (Lane H, scheduled-tasks); 03's `.agents/skills/drive/SKILL.md` (Lane H); 06's `src/plugins/workflow-large/main/plan-watch.ts` and `plan-watch.test.ts` (scheduled-tasks: its hunks sit at the imports, `PlanWatch`, `Watched` and `createPlanWatch`'s body from ≈141, and a test block at ≈439; 06 edits the `copyDeps` builder near ≈110 and adds its test in its own `describe`); 17's `docs/features/followups.md` and `AGENTS.md` (Lane H, scheduled-tasks: 17 edits by item title and by the groups' own doc lines, so it re-reads both files as they stand when it runs) | `git diff -U0 main...<branch> -- wigley-ai-gui/<path>` for each, against the lines and symbols the task names | no hunk of the branch touches a line or symbol the task edits. A hunk that does: when the branch has merged, re-read the task against `main`; when it has not, hold that task until it merges |
| The scheduled-tasks plan owns L70, L228, L610, L615, L812 and L839 of `followups.md` (its tasks 22–25); L353 stays with Lane P (`plan-lane-p-platform` tasks 04–05) | that plan's task documents in worktree `/Users/jonathonwigley/Documents/.worktrees/ai-scheduled-tasks` | no task in this plan edits those items |

Each task document adds the preconditions its own fix rests on (a symbol at a line, a missing rule).

## Docs written ahead

The follow-ups triage: `docs/features/followups.md` with fixed items deleted, stale text corrected and items needing a
decision retagged. It is committed on branch `followups-plans` with this plan (commit named in the Run log at
preflight). No other doc is written ahead. Each task updates the doc lines its own change makes untrue, and the doc
re-read task removes every landed item's entry from `followups.md` in one commit. Tasks do not edit `followups.md`
themselves, so the groups of one wave share no file.

## Mandatory Reads

- `AGENTS.md` (the wigley-ai-gui folder's), sections by task: § Architecture (the source tree, A registration, A
  disabled plugin, A slot, A layout), § Running and testing (the self-test and drive runs: filtered only), and
  `DESIGN.md` for tasks 12–15 (§ Primitives, § Tokens and themes).
- `wigley:codebase-design`, `wigley:writing-code`, `wigley:writing-tests` (TypeScript: `typescript-vitest.md`).
- No `CLAUDE*.md`, nested `AGENTS*.md` or `.claude/rules/` exist in the wigley-ai-gui folder.

## Design Overview

Each group is an independent fix with no shared contract, so there is no after-state flow beyond each task's GIVEN /
WHEN / THEN.

### Decisions (interview round 1, 2026-11-17; the user took the recommendation)

- **Scope.** The unblocked items are one plan. Items in code that Lane H, Lane E, Lane L, Lane P, Chatroom or the
  scheduled-tasks run rewrites go to `../plan-followups-after-lane-h/` (Lane H and scheduled-tasks) or stay with their
  lane. Items needing a design call or a repro were retagged *needs a feature plan* in the triage.
- **No contract edits that collide.** No task edits `src/contracts/files.ts` (the scheduled-tasks run does): task 02
  deletes old revisions through the Files members that already exist.
- **Follow-up removal happens once.** The doc re-read task (17) removes each landed item from `followups.md`.
- **New test titles are sentences** (`typescript-vitest.md` § Naming; settled while drafting). A task document that
  names a new test in the `subject_Case_Result` form gives its parts; the worker writes it as a sentence. Existing
  titles a task does not rename keep their form.
- **The `isStringArray` copy in `retro-queue.ts`** (L537) goes to `../plan-followups-after-lane-h/` task 17, which
  edits that file after Lane H lands; task 16 here takes the copies in files no running branch changes.

### Out of scope

The items left to running lanes, the post-Lane-H batch, the retagged items, and L575 (date-gated to 2027-02-06), as
listed in the triage.

## File Structure

No group produces anything another group consumes. New files:

- `src/plugins/session-stash/page/start.test.ts`: the part has no test file yet (task 05).
- `src/shared/page/ui/waveform.ts`, `waveform.css` and `waveform.test.ts`: the shared waveform primitive (task 15),
  promoted from audio-picker's kit.

Boundary rules: no task edits a line or symbol a running branch changes (Preconditions: the shared files are named
there, each with disjoint hunks, checked before dispatch), and no task edits `followups.md` except task 17.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 14 → 15 → 17.

### Wave 1
- [ ] [Restored step header shows no duration for an unknown time](01-restored-step-header.md)
- [ ] [Old plugin code revisions are pruned](02-plugin-revisions-pruned.md)
- [ ] [Drive quit waits on the host's end](03-drive-quit-waits.md)
- [ ] [Fit check passes split handle prompts](04-fit-check-split-handles.md)
- [ ] [Switch-off refuses while unsaved work is open](05-maystop-refusals.md)
- [ ] [A failing worktree list is logged](06-plan-copies-log.md)
- [ ] [Config applied is logged only on a change](07-config-applied-log.md)
- [ ] [Primer restores a review cursor in range](08-primer-review-cursor.md)
- [ ] [Practice keeps a draft saved during an open read](09-practice-draft-kept.md)
- [ ] [The pool runner survives a failed stat](10-pool-find-script.md)
- [ ] [Backlog review pane keeps a click](11-backlog-review-focus.md)
- [ ] [Sessions header holds at the side bar's least width](12-sessions-header-width.md)
- [ ] [One native-input reset in the input frame](13-input-frame-reset.md)
- [ ] [Tag gains the info tone](14-tag-info-tone.md)
- [ ] [Test cleanup sweep](16-test-cleanup.md)
- [ ] [A deferred page part waits on its withheld dependency](18-deferred-page-part.md)

### Wave 2
- [ ] [Shared waveform primitive](15-waveform-primitive.md) — after 14

### Wave 3
- [ ] [Doc re-read and follow-up removal](17-doc-re-read.md) — after every group
- [ ] [Final verification](19-final-verification.md)

## Run log

Review base:

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
