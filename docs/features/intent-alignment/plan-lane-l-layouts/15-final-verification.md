# 15 — Final verification

Status: not started
Type: Task
Wave: 9 · Depends on: 14
Plan: [plan.md](plan.md)

Files:     none modified (a check that fails reopens the task that owns it; its fix lands in that task's files)
Consumes:  the landed code of tasks 01–13 and the docs task 14 checked
Produces:  each check below run in the running app, its result and capture path in § Proof
Decisions: every runtime, visual and live check the plan defers lands here, and nowhere else · the agent runs each
           one itself through the `drive` skill (`.agents/skills/drive/SKILL.md`) or `npm run selftest -- --plugin
           <id>`, filtered to the plugins the lane touched; a whole `npm run selftest` runs only when the user asks
           for it in that turn · a dev drive run (`npm run drive -- start`) edits a `default` layout file in the
           worktree for a reload check and restores it after (`git -C <worktree> checkout -- <file>`); a user
           layout check writes its layout under the run's temp home · each check is tagged **expected** (the change
           doing what it was made to do) or **low** (low-confidence: a path no test reaches), with its reason

Before the checks: `npm run lint`, the typecheck and `npm test` pass on the landed tree; the command in plan.md
Precondition 2 prints `0`.

## Checks

Toasts (task 01):
- **expected** A toast shows at the bottom right: success and error carry a dot, info none; it fades in and is gone
  after about 4 s. Only the draw moved.
- **expected** In a dev drive run, change `.toast` padding in `src/renderer/shell/layouts/default/layout.css`: the
  next toast shows the new padding with no rebuild. The item's goal; only a live run reaches it.

Sessions picker (task 03):
- **expected** The Sessions split picker's `Show session` rows look as before: one label per row, New session last.
- **low** With the picker open, save a user sessions layout that defines `pickerRow`: the open rows redraw in it.
  Needs a layout file written while the picker stays open.

Style-only reload (task 05):
- **expected** Save only the `layout.css` of a shown user layout and of a live default (shell, sessions): the CSS
  applies; the log shows `layout <name> restyled (style revision <n>)` and no `shown (revision …)` line; a focused
  text box keeps focus, cursor and vim mode; no view redraws.
- **expected** Save that layout's `layout.js`: the log shows `shown (revision <n+1>)` and the stylesheet link's
  `href` is unchanged.
- **low** The missed-watch rescan sorts a CSS-only change into `styleRevision`. Hard to trigger on demand (a save
  while the watch is dropped); the registry test covers the sort. Try it by pausing the watch if the drive offers a
  way; otherwise record it untried with that reason.

Dialog frames (tasks 04, 07, 11):
- **expected** Each dialog looks as before under `default` (capture each and compare against `DESIGN.md`'s **Dialog** primitive):
  chat sign-in, deny and end-session; docs path box and Trash; sessions rename; notes Note and discard; practice
  import and Solution confirm; backlog delete and discard; keys help; session-stash; primer cancel; the gallery
  Dialog sample; forms cancel round.
- **expected** Edit a `default` `dialogFrame` while a dialog with a focused plain input is open (sessions rename,
  session-stash, practice import, docs path box): the dialog redraws and keeps the input's text and focus.
- **low** The same edit with chat's CodeMirror boxes open (deny reason, sign-in): text and focus stay. Rests on
  `editor.focus()` after the move.
- **low** Keys help's Close shows its key hint, the hint follows a rebind of `keys.closeHelp`, and the button
  closes help. Where the hint sits inside the button is new.
- **expected** The keys help dialog is still wide after its width rule moved to keys' default `layout.css`.
- **expected** In notes, reload a layout while the markup view shows: the actions row stays hidden.
- **expected** The forms cancel dialog redraws after a `forms.layout` change, and only the setting picks it.

Fixed texts (task 08):
- **expected** Each owner's cursor row shows its prompt keys in the same place and look as before (backlog, docs,
  settings and its Leader menu, notes, sessions, chat's resume picker), and the hints hide out of their scope.
- **low** No `[keys] unplaced` line. An action is now drawn only on a row that shows it: settings' key-row
  actions, backlog's follow-up actions, docs' `toggleStar` in All pages, sessions' up and down on a favorite
  project's row, the Leader menu's item actions. Run `npm run selftest -- --plugin <id>` for backlog, docs,
  settings, notes, sessions and chat, and name in § Proof the step that reaches each action. A whole self-test run
  needs the user's ask; without it, record which actions the filtered runs reached.
- **expected** Docs' status line updates during a rescan while the filter box keeps focus and its text; backlog's
  "No features homes found" shows and hides.
- **expected** A settings box's refused-write message shows under the box and stays after a `layout.js` save while
  the box is open.
- **low** In notes, Tab between the title and body boxes keeps typing focus while the prompt moves. The unit test
  sees only the fake DOM's focus.

Primer chrome (task 09):
- **expected** The primer column heads, the tasks foot (Review with its key stack), the card edge strip and the
  review footer look and anchor as now.
- **expected** The primer row prompt shows only on the selected row and hides while its column is inactive.
- **expected** Saving a `.primer-column-head` change in the primer default's `layout.css` restyles it live, with no
  redraw.
- **low** The Review label stays whole in a narrow tasks column. Its rules moved to the default's stylesheet,
  which loads after page CSS, so the cascade order changed.

Kept boxes (tasks 06, 10, 13):
- **expected** Insert mode, cursor and undo survive a `layout.js` save in a forms box, a primer box, the backlog
  follow-up editor and practice notes; focus returns to the box after the redraw.
- **low** Vim visual mode and its selection survive the same save in a forms or primer box. Whether
  `@replit/codemirror-vim` leaves visual mode on blur is outside this repo's code.
- **low** The primer's add-item box after an item lands, and after a pick change: the text shown is the one the
  user expects (empty after a landed item). A kept editor ignores the text `place` hands it, so a box that used to
  remount empty may now keep old text. A fail reopens task 10.

Forms chrome and part redraw (tasks 12, 13):
- **expected** The forms rail head, Review foot and item pager look as now; the save state reads `Sending…` while
  a round sends.
- **low** The forms rail still scrolls between head and foot in a short window. A new
  `:not(.rail-head-slot, .rail-foot-slot)` grid rule replaces the old one.
- **expected** A code save that changes one card's layout redraws only that card; the main column's scroll and the
  rail's selected entry stay.
- **expected** A `layout.css`-only save of a forms layout restyles with no redraw, and the focused box keeps focus.

Tests:     none new: each check is a live run
Done when: every check above ran, each with its result and capture path in § Proof, or is recorded untried with its
           reason; each fail reopened its owning task and passes on the re-run
Commit:    none (no file changes); the run log in plan.md records the outcome

## Proof
