# 06 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04
Plan: [plan.md](plan.md)

Files:     no repo file · outside the repo, only on the user's yes: delete `~/.config/wigley-ai-gui/layouts/primer/columns/`
           · modify `~/.config/wigley-ai-gui/settings.json`
Consumes:  the landed code of 01–04
Produces:  no code
Decisions: checks run through the repo's own tooling, the self-test and the drive run (`AGENTS.md` § Running and
           testing) · a check only a real keyboard or the user's eyes can settle goes to the wrap-up · the stopgap
           removal is a per-run ask (round 2; `~/wigley-agents/AGENTS.md` § Hard gates)

## Rules for this task

- Load the `drive` skill (`.agents/skills/drive/SKILL.md`) before the first drive command.
- Start the drive run without `--user-config`. The user's config holds the stopgap `columns` primer layout, and it
  would hide the real columns. Use the temp home's empty config.
- Pass `--run <id>` on every drive command, because a peer may start another run.
- A check that fails is a finding. Report it with its screenshot or query output. Do not fix code in this task.
- Each check below has a tag. **Expected**: the change does what it was made to do, on screen. **Low-confidence**:
  wiring or layout no test sees. A claim a test from 01–04 already pins is not on this list.
- Quit the run (`npm run drive -- quit --run <id>`) when the checks are done.

## Setup

1. `npm run drive -- start --run pane-resize`, then `resize 1400 900`. The default window is 900px wide
   (`src/config/settings.ts`), where the primer columns already stack; 1400 × 900 is the **start width** every
   check below returns to.
2. Seed: `sessions.open '{"sessionId":"s"}'`, then `forms.openRound '{"sessionId":"s"}'` and
   `primer.openPrimer '{"sessionId":"s"}'`, then `docs.seed` and `docs.connectSession` for session `s`. Run
   `npm run drive -- actions` first and use the argument shapes it prints.
3. Find each handle's selector with `query` before the checks: the split handle class from
   `src/shared/page/ui/split.css` and the side bar handle class from `src/renderer/shell/shell.css` (02). Scope
   each selector to the visible pane (`… :not([hidden]) …`).

## Checks

Measure each width with `query <pane selector>` (the box width) before and after the action. A keyboard step
moves a width by 24px unless a least width stops it.

