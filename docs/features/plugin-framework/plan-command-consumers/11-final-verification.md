# 11 — Final verification

Status: in progress
Type: Task
Wave: 8 · Depends on: 10
Plan: [plan.md](plan.md)

Files: none changed, unless a check finds a bug. A fix goes through `wigley:make`'s fix path.

Consumes: tasks 01-10 landed; `.agents/skills/drive/SKILL.md`, read whole before the first command.

Produces: a report: each check below passed or failed, with its evidence (a log line, a query result or a screenshot name).

Decisions:

- This task holds only what `wigley:writing-tests` § What earns a live run instead admits. A GIVEN/WHEN/THEN a test pins earns no live check.
- Run the drive checks in one `drive` run. Reload with `eval` of `location.reload()`, then `ready`, whose `load` number must rise.
- Self-test: filtered runs only, naming each touched plugin with a script: `forms`, `primer`, `chat`, `sessions`, `agent-strip`, `agent-lines`, `agent-skills`, `usage`, `settings`, `docs`, `notes`, `backlog`, `workflow`, `workflow-heavy`, `workflow-light`, `workflow-medium`, `unity-pool` (`visual` and `keys` have no `main/selftest-script.ts`; measured at plan time, re-verify). The whole self-test runs only when the user asks in the current turn, since a run takes half an hour or more.
- The agent launches no browser. Drive runs the app itself through its own tooling.
- A failing check in a path with a plan-time fallback is named below. Other failures go to `wigley:make`'s fix path.
- **Fallback for check 1:** if main does not hold a flushed draft, report it as a concern and ask the user. The recommended fix is writing each form's body to its place slot on each change, since a slot write leaves before `pagehide`.

## Drive checks

Tag: **expected** is the change doing what it was made to do; **low-confidence** is where a bug is likely.

1. **low-confidence** — a write during `pagehide` reaches main. Reason: the tree cannot show it, and no unit test reaches a real navigation. Open a form with the `forms.openRound` drive action. Set `forms.autosaveDelayMs` to 60000 in the drive run's config, so no timer saves first. Type a unique string in a box. Reload at once. Assert the box holds the string after `ready`. Repeat for primer and for the note popup's body.
2. **expected** — chat keeps work. Type a draft, attach an image, move the entry cursor, open a run. Reload. Assert the box text, the attachment row, the cursor mark and the open run by `query`. Reason: restoring into a real editor and entry list crosses wiring no unit sees.
3. **low-confidence** — restored rounds and tabs. Reason: a late Form tab, a saved take over and the rows snapshot meet only in the running app.
   - Open a round, select Chat, reload: Chat stays selected.
   - Stay on the Form tab, reload, submit: the tab selected before the round shows.
   - After a reload, open a new round: it takes over.
4. **expected** — forms' place. Open review on a row, reload: review and that row show. Open the review's Cancel prompt, reload: it shows, confirming cancels the round, and the session stays.
5. **low-confidence** — docs' unsaved edits. Edit a doc in the Docs tab and in Docs mode, reload, assert each editor's text, and that `<D-w>` refuses with the unsaved toast. Change the file on disk during a reload: the changed-on-disk prompt shows. Reason: the editor opens asynchronously after the index read.
6. **expected** — notes, backlog and settings. Set each one's place, reload, assert by `query`. Reason: each restore runs against a real first draw.
7. **low-confidence** — session ended during a reload. Start a row with `do sessions.open '{"sessionId":"reload-end"}'`. Type a filter in its Docs tab. Run `eval` of the reload, then `do sessions.end '{"sessionId":"reload-end"}'` at once, then `ready`. Run the same `sessions.open` again, and assert by `query` that its Docs tab's filter is empty. The check does not depend on the timing: a row ended before the page's snapshot goes by the prune, and a row ended after it goes by `followRows` `removed`. Reason: a delete that lands between the snapshot and the `core.pageReady` subscribe is a race only the real page load has. `row_gone_during_reload_is_pruned` pins the prune itself.
8. **expected** — close seams with `<D-w>`.
   - Open round: no confirm, the round ends cancelled, and the row goes.
   - Busy chat session with an open round: no confirm, and the process ends.
   - Busy chat session with no round: chat's confirm shows.
   - Open round and unsaved docs edits: docs' toast shows, and the round stays.

   Reason: the order of tabs and main's reply is wiring.
9. **expected** — clicks a test cannot see. Click these with drive's real mouse, and assert each one's log line or `onDidRun`:
   - a chip's main action on a session that is not selected, and the selection stays
   - the strip's secondary action
   - the side pane's finished-waves fold
   - a kit button in each swept plugin's default layout: forms' review, primer's review, chat's composer, agent-strip, visual, keys' help, shell chrome, docs' tree header, notes' popup, backlog's row, settings' row, unity-pool's row
   - an activity item in the shell's activity bar, since `renderer.ts` has no test file and only a click proves the shell literal's `argShape` and `run`
   - a click in the row or tab's `stopPropagation` zones, which must not also activate the row

   Reason: event order and focus between a real press and a command are what a test's direct call skips.
10. **expected** — default look. Take `screenshot`s of each swept plugin's default view and a session row, and compare by eye with `main`'s: no text, spacing or order moved. Hover a row with an open round: its tooltip holds the status. Reason: correctness here is a judgement on screen.
11. **expected** — Settings, help. Open Settings' keys rows and which-key help. Assert no `workflow.stageAction` or other declared-arg row shows without a bind, and each row shows once per bound arg. Reason: the merged catalog is live-served.

## Filtered self-test

**expected** — run once per touched plugin, as listed above. Reason: each script's `expect` lines cross processes with the real page. A line that fails is a bug or a stale `expect`; report which.

## For the user's wrap-up

List these in the final reply only, with their steps. They need the user's hands:

- A real keyboard: `Cmd+W` on an open round (no confirm, the row goes) and on a busy chat session with no round (chat's confirm shows); `Space ;` and `<Leader>;`; `<Leader>ww`, `wn`, `wr`, `wo`, `wt` and `wd`.
- A native file drop or paste of an image into chat, then `Cmd+R`, to check the image returns.
- Page reload by the app's own menu or `Cmd+R`, typing right up to the key press in a form box.

Done when: each check above reports passed, or failed with a named fix or concern; the filtered self-tests ran; the wrap-up list is in the report.
Commit: none, unless a fix lands through the fix path.

## Proof
