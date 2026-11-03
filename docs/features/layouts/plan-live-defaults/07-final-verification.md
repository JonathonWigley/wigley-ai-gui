# 07 — Final verification: live defaults in the running app

Status: done
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05, 06
Plan: [plan.md](plan.md)

Files:     none in the repo. Captures go in each drive run's `screenshots/`. Every edit to a default in the repo is
           reverted before this task ends: `git status` shows no change under `src/` when it is done.
Consumes:  everything tasks 01–06 land
Produces:  a report of each check below: pass or fail, with the screenshot paths and log lines that settle it

Decisions:
- Live checks only, per `wigley:writing-tests` § What earns a live run instead. Each check is tagged expected or
  low-confidence, with its reason. A rule a unit test of tasks 01–04 already pins is not checked here.
- Use the drive run (`.agents/skills/drive/SKILL.md`; `npm run drive -- help` is the source of truth for commands).
  A drive run's app is the dev app or a local package. Either one reads each default from the repo it runs from,
  because the build's `WIGLEY_CLONE_DIR` falls back to that repo (task 04).
- **Run every check on a dev drive run** (`npm run drive -- start`). Task 04 stops the Vite dev server watching
  `layouts/default/`, so a save there redraws only through the live path, as in the stable app. A page load line
  between a save and its redraw means the Vite watch still sees the folder: report it as a finding.
- The proof that the live path drew is the page log line `layout default shown (revision <n>)` under the owner's
  source, with n above the start revision, and no page load line between the save and the redraw. Read it with
  `wait-log` or from the run's `app.log`.