| # | Check | Tag and reason |
| --- | --- | --- |
| 1 | Drag: `drag <handle> 48 0` on the forms rail split and on the side bar handle. Each start pane grows by 48px. Drag each far right (`drag <handle> 2000 0`): each stops where its end pane is at its least width (forms card 224, side bar main 320). Drag far left: each stops at its start pane's least width (forms rail 160, side bar 160). | Expected: the drag moved into the shared divider core, and the side bar handle is new. Low-confidence for the side bar: its handle sits over the shell grid, and no test sees its hit area. |
| 2 | Keys in each view: press `<A-S-l>`, then `<A-S-h>`, and read the width that the plan's rule names. Forms Form tab (rail split); Forms review view (rail split); Backlog with focus in the list (list split); Backlog with focus in the homes (side bar); a session's Docs tab (tree split); Docs mode (side bar); Gallery mode (the `Split` sample); a Chat tab (side bar); Primer with tasks focused (outer split), items focused (inner split), card focused (inner split). | Low-confidence: each view's target rule reaches the right split only on screen, and the docs and gallery wiring has no test (task 04). The bind → command chain is pinned by 02's self-test step. |
| 3 | Stale target: show Gallery mode, then show a Chat tab, and press `<A-S-l>`. The side bar moves; the gallery sample does not. Return to Gallery and press `<A-S-l>`: the sample moves. | Low-confidence: the drop on a base scope change is wired in `renderer.ts`, which no test covers. |
| 4 | Gallery redraw: in Gallery mode, make a new layout set reach the gallery: `setting layout '"none"' --plugin gallery`, then `setting layout '"default"' --plugin gallery`. Confirm in `log` that the gallery's layouts were shown again: a `[gallery] layout default shown (revision …)` line after the setting change (`src/shared/page/layout-host/show-layouts.ts`); if no such line shows, record the check as not reached. Then press `<A-S-l>`. The new sample moves. | Low-confidence: the target is set again after a redraw (task 04), with no test. |
| 5 | Prompt `⌥⇧H ◂ ▸ ⌥⇧L`: (a) `click <handle>` leaves the pointer over the handle with no button held, a hover; screenshot shows the prompt centred on the handle. (b) `drag <handle> 24 0 --hold`; screenshot shows it; `release`. (c) Press `<A-S-l>` and take a screenshot at once: the prompt shows; after the short moment it is gone. For each, `query` the panes' widths with and without the prompt: they are equal, so the prompt keeps no layout space. Do this on one split and on the side bar handle. | Expected: a visual result. |
| 6 | Rebind without a rebuild: write the temp home's `keymap.json` (in the run folder's `home/`, at the path the user config takes there) with one bind for `panes.resizePaneLeft` on `<A-S-y>` in scope `any`, in the entry shape `docs/keymap.md` § Where keys live gives. Wait for the keymap reload line in `log`. Press `<A-S-y>`: the focused pane's divider moves left. The prompt now shows the user's key first. | Low-confidence: a core page command in the user keymap is new in 02. |
| 7 | Primer columns: at the start width, screenshot the Primer tab with a task selected. It shows three columns — tasks, items and card — with the headers 03's decisions name, each column wide enough to read its rows. | Expected: the layout is visual. The key walk and empty-state copy are pinned by 03's tests and self-test (check 10). |
| 8 | Narrow window: first nudge or drag the side bar back to its `sidebar-width` token width and read it with `query`, since checks 1–6 moved it. Then `resize 900 800` with the Primer tab showing and the side bar beside it. `query` shows `is-stacked` on the outer split (`.primer-form`) and on the inner split before any key. Press `<A-S-l>`: no width changes, and the run's ui-state file is unchanged. Run `fit` at that width: nothing is cut off. Resize back to the start width. | Expected: a layout result the plan accepts (round 4). |
| 9 | Restart: after checks 1–2 changed the widths, record the side bar, primer tasks and primer items widths. `npm run drive -- restart --run pane-resize`, `resize 1400 900` again, open the Primer tab, and read the widths. They are equal to the recorded ones. | Low-confidence: `renderer.ts` hands the shell its scoped uiState with no test, and the new keys must survive the ui-state file round trip. |
| 10 | Self-test: `npm run selftest` exits 0, and its output has no line that contains `[keys] unplaced`. | Expected: the primer self-test steps (03) and the prompt anchors (01, 02) pass together. |
| 11 | Side bar on a narrowing window: with the side bar beside and the Chat tab showing, widen the side bar to 400px (`<A-S-l>` presses or a drag), and record the stored `shell.side-bar-width` in the run's ui-state file. `resize` the window narrower step by step until the main area would be under 320px: at each step `query` the main area's width, which stays at least 320px, while the side bar narrows. The ui-state file still holds the recorded width. `resize` back to the start width: the side bar is 400px again. | Expected: the user's ruling that the main area never sits below its least width. Low-confidence: the root's `ResizeObserver` path (02) has a fake-observer test only. |

## Checks for the user

The agent does not wait on these. List them in the wrap-up with their steps:

- In a visible `npm start` on macOS, press Option+Shift+H and Option+Shift+L with a real keyboard, in a Form tab
  and inside a text box. The divider moves, and the box types no character. Synthetic keys never meet the OS
  keyboard layout (`AGENTS.md` § Running and testing).
- Hold Option+Shift+L: key repeat moves the divider at a speed that feels right.
- Drag the side bar's edge with a real mouse or trackpad: the cursor changes over the handle, and the drag follows
  the pointer.

## Stopgap removal — per-run ask

Run this step only after checks 1–11 pass. It edits the user's config outside the repo, so it is a per-run ask
(`~/wigley-agents/AGENTS.md` § Hard gates). Stop and ask the user. Ask in a one-line chat message and in a
`wigley-forms` round, with the recommendation "yes".

Why the run needs it: the stopgap `columns` layout stands in for the real columns. After this plan lands, it draws
the primer's old `rail` part, which the contract no longer has (plan.md § Decisions, Primer layout contract), so
it breaks the user's Primer tab. Tell the user that the installed stable app keeps the old code until
`npm run install-app` installs a build with this run; until then, it shows the default rail.

The change, on the user's yes:

1. Copy `~/.config/wigley-ai-gui/layouts/primer/columns/` and `~/.config/wigley-ai-gui/settings.json` into the
   session scratchpad, so the user can restore them. Name the copies' paths in the report.
2. Delete `~/.config/wigley-ai-gui/layouts/primer/columns/`. Keep `~/.config/wigley-ai-gui/layouts/primer/layout.d.ts`:
   it is not part of the stopgap.
3. In `~/.config/wigley-ai-gui/settings.json`, remove the `"primer"` entry. Its only member is
   `"layout": "columns"`. Keep every other entry, and keep the file valid JSON.
4. Report each path removed or changed.

On the user's no, change nothing, and list the stopgap in the report as still in place.

## Done when

Checks 1–11 pass or each failure is reported as a finding. The user's checks are in the wrap-up. The stopgap is
removed on the user's yes, or reported as in place.

## Commit

No commit: this task changes no repo file.

## Proof