- Pick one plugin owner whose default draws plain text on a surface the run reaches at once (the shell's title bar
  context, or the keys plugin's title-bar Keys button), and also the shell itself.
- Make each edit with a small, marked change (a text suffix in `layout.js`, an `outline` rule in `layout.css`), and
  revert it with `git checkout -- <path>` when its check is done.
- `install-app` is not run here: it quits and replaces the user's stable app.

Checks:

1. **Expected — a saved `layout.js` redraws.** Edit the chosen owner's
   `src/plugins/<id>/layouts/default/layout.js` (and, as a second case, `src/renderer/shell/layouts/default/layout.js`)
   in the repo. GIVEN the run is up WHEN the file is saved THEN the owner's surface shows the change with no page
   load, and the log shows `layout default shown (revision <n>)` for that owner, n above its start revision. Reason: the change's purpose.
2. **Expected — a saved `layout.css` redraws.** Add an `outline` rule under the owner's
   `[data-layout-owner='<id>'][data-layout='default']` root in its `layouts/default/layout.css`. GIVEN the run is up
   WHEN the file is saved THEN the outline shows; settle it with `query` on the element's computed `outline`.
   Reason: the change's purpose.
3. **Low-confidence — a rule deleted live is gone.** Delete one rule that task 05 moved into the owner's
   `layout.css` (a colour or a gap on a drawn element). GIVEN the run is up WHEN the file is saved THEN `query`
   shows the element's computed value no longer holds the deleted rule's value, and `query` on
   `link[data-layout='default'][data-layout-owner='<id>']` shows one link whose href is the live
   `wigley-layout://<id>/default/~<n>/layout.css`. Reason: the swap from the bundled link to the live link has no
   test over the real page's cascade, and a copy of the rule left in the page bundle would hide the delete.
4. **Low-confidence — a broken live default falls back with the toast.** GIVEN the run is up:
   - WHEN `layout.js` gets a syntax error THEN a toast `Layout default failed: …` shows, and the surface keeps the
     last good look (check 1's change).
   - WHEN the file is reverted to the committed default and one part's key is then deleted THEN a toast
     `Layout default failed: layout default has no <part>` shows, and the surface draws.
   - WHEN one part is made to throw (its body's first line `throw new Error('live check')`) THEN the log shows
     `layout default <part> failed: live check` once, and the bundled part draws in its place.
   - WHEN the file is reverted THEN the live default draws again, at a revision above every earlier one.
   Reason: the fallback crosses the registry, the scheme, the loader and `drawPart` in the real page; each unit test
   covers one of them.
5. **Low-confidence — the default look did not move with the CSS.** A screenshot sweep of each owner's surfaces,
   compared with the look before this plan. Moving each default's CSS from the page bundle to a linked file changes
   its place in the cascade, and the eye catches a changed colour, gap or rule order that no test sees. Reason:
   wiring and layout a test cannot see.
   - **Before captures:** the baseline captures preflight took (plan.md § Preconditions, last item), at the review
     base, before any task landed.
   - **After captures:** a dev drive run in the repo, with no default edited, following the baseline steps.
   - Both runs use the same width, theme and steps. Capture, by owner (`docs/features/layouts/design.md`
     § Adopters): the shell chrome (title bar, activity bar, side bar, status bar); forms (`Space z l o`); primer
     (`Space z l p`); chat with its activity dock and the agent strip (`Space z l c`); sessions (`Space z l s`);
     agent-lines (`Space z l a`, with `agent-lines` removed from `plugins.disabled` in the run's settings);
     workflow (`Space z l w`); gallery mode; settings; docs; backlog; notes; keys (the help overlay and the which-key
     panel); usage (the status-bar line and the right-bar details); visual (an html block in the chat preview).
     Find each mode's key with `npm run drive -- actions` and the keymap.
   - Read each pair side by side. Any difference is a finding: name the owner, the element and the rule.

6. **Low-confidence — the self-test still passes.** Run `npm run selftest`. Each owner now logs a live
   `layout default shown` line at start and redraws once when its live default replaces the bundled one, and a step
   that waits for an exact log line can break on that. GIVEN tasks 01–06 landed WHEN the self-test runs THEN it
   prints `all passed`; a failure is fixed in the task that caused it. Reason: no unit test runs the self-test's log
   waits.

Done when: every check above passes or is reported as a finding with its captures, every default edit is reverted,
and each drive run is quit (`npm run drive -- quit`).
Commit:    none; this task changes no file.

## Decisions from the cold plan read

These close gaps a cold reader found. Each binds as the Decisions above do.

- **No page load.** Read `ready`'s `load` number before each edit and after its redraw; it must be unchanged. The app
  logs no "page load" line.
- **Log order.** Start `wait-log` in the background before the edit, or count the `layout default shown (revision n)`
  lines in `app.log` before and after, since `wait-log` matches only lines logged after it starts.
- **Check 4** makes its own marked edit first (the same suffix as check 1) and keeps it until the syntax-error step
  is read.
- **Check 5 steps.** Preflight writes the exact drive commands it ran for the baseline (seed actions, keys, width,
  theme, `screenshot <name>` per owner) into the Run log. This task replays that list verbatim for the after
  captures.
- **Check 6** runs `npm run selftest -- --plugin <owner>` for each owner that has a self-test script, not the whole
  self-test: `AGENTS.md` keeps the whole run for when the user asks. Record the list run.
- **7. Expected — the build bakes in the clone path.** Run `WIGLEY_CLONE_DIR=<an absolute scratch folder> npm run
  package`, and grep the packaged main bundle for that path; then `npm run package` with no variable, and grep for
  the repo's path. In the packaged renderer bundle, every default `layout.css` is its own file, and no
  `data:text/css` URL appears. Reason: `install-app`'s override is the one stable-app piece no other check reaches, and it also
  proves forge keeps the user `define`.
- **The missing-clone fallback** is covered by task 04's `resolveCloneDir` test and task 01's registry tests; it
  earns no live check.

## Proof

Commit 246bfbdb · proof: live checks on a dev drive run (report /tmp/claude-live-defaults/reports/07-1.md): 1 pass (keys and shell layout.js redraw, revision 2, load unchanged); 2 pass (outline rgb(255,0,0) at revision 3); 3 pass (deleted .keys-title-bar-button rule gone, one live link ~4); 4 pass (syntax-error and missing-part toasts, throwing part logged once and bundled part drawn, revert at revision 13); 5 pass (backlog, docs, gallery, notes, settings pixel-identical; rest differ only by caret, pulse dot, elapsed text; Agents meter gap traced to replay seed order); 6: 10 of 12 self-tests pass, chat and primer fail but both fail the same at the review base; 7 pass (package bakes the WIGLEY_CLONE_DIR or worktree path, 16 separate layout css files, no data:text/css); every default edit reverted · concerns: not compared in check 5: .config-problem-badge and the sessions row hover, neither shown by the replay; the notes markup toolbar was read with query, not on screen
