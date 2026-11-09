# wigley-ai-gui follow-ups

Every open follow-up for this app, in priority order: the sections run from the work most later work builds on down
to cleanup, and items inside a section run highest first. A seam many features use outranks a feature nothing builds
on, and a bug seen in use outranks a defect with no path to the user today. The sections, in order: Foundations, Bugs
seen in use, Harness seams, Platform and packaging, Plugin extension points, Features, Code cleanup, Latent defects
and tests.

A new item joins the section that matches it, below the items it builds on. Remove an item when its work lands.
*agent-ready* marks an item an implementer can take as it stands; *needs a feature plan* marks one with a design
decision left, to plan with `wigley:feature`. This file stays list-shaped (no `**Contents**` line and no `###`
headings): the Backlog plugin reads it as one follow-up per top-level list item.

## Foundations

Core seams that most items below assume.

- **Visual reads chat's focused entry through a slot** — *agent-ready*: `ChatPageExports.focusedEntry` and
  `focusedBlock` hand visual an `HTMLElement`, which a plugin from a user folder cannot read across a reload. Publish
  the focused entry's id and the cursor's block as a page slot in chat's `contract.ts`, and let visual find the
  element from it. Left over from the plugin state registry, which landed without it.
- **A restart leaves a page part's keys with no handler** — *agent-ready*: a restart stops a plugin's page part and
  starts it again, and the part's binds stay in the keymap between the two, so a key pressed in that gap runs a command
  with no handler. Take the binds out at the page stop and put them back at the page start, as the switch-off does
  through the served config. The restart is drive-only today, so the gap shows when the loader's reload makes it a user
  action.
- **A page part started live gets no restore window** — *needs a feature plan*: restores stay per page load, so a page
  part that a restart or switch-on starts live restores nothing (its slots were cleared on a switch-off, and a restart
  is drive-only). Re-arm restores per live start when a user-run reload makes a part restart with state to return.
  The same gap shows on a live restart of sessions or chat: the page parts' `ready()` prunes places (`sessions.place`,
  `chat.place` and its drafts, `docs.place`) before chat's async restore reopens the rows, so the prune drops the places
  of rows not yet reopened. A restart of sessions also leaves the app in Gallery mode, because the re-added Sessions mode
  is added hidden. The root cause is that `ready()` cannot tell a page load from a live start. Options: give `ready` a
  context saying which, or hold the prune until the restore settles.
- **A throwing `ready` is silent in the part harness** — *agent-ready*: the host logs `ready of <id> failed: <error>`
  under `plugin-host`, not under the plugin's id, and the part harness's host has no log, so a test whose `ready` throws
  passes in silence. Give the harness host a log, and log under the plugin's id.
- **Picker ranks recent targets higher** — *needs a feature plan*: every list picker ranks with the `FuzzyMatcher` page
  service, and a row's name outranks its path, so `gui` in the Notes target picker puts `wigley-ai-gui` first. What
  remains is recency: a recently updated target ranks higher. `NoteHome` has no updated time, and "updated" still needs
  a definition (for example the home's latest commit).
- **Reload keeps an open markup session** — *needs a feature plan*: a page reload returns notes and forms on their
  fields, but an open markup session in either is gone. It needs a restore path
  into the live overlay.
- **Reload keeps box focus and vim insert mode** — *needs a feature plan*: a page reload does not return focus to the
  box that held it, nor insert mode, because a box's key scope comes from `shown` today.
- **Reload keeps a Settings row's open edit box** — *needs a feature plan*: after a page reload Settings returns the
  cursor and the filter, but a row's open edit box closes and the text typed in it goes.
- **A page reload comes back in Sessions mode**: the shown mode (Docs, Settings, Backlog) has no page slot, so a reload
  shows Sessions whichever mode the user was in.
- **Chat's confirmed close keeps its press's `atOnce`**: the end-session confirm (`mayClose` in
  `src/plugins/chat/page/chat-view.ts`) answers the close it was asked in, and that close goes on with the `atOnce` its
  press read, so a round opened while the confirm shows still waits on the guard. `plugin-framework/design.md` words the
  close key's act as plain here; whether the confirm should re-read `closesAtOnce` is the user's call.
- **Preview sessions lose their title-bar detail**: the Layout and Primer previews carry `projectDir: null`, so
  `publishFocused` in `sessions/page/start.ts` sets the title bar's detail line to null. The line repeated the name
  when the previews had a path, and no replacement detail was chosen.
- **A marked row's toast text is frozen at its first mark**: while a row stays marked, `mark` in
  `sessions/main/session-list.ts` keeps the first mark's `options` as its `markToast`, so a second mark before the row
  is selected or unmarked does not change the toast text; a mark on an unmarked row replaces it.
- **`workflow.stageAction`'s `onDidRun` listeners hear a rejected action too**: `runFor` in
  `workflow/page/workflow-view.ts` catches a failed `runAction`, logs and toasts it, and resolves, so the command ends
  with no failure and `onDidRun` fires for it, as for "nothing to run" and a preview's skipped run. A listener cannot
  tell a run that did its work from one that did not.
- **Page state survives an app restart** — *needs a feature plan*: the page `*.place` slots live in main's memory, so
  an app restart loses chat's draft, forms' place and the rest.
- **A second page reload loses a session's selected tab** — *needs a feature plan*: a tab added late, after the
  session's first tabs, takes its selection back from the saved place only if nothing selected since the load
  (`tabsAfterRestoredAdd`). A second reload before that tab is added saves the place with the tab the first reload
  left selected, so the late tab's selection is gone.
- **Docs keeps only the first tree view's place** — *agent-ready*: a docs view's place holds one tree's expanded
  ids, selection and filter, the view a new tree shows first (the wiki with `hasWiki`, else All pages)
  (`page/tree-view.ts`, `place` and `restorePlace`). The other tree view starts over on a page reload. Keep a place
  per tree view.
- **The primer self-test fails one step on its own** — *agent-ready*: run alone, the primer self-test fails the step
  that expects `[sessions] activated Layout preview` after a send (`src/plugins/primer/main/selftest-script.ts`),
  because the Layout preview session it falls back to is opened by forms' script. It passes as `forms,primer`. Open
  that session in the primer script, or drop the expectation when forms did not run.

## Bugs seen in use

Defects seen in a drive run, a transcript or the user's own use.

- **Chat sessions get forms' 240 s deadline, not the relay's 300 s** — *agent-ready*: in a session the app's chat
  started, a round's draft comes back every 240 s (forms' `deadlineSeconds` default), though the wigley plugin entry
  sets `WIGLEY_FORMS_DEADLINE_SECONDS` to `300` and `relay.py` sends it in its hello. Cause: chat opens the row with
  no host record (`src/plugins/chat/main/chat-sessions.ts`, `sessions.open`), and `connect` joining that owned row
  (`src/plugins/sessions/main/session-list.ts`, `join`) keeps the row's info and drops the hello's host fields, among
  them `deadline_seconds` (`HOST_DEADLINE_FIELD`, which the form service reads from `info.host`). Fix: a join takes the
  hello's host fields into the owned session's `info.host`, as the host id is kept; check that the form service, which
  reads it once per session in `startSession` (`src/shared/agent-forms/form-service.ts`), starts after the join. Add a
  row to the session-list join tests: GIVEN an owned row opened with no host record WHEN a relay joins with a
  `deadline_seconds` of 300 THEN the session's `info.host` holds 300.
- **A restored chat's first step header reads hundreds of thousands of hours** — *agent-ready*: after an app restart
  restored a session (seen live, and in a drive run after `restart`), an entry header read `1 step · 498246h 44m`
  (about 56.8 years), a run whose `startedAt` is 0. Cause: `transcriptEntries`
  (`src/main/claude-code/transcripts.ts`, `let lastAt = 0` at line 127, a second copy at 151) stamps every entry
  before the transcript's first timestamped line with `at` 0, raw entries from unparsed or untimed lines included,
  and those are steps; `listRows` (`src/plugins/chat/page/activity-runs.ts:60`, `startedAt: previousAt ?? steps[0].at`)
  opens a run at 0 and closes it at the next timed entry. Two fixes: backfill the untimed leading lines with the first
  later timestamp in `transcripts.ts`, or have `listRows` treat `at` 0 as unknown and draw no duration. Default: the
  backfill, unless an existing test pins `0` for those entries; then say so in the report and take the `listRows`
  fix. Source session: Claude Code 76f5a6f5-89a8-4d05-a525-af23402d29ad in wigley-ai-gui.
- **Chat self-test fails the minimum-width fit on the session tab bar** — *agent-ready*:
  `npm run selftest -- --plugin chat` fails 8 steps with `<keys> fits the minimum width: nav.ui-tabs.session-tabs
  holds 120px in 99px` (groups: permission round Cmd+Enter, transcript focus Enter twice, controls e and Escape,
  interrupt and close three times). It fails the same on base 46f417b5, so it predates the usage change. The session
  tab bar (`.ui-tabs.session-tabs`, `src/plugins/sessions/page/sessions.css` near line 348, with the usage line from
  `usage-tab-line` in its tab line) does not fit at the minimum width. Find what grew it (check recent commits
  touching the sessions tab bar or the usage tab line, such as 4c8a2b0b and 4b7f175a) and make the bar fit or
  scroll. Source session: Claude Code 76f5a6f5-89a8-4d05-a525-af23402d29ad in wigley-ai-gui.
- **Window adapter misses page load 1** — *agent-ready*: the window adapter numbers page loads from 1 only because both
  `electronDrivenWindow` calls (`src/main/main.ts` `createWindow`, `src/main/selftest.ts` `startSelfTest`) run in the
  same synchronous pass that starts the first load (`src/main/window.ts` `loadURL`); an `await` added between them
  shifts every load number down by one, so dev starts hold the start lock the full 10 s instead of releasing on the
  startup reload. Create the adapter before the first load, or pass it into the window factory, so the count cannot
  miss load 1 (`src/main/drive/driven-window.ts` `navigationCount`).
- **Interrupt in the gap before a message's init** — *agent-ready*: `interruptAnswered` with no turn open
  (`src/main/claude-code/turn-tracker.ts`) also closes a message after its `queued`/`started` frame and before its
  `init` — e.g. Ctrl+C in `/compact`'s gap between `started` and `init` (`agent-chat/claude-stream.md` § Message
  lifecycle) — so the session shows idle and the turn-finished alert fires, then the init shows working again. Option:
  in lifecycle mode keep a uuid whose last state was `started` open through `interruptAnswered`.
- **Terminal resume of a cleared conversation** — *needs a feature plan*: after `/clear`, the sessions list refuses
  any relay hello carrying the row's pre-clear host id while the row lives (`retiredHostIds`,
  `src/plugins/sessions/main/session-list.ts` `connect`), which is meant for the old process's late relay. A user
  resuming the pre-clear conversation in a terminal (`claude --resume <old id>`) is refused too, so its forms and
  primer tool calls fail until the cleared row ends. Options: retire the id only until the old process ends, or give
  a hello after that a plain connected row. Source session: Claude Code b8ee3503-3c04-48fc-bd7d-bc4f2ec56c17 in
  wigley-ai-gui.
- **Concurrent resumes of one past session** — *agent-ready*: chat's `resume`
  (`src/plugins/chat/main/chat-sessions.ts`) checks whether a host session already has a row only before it awaits
  the history read, so two resumes of the same past session started together can each open a row for one host id.
  Re-check `holding` and `isOpenOnOtherRow` after the await, as `send` re-checks its row after its pending-history
  read, with a row in the resume tests.
- **Backlog applied save closes another editor** — *agent-ready*: in `src/plugins/backlog/page/backlog-view.ts`, an
  `applied` save result closes whichever editor is open and selects the saved title, so leaving the editor mid-save
  and opening another loses that editor. Guard `closeEditor` as `moveEditorBaseline` is guarded: act only when the
  open editor's path and baseline title match the write.
- **A note opening with "Shipped" files as done** — *needs a feature plan*: Notes files a follow-up whose one line is
  the body's first sentence (`src/plugins/notes/main/note-sender.ts`), and Backlog reads an item whose one line
  starts with "shipped" as done (`startsWithShipped`, `src/shared/followups/followup-file.ts`), so such a note never
  shows in the append picker (`note-homes.ts` drops done items). Options: prefix or reword a one line that would read
  as done, or have Backlog mark done by an explicit marker rather than the leading word.
- **Narrowing leaves the docs filter holding keys** — *agent-ready*: a window narrowing that hides Docs mode's side bar
  does not tell the mode (`narrowChanged` tells only when leaving `over`, `src/renderer/shell/modes.ts`), so a docs
  filter box open in the tree keeps the keys while hidden. Telling the mode on a narrowing broke the self-test's fit
  check before (8b399a5); a narrowing-only call that dismisses the filter without moving focus
  (`DocsView.dismissFilter`, `src/plugins/docs/page/start.ts`) would close it.
- **Selection lost on an outside rename or trash** — *agent-ready*: when another docs view renames or trashes a doc, a
  view whose selected row was that doc (its usual row or its Starred row) keeps a selection with no row, so `l` and
  `s` do nothing until the user moves. Star toggles already reselect the doc's usual row (`starChange`,
  `src/plugins/docs/page/docs-view.ts`); `outsideChange` could select the renamed doc's new row, or the nearest row
  after a trash.
- **Docs editor session module** — *needs a feature plan*: `createDocView` (`src/plugins/docs/page/doc-view.ts`) reads
  `editingSection` at about a dozen sites across the section editor, the conflict flow, `closeEditor` and `writeEditor`.
  An editor-session module owning those, with the mode as data (full text from the edit, saved text, restore, reload),
  would collapse most of them; it also moves the paste and drop code, so it is its own plan.
- **One newest-wins open rule** — *agent-ready*: docs opens race each other with no shared rule: `openDoc` and `gh` drop
  a waiting request only for a newer one of either, so a doc the user opens from the tree or a link while it waits on a
  rebuild is replaced when the rebuild lands. One open-intent sequence shared by `openDoc`, tree leaf opens and
  in-doc links, checked where the open happens, gives one newest-wins rule (`src/plugins/docs/page/docs-view.ts`
  `openDoc`, `followFile`). A path snapshot was tried and dropped: it could not tell an earlier `openDoc`'s own open
  from a user's.
- **Missed rebuild on a rules folder write** — *agent-ready*: in a drive run, a doc written into the temp home's
  `.claude/rules/` from outside the app started no rebuild until Rescan. Check whether the docs watches cover that
  folder or the change was debounced away (`src/plugins/docs/main/view-watches.ts`, which watches one file per view).
- **Composer status line cut off in a very short Chat tab** — *needs a feature plan*: the composer's activity slot
  (`.chat-working-slot`, `flex-shrink: 0`) once held the live activity dock, about 97px, and with the box and a wrapped
  status line it outgrew the composer's cap in a tab under about 318px (a 900x360 window, or a pane after `splitDown`
  at 900x700), so the status line ran past the tab's bottom. The dock now draws in the session hub, and the slot holds
  one activity line, only while the hub is not visible; recheck the cut-off at a short tab before planning. CSS-only
  shrinking of the dock was tried and reverted (d22bc1b5, 9bba64c2): flex shrink is weighted, not ordered, so a
  shrinkable dock also gave up its lines to a long draft in a tall tab, and its all-or-nothing wrap dropped parts on
  sub-pixel shares.
- **Composer spills past its cap in a short pane** — *needs a feature plan*: `.ui-floating.chat-composer` caps at
  `max-height: 50%` (`src/plugins/chat/layouts/default/layout.css`) with nothing under it able to scroll enough, so its
  status line runs out of the panel's bottom edge: at 720x600 under `fake: steps`, and at 420x600 under
  `fake: hold`. The dock now draws in the session hub, and these measurements predate that move; recheck both sizes
  before planning. To decide: raise the cap or lower the box's floor. Source session: Claude Code
  c2cde885-2f45-42e7-ad71-cd59618615db in wigley-ai-gui.

- **`/clear` then relaunch loses the row's selection** — *agent-ready*: select a row, `/clear` it (running or idle),
  and restart; no row is selected and the main pane says `Pick a session in the side bar`, though
  `open-sessions.json`'s `selectedHostSessionId` holds the row's new host id. A selected row with no `/clear` stays
  selected. Seen on the fake harness through a drive `restart`; the cause isn't traced, and it may be fixture-only,
  since the fake has no saved history for the new id.
- **Tabs lose their first click in an unfocused pane** — *agent-ready*: the first click on a tab in an unfocused pane
  focuses the pane but does not select the tab. Pane focus moves on the release, and `drawFrame`
  (`src/plugins/sessions/page/session-tabs-view.ts`) then rebuilds the strip with `strip.replaceChildren()`, so the
  released tab leaves the document before its `click`: `pointerup` lands on the tab, `mouseup` on the `NAV`, and no
  `click` fires. A second click selects it. The bar's close-pane control works on the first click.
  Keep the tab elements across draws. Source session: Claude Code 368f2c4b-5d54-47bf-8285-14fec015fc6b in wigley-ai-gui.
- **A press on an older selection in an unfocused pane leaves the keys nowhere** — *agent-ready*: `pressedFocusAction`
  (`src/plugins/sessions/page/pane-sessions.ts`) reads the selection at the release, so it cannot tell one this press
  began from an older one left in that pane. A press on the selected text keeps nothing (Chromium collapses it at
  `mouseup`, from memory, not measured) and focus stays at the body; a press on a `preventDefault` target keeps the
  selection and the box takes no keys. Each costs one extra key; typing never reaches the wrong pane. Read, not driven.
  Record at the press whether a selection already existed. Source session: Claude Code
  368f2c4b-5d54-47bf-8285-14fec015fc6b in wigley-ai-gui.
- **A re-attach on the real harness reports `Earlier conversation not read: ENOENT`** — *agent-ready*: after a drive
  `restart` with `--harness claude`, the first transcript entry read that, for
  `~/.claude/projects/-tmp-claude-session-hub-p3/<id>.jsonl`; later entries stayed. The text comes from
  `src/plugins/chat/main/chat-sessions.ts`. Cause not traced: one lead is a Claude config folder other than `~/.claude`,
  which this machine's profile uses. Source session: Claude Code 368f2c4b-5d54-47bf-8285-14fec015fc6b in wigley-ai-gui.
- **The `chat: visuals` self-test step failed once** — *agent-ready*: `v -> [visual] visual overlay showing 2 of 2`
  (`src/plugins/chat/main/selftest-script.ts`) failed in 1 of 4 filtered runs at 914024cd, with no page reload in the
  log, then passed twice under `--plugin chat` and once under the same wider filter. The cause isn't traced; a late
  rest position on the reply's last block is one lead, since `d3ca10c9` had just changed the chat cursor's band move.
  Source session: Claude Code 368f2c4b-5d54-47bf-8285-14fec015fc6b in wigley-ai-gui.
- **Skills lists a slash the CLI did not recognise** — *agent-ready*: on the real harness, `/tiny` drew a Skills row
  `tiny main` while the agent replied that `/tiny` isn't a command in this session. The skill's file was written after
  the session started, so a loaded skill was not seen doing this. The event source is not traced; start at
  `foldAgentEvent` (`src/plugins/agents/roster.ts`). Source session: Claude Code 368f2c4b-5d54-47bf-8285-14fec015fc6b in
  wigley-ai-gui.
- **A clamped key on a too-tall last block stops following** — *agent-ready*: with the cursor following at the bottom on
  a last stop taller than the band, `j`, `J` or `k` takes `scrollIntoView({ block: 'nearest' })`, which pulls the list up
  a few pixels and ends following, so a streaming reply is left behind until `G`. Read from `entry-list.ts`
  (`scrollsToStop`, `drawFocus`), not yet seen live: force a tall last block, press `G`, `j`, then read `scrollTop` and
  add an entry. Fix: `scrollsToStop` also requires `!isScrolledToEnd(list, 1)`, with a test row. Source session: Claude Code cb0838dd-b8e5-430b-8c21-30e66b9a80ac in wigley-ai-gui.
- **A turn ending in a hidden tab can leave the chat cursor off screen** — *agent-ready*: `latest` skips its band move on a
  hidden list, and `scrollToFocus` on show fires no scroll when the list is already at the bottom, so over an overflowing
  open run the bar stays off screen until the next scroll. The window is narrow: a turn ending with no new height. Fix:
  settle in `scrollToFocus`'s following path. Source session: Claude Code cb0838dd-b8e5-430b-8c21-30e66b9a80ac in wigley-ai-gui.
- **`G` from an open run's last step can move the cursor up**: `G`, or a turn end, from the last step of an overflowing
  open run walks forward from the run's line and lands on the first step in view, while `design.md` says "the nearest step
  in view". To decide: settle from the last stop in `latest` (recommended, the cursor stays at the end) or keep the
  documented rule. Source session: Claude Code cb0838dd-b8e5-430b-8c21-30e66b9a80ac in wigley-ai-gui.
- **One rule for the chat cursor's scroll exceptions** — *needs a feature plan*: the on-screen rule in `entry-list.ts` was
  patched in four steps of one run: wholly in the band with a 1px tolerance, a fallback to the nearest overlapping stop,
  a band move in `latest` for a list that fires no scroll, and a too-tall exception on scrolling a following focus to the
  bottom; the three items above are the same mechanism again. Each patch was kept rather than stepped back from, because
  the run's two fix cycles ran out. To decide: whether one settle step run after every programmatic scroll and redraw,
  owning the band and following together, replaces the scroll event path and these exceptions. Source session: Claude Code cb0838dd-b8e5-430b-8c21-30e66b9a80ac in wigley-ai-gui.
- **Row title takes a local command's text** — *agent-ready*: a new session whose first message is a control
  command (`/effort auto`, seen in a live run) names its row after that command, though it starts no conversation.
  The first-message title source should wait for a message that reaches the model.
- **`<Tab>` in a forms round leaves the focused box off screen** — *agent-ready*: the box takes focus at y900 in a
  700px window and the pane does not scroll, so the user types into a box they cannot see. `focusBoxItem` reads the same
  on the base (`7001a175`), so it looks old, not proved. Steps: open a forms round with the notes box on a finding, size
  the window to 700px high, press `<Tab>`, then read the box's rect (`.cm-focused`) or take a screenshot; the box lies
  below the window until the caret moves.
- **`forms.choose` with an arg through `runCommand` across the Bridge is not proved live** — *agent-ready*:
  `window.wigley.runCommand("forms.choose", 2)` resolved with no `[forms]` line, with the round's row not the one
  showing, so the run proves nothing either way. The arg is proved through a `binds` entry only. To prove it: open a
  round that shows the row, run the command by `runCommand` from the page and from main, and read the `[forms]` line.
- **After a close, the selection lands on the new retro row** — *agent-ready*: closing rows fast with the sessions close
  key moves the selection to the Retro-section row a close just queued, so the next press closes the running retro and
  its retro is lost (auto-retro logs `retro <id> closed before done; <host ids> not analyzed`). Cause: `removeRow`
  (`src/plugins/sessions/main/session-list.ts`, the right-then-left neighbour pick) knows nothing of the rows a plugin
  section claims, and auto-retro claims the retro row (`joinRow` in `src/plugins/auto-retro/main/start.ts`) as the
  close queues it (`afterClose` in `retro-queue.ts`). Fix: the post-close selection skips rows a plugin section
  claims, falling to the next row outside a claimed section. Add a row to the session-list tests: GIVEN a selected
  row with a claimed row beside it WHEN the selected row closes THEN the selection lands on an unclaimed row.

## Harness seams

What a second harness — Codex, wigley-harness — and the agent settings and plugin features need.

- **The drive `wait-log` misses lines logged before it starts** — *agent-ready*: a driver waiting on a line a page
  start already logged never sees it. Read earlier lines back with `drive log`, or let `wait-log` scan the log it
  already holds.
- **AgentHarnessRegistry** — *agent-ready*: an `AgentHarnessRegistry` service (`register`, `list`, `get`,
  `onChanged`), so a harness plugin registers its adapter instead of `main.ts` building a fixed array. Harness ids
  become open strings with a declared `label`; sessions' `HARNESSES`, `harnessText`, `groupOf`'s "Codex session",
  docs' `IndexHarness`, notes' `HARNESS_LABELS` (`src/plugins/notes/session-ref.ts`, a third label map beside
  `harnessText`), the fake's `id: 'claude'`, and `sessionArgs`' hardcoded `"claude" | "codex"`
  (`src/plugins/sessions/main/start.ts`; `sessionArgsText` in `src/shared/agent-forms/drive-actions.ts` already
  derives it) stop switching on ids.
- **AgentHarness grows what a second harness needs** — *agent-ready*: `label`, `capabilities` (interrupt, resume,
  images, mid-turn send), `controls()` readable before start with `AgentStart.initialControls` (model chosen at
  start), a harness-minted session id (`events.sessionId` or returned from `start`), resume listing, and `costUsd`
  defined per turn with the adapter normalising Claude's cumulative value. The Claude adapter's `initialize` answer
  carries `models` and `current_permission_mode` (`claude-stream.md` § Initialize), so its model and mode controls
  read them at start instead of waiting for the first `init`.
- **Chat picks a harness** — *agent-ready*: `StartRequest.harness`, a harness step in the start prompt (skipped with
  one harness), replacing `CHAT_HARNESS_ID = 'claude'` (`src/plugins/chat/contract.ts`; also used by chat's
  `lookups.ts`, `chat-sessions.ts` and the usage plugin).
- **Control roles** — *agent-ready*: controls carry a `role` (`model`, `permissionMode`, `effort`) that chat's pick
  commands find them by (`src/plugins/chat/page/control-commands.ts`), rather than the fixed ids `mode` / `effort` /
  `model`.
- **Permission behind the harness** — *agent-ready*: `AgentProcessEvents.permission(request)` and
  `AgentProcess.answerPermission(id, decision)`; the adapter mints the entry and owns the reply JSON, and the MCP
  `permission_prompt` route becomes the Claude adapter's private wiring. `CLAUDE_PERMISSION_TOOL` leaves
  `src/contracts/agent.ts` for `src/main/claude-code/`.
- **Harness settings with the harness** — *agent-ready*: `claude.command` leaves core `Settings`
  (`src/config/settings.ts`) for the Claude harness plugin's manifest; `AgentStart.profileDir` is reworded
  harness-neutral; profiles become `{ harness, name, configDir }` owned by the harness plugin, so chat's profiles and
  docs' `claudeConfigDirs` stop being two sources of truth, and docs' write guard allows every registered harness's
  config folders.
- **Docs reads harness config roots from the adapter** — *agent-ready*: docs knows each harness's config layout
  itself: `installedPluginsFile` under Claude's config dirs or `~/.codex/config.toml` with TOML key quoting
  (`src/plugins/docs/main/doc-files.ts`), the `~/.codex` and `~/.codex/plugins/cache` index roots, the closed
  `{ claude, codex }` chip record (`src/plugins/docs/page/docs-state.ts`, `doc-view.ts`) and the `.claude` folder
  rule (`src/plugins/docs/kinds.ts`). Each harness adapter declares its config, plugin-manifest and plugin-cache
  roots and its label, and docs reads them. Builds on harness settings with the harness and AgentHarnessRegistry.
- **Open chat entry kinds and entry renderers** — *agent-ready*: `ChatEntry.kind` (`src/contracts/agent.ts`) opens
  for harness-specific kinds carrying only `raw`, drawn by the `raw` builder unless a layout names them. Chat page
  exports `addEntryRenderer({ kind, match?, build })`, ordered user layout → plugin renderers → default, and a partial
  chat layout falls back per entry kind (today only a throwing part falls back, `docs/features/layouts/design.md`).
- **Sessions stops naming Claude** — *agent-ready*: the MCP server name comes from configuration rather than
  `wigley-forms`, and the tool-use id comes through a raw `_meta` on `ToolCallContext` or a per-harness reader, not
  `claudecode/toolUseId` (`src/plugins/sessions/main/mcp/mcp-server.ts`).
- **Owned sessions join by an adapter key** — *needs a feature plan*: owned sessions join by a key the harness adapter
  supplies, settable after start, or a token passed in the spawn environment, rather than requiring a host session
  id before spawning (`session-list.ts` `connect`).
- **Harness-neutral UI copy** — *agent-ready*: UI copy says "the agent" or the harness label rather than Claude
  (`chat-dialogs.ts`, `src/plugins/chat/main/permission-tool.ts`, the Claude Code strings in
  `claude-code-harness.ts`).
- **Clear aliases from the adapter** — *agent-ready*: chat registers Claude's other names for `/clear`, `/reset`
  and `/new` (`src/plugins/chat/page/clear-commands.ts`), which is harness CLI knowledge in chat. The adapter
  declares its clear command's aliases, and chat registers whatever it declares.
- **Structured round results** — *agent-ready*: forms round logic returns structured results and the MCP adapter words
  them: `RoundError` as `{ path, problem, detail }`, payloads as an outcome plus a `reason`; `ask_round` /
  `collect_last_round` wording and "relay" leave `round.ts`, `round-type.ts` and the format errors, and
  `needs_manual_open` leaves forms' `Outcome` for the relay's. Each `ItemFormat` splits its model-facing `describe()`
  schema text from parse and fingerprint.
- **Agent settings through an adapter** — *needs a feature plan*: Settings mode edits only the app's own
  `settings.json`, so changing an agent's config (Claude's model, effort, permissions, hooks, env, per profile and per
  user, project and local scope) still needs a terminal: in print mode `/config` takes only `key=value`
  (`agent-chat/claude-stream.md` § Terminal-only commands). Add an agent settings seam beside `AgentHarness`
  (`src/contracts/agent.ts`) that each harness adapter fills: the settings it declares (key, label, type, choices,
  scope, current value) and a write checked by the harness's own rules. Settings mode then draws whatever the adapter
  declares, as the Chat tab draws session controls. Claude Code is the first adapter (`src/main/claude-code/`) and
  Codex's config the next; no file format or key name leaves its adapter. The first question is where each harness's
  key list and types come from (a schema, its CLI, or the adapter's own table) and whether a change reaches a running
  session.
- **Reload plugins and skills in a running session** — *needs a feature plan*: the user reloads a session's plugins
  and its skills from the app, with no `/clear`, so the conversation stays and a changed skill or plugin applies at
  once. Today a chat session picks up a change only through `/clear`, which restarts the process under a new session
  id, because `/reload-plugins` is terminal-only in print mode (`agent-chat/claude-stream.md` § Init). The stream has
  controls for both, measured on 2.1.318 with no message sent: `control_request` subtype `reload_plugins` answers with
  `commands`, `agents`, `plugins`, `mcpServers` and `error_count`, and `reload_skills` answers with `skills`. Add a
  reload to `AgentHarness`, so no control name leaves the Claude adapter, then an app slash command or key for each
  reload. Each reply also refreshes what the app read from init: the `/` completion and the agent-skills list. Open for
  the plan: whether the reload runs one session or every session of a profile; whether it waits while a turn runs; and
  how the app shows `error_count`. `reload_plugins` also takes `hold_on_cache_impact`, which declines a reload that
  would change the tool list and break the prompt cache, so the plan decides whether to use it and what the user sees
  when a reload is held. Source session: Claude Code b35fd8f9-6b58-4dd4-b32c-fc67f930e763 in ~/Documents/ai-dev.
- **Agent plugin management and sync** — *needs a feature plan*: list each profile's installed plugins and
  marketplaces (version, enabled, scope), and install, update, enable, disable, uninstall and reload them from the
  app, behind the harness seam: Claude Code's adapter runs `claude plugin` (`list`, `install`, `update`, `enable`,
  `disable`, `uninstall`, `marketplace`), Codex's its own commands. The Docs view then syncs the user's own plugins:
  commit, push, update the plugin for each harness and reload, acting on the docs-browser statuses (uncommitted,
  unpushed, not installed, session stale; `docs-browser/design.md`). A push still needs the user's press each time.
  The first question is which statuses each sync step acts on. Builds on **Reload plugins and skills in a running
  session**.
- **The harness's fake modes skip a `coreModeSlot` write made inside a `coreModeSlot` listener** — *needs a decision*:
  `tellShownMode` in `src/shared/plugin-part-harness.test-support.ts` (about line 1078) returns when the slot is held,
  and the fake holds its own claim across the write, so a listener that shows a mode finds the write skipped. The real
  `createModes` has no claim there. Only one listener today sets a flag, so nothing fails. To decide: move the
  `coreModeSlot` write to first, as the registry model does, or release the fake's claim before it tells.

## Platform and packaging

What Windows support and installers need.

- **Per-platform program lookup and spawning** — *agent-ready*: program lookup and spawning per platform behind
  `ProcessRunner`: `.cmd`/`.bat` shims through `cmd.exe` on Windows, a `resolveProgram('python')` (`py -3` → `python`
  → `python3`) for docs' index script (`index-sources.ts` runs `python3`), a PATH lookup for the `claude` command
  instead of `~/.local/bin/claude`, and spawn/kill handles so the Claude adapter stops importing
  `node:child_process`.
- **Round store through Files** — *agent-ready*: forms' round store (`src/shared/agent-forms/form-store.ts`) and
  sessions' endpoint files (`relay/endpoint.ts`) go through the `Files` service instead of sync `node:fs`, and its
  atomic write retries `rename` on Windows `EPERM`/`EBUSY`; today a held file makes a draft show unsaved and
  `returned` silently stay false. The store goes async with an in-memory index refreshed by `files.watch`, and the
  `~/.agents/wigley-forms/rounds` location becomes one named constant beside `SavedRound`.
- **Per-platform chord matching** — *agent-ready*: match the physical `code` only for Option chords on macOS, and
  `key` otherwise, so `<C-q>` lands on the right key on AZERTY and Dvorak; treat Windows AltGr (Ctrl+Alt) as typing,
  not a chord (`src/renderer/page-keys.ts`, `key-sequences.ts`); allow non-letter chords (`<C-/>`, `<F5>`).
- **Per-source alert descriptions** — *agent-ready*: `Alerts.setOpenCount(source, count)` carries no per-source
  description: the core sums the counts, but the Windows overlay names every source "open agent forms"
  (`electron-alerts.ts`), so chat waiting on the user would read as a form.
- **Packaging and installers** — *needs a feature plan*: installers for macOS and Windows (`forge.config.mts` has only
  `packagerConfig`, no makers). On the first signed build, check live that a notification click focuses its round:
  an unsigned dev build gets no macOS notification (the alerts adapter falls back to Dock bounce and badge).
- **Stable signing identity on macOS** — *needs a feature plan*: an agent session lost all access to `~/Documents`
  (`Operation not permitted`) right after the stable app relaunched, and regained it once the user changed the macOS
  privacy setting. The likely cause, not yet confirmed, is that the app is ad hoc signed with no team ID, so macOS
  ties the folder permission to one build and each `npm run install-app` can drop it for every running agent. Confirm
  the cause, then decide which signing identity `install-app` uses.
- **The app install waits while `main` holds half-finished work** — *agent-ready*: a half-finished state on `main`,
  such as an in-progress merge, blocks `npm run install-app`: one install rebuilt mid-merge and broke. Make the
  install wait until `main` is clean of it.
- **Native window vibrancy** — *needs a feature plan*: macOS `vibrancy` and Windows 11 mica behind a window adapter,
  in place of the CSS backdrop under L1 glass (`docs/features/ui-design/design.md`).
## Plugin extension points

Closed lists that become registrations, so a plugin adds what is hardcoded today.

- **View and interaction behaviours as switchable plugins** — *needs a feature plan*: behaviours such as
  `chat.completionDescriptions` and `keys.showHints` could ship as plugins the user switches on and off, rather than as
  settings inside the plugin they change. The live enable switch exists, so the split costs only the plugin boundary.
- **Runtime plugin loader** — *needs a feature plan*: a `PluginSource` seam (built-in list and a user folder of
  `manifest.json`, `main.js`, `page.js`); main `import()`s from disk and the page through `dataUrl`, and a
  `validateManifest` gives every plugin the checks `definePlugin` makes at compile time. `requireListed` and the static
  lists in `src/plugins/{main,page,manifests}.ts` are what block it. It builds on a host that starts, stops and restarts
  parts live (`PluginHost.start`, `stop`, `restart`, and the enable switch in `src/main/plugins/plugin-switch.ts`) and
  on the closed bridge (`window.wigley.claim()`). It also adds `reload(id, part)` (`src/shared/plugin-host.ts`), a
  reload with new code: stop the part and its dependents, import the new module, start them again. A reload leaves the
  dependents' view of the provider's exports stale, as a restart does not (it takes the dependents with it).
- **Forms item kinds as registrations** — *agent-ready*: forms item kinds register as one unit (`registerKind`, main
  and page, disposable), each declaring its wire keys (`argsKey`, `bodyKey`, `resultKey`,
  `fingerprintJoinsWhenEmpty`) so saved rounds, retro and the Python fingerprint stay byte-compatible. `Round` /
  `FormBody` / `AnswersPayload` hold `Record<kind, …>` inside and convert at the store and payload edge. On the page
  each kind is a `PageKind` module (items, restore/entry codec, reduce, boxes, kit, card input, review facts, rail
  order), replacing `ANSWERABLE_ORDER`, `ROUND_ITEMS`, `ANSWER_ARRAYS`, `PICK_ANSWERS`, `RECOMMENDED_PICKS`, `TextTarget`,
  `boxes.ts`, `card-kit.ts` tables, `read-layout.ts`'s `CARD_KINDS`, and the kind branches in `view-model.ts` and
  `round-view.ts`. The AGENTS.md "item kind" checklist shrinks to the module. The tool schema then needs disposable
  tool contributions (landed, plan-foundation-sweeps), and retro reads unknown result keys.
- **Finding origin specs and open layout unions** — *agent-ready*: finding origins become one `FindingOriginSpec`
  each (card, meaning, choice noun, choice bounds, severity required, action words, chip, theme token), the single
  source for the parser, tool text and card input. One `Finding` type with `severity: Severity | null` replaces the
  per-origin types; each saved round carries its origin action words so retro reads data rather than keeping
  `ORIGIN_ACTION_LABELS`. `origin` / `card` / `FindingAction` in forms' `layout.d.ts` become strings, so a new
  finding origin, card or action does not break a user forms layout typed against the closed unions.
- **Markdown block contributions** — *agent-ready*: `MarkdownRenderer.addBlock({ opener, render })` in the contract's
  own terms, beside the fence registry `addFence` (`docs/features/visuals/design.md`); the wigley `:::changes` /
  `:::tree` / `:::details` blocks move out of the core adapter (`markdown-it-renderer.ts`) into a contribution.
- **EditorHost.defineEx** — *agent-ready*: `EditorHost.defineEx(name, prefix, handler)`, disposable: the document
  editor's write/quit become ex commands the docs plugin registers, replacing the closed `DOCUMENT_EX_COMMANDS` and
  its loop in `codemirror-vim-host.ts`.
- **Plugin editor remaps** — *agent-ready*: a plugin manifest's `keys` gains remaps beside its binds and groups
  (today only the user keymap layer has remaps, `src/contracts/keymap.ts`).
- **Setting control kinds as registrations** — *agent-ready*: `SettingKind` (`'string' | 'number' | 'boolean'`,
  `src/contracts/plugin.ts`) and the settings layout's row `control` union (`src/plugins/settings/layouts/layout.d.ts`)
  are closed, and Settings mode switches over them (`setting-rows.ts`, `setting-rows-view.ts`). A plugin with a
  structured setting (chat's profiles, docs' config folders) cannot contribute its editor. A plugin registers a
  control kind with its row editor and its layout part, and the `control` field becomes a string so a new kind does
  not break a user settings layout. The layout name picker (Features) is then one such kind.
- **Layout hot reload keeps the user's place** — *agent-ready*: `round-view.ts` `rebuild` (run by `setLayouts` when a
  reload changes a layout it draws with, and by a card part or review column added or disposed) destroys and
  remounts every box. It focuses the focused box again (`keepFocusedBox`), in insert mode at the text's end when it
  was inserting, and keeps the main column's scroll, but loses the cursor, a visual mode and undo. Add
  `snapshot`/`restore` to `TextEditor`, restore them in `keepFocusedBox`, and swap a CSS-only change without a
  rebuild. Redraw only the cards a changed layout draws, reading `LayoutSet.changed` (kept unread for this, by the
  user's ruling). Forms is the owner this covers: chat's composer keeps its box and draft across a redraw, and docs'
  doc pane redraws its frame only after the editor closes.

## Features

User-facing features, those other work builds on first.

- **Chat holds a scrolled-up position and shows a "new messages" bubble** — *needs a feature plan*: the transcript
  jumps to the bottom only while the user is already there. Scrolled up, the user's position holds through every
  new entry, streaming text and resize, and a "new messages" bubble floats at the bottom of the transcript, above
  the composer; clicking it, or scrolling back to the bottom, jumps down, follows again and hides the bubble.
  Today: any scroll that rests off the bottom stops following (`focusAfterScrollEvent`,
  `src/plugins/chat/page/entry-list.ts`), but nothing shows that new entries arrived below. Open for the plan: what
  counts as new (an entry, an assistant message only, or streaming growth too), whether the bubble shows a count,
  its key binding, and its draw through the chat layout contract (`src/plugins/chat/layouts/layout.d.ts`). Settle it
  with `focusAfterChange` in `src/plugins/chat/page/entry-focus.ts`, which holds the following rule.
- **Command palette and fuzzy finders** — *needs a feature plan*: a command palette, and `Space f f` (find a file) and
  `Space f s` (search text), all ranked by the `FuzzyMatcher` page service (Foundations; `docs/keymap.md` reserves
  the keys). Builds on the runtime command API (command labels) and the core picker service (`services.picker`), both landed. Deferred from the docs
  browser (`docs-browser/design.md`).
- **Terminal in the app** — *needs a feature plan*: a real interactive shell inside the app, so the user runs terminal
  commands without leaving it: a sign-in such as `gcloud auth login`, and the commands print mode refuses. The app has
  no terminal today: `package.json` holds no pty or terminal emulator, and `ProcessRunner` only runs a program to its
  exit and returns its output. It needs a pty and an emulator, each behind a contract and its own adapter, with the
  default shell picked per platform for macOS and Windows; each package is a third-party ask, and a pty is a native
  module the Electron build must compile. Open for the plan: where it lives (a session tab that starts in the session's
  folder, the shell's `panel` area, or a mode of its own); whether a shell outlives an app restart through the session
  host; how keys reach it, since chord binds fire ahead of a text box and a shell needs most of them; and what the
  layout draws, since the emulator draws its own grid. Source session: Claude Code
  b35fd8f9-6b58-4dd4-b32c-fc67f930e763 in ~/Documents/ai-dev.
- **Codex harness adapter** — *needs a feature plan*: a Codex adapter behind `AgentHarness`, declaring Codex's own
  session controls (`agent-chat/design.md`). With it: a Codex process started from a shell Claude Code spawned
  inherits `CLAUDECODE=1`, so its row reads `Claude`; and Codex last-loaded times in the docs index (docs-browser
  plan D, `docs_index.py` README § Last loaded) — Codex sessions (`~/.codex/sessions/`) record no list of loaded
  files; older ones carry a `# AGENTS.md instructions for <cwd>` message, and skills show only as `exec_command` calls
  running `cat …/SKILL.md`, so a reader would match those commands by pattern. Builds on Harness seams.
- **See which skills a session has loaded** — *needs a feature plan*: at any moment the user sees, at a glance, which
  skills a session has loaded. The docs browser's per-session load states hold the data
  (`docs/features/docs-browser/`).
- **See agents messaging each other** — *needs a feature plan*: when an agent sends a message to another agent, the
  user sees it. Design it with the chat bar's agent strip (`docs/features/chat-bar/plan-strip-and-status-line/`),
  which draws a session's subagents. Source session: Claude Code b3e1a3e8-589a-4bbd-adba-abc78ad2405f in
  ~/Documents/ai-dev.
- **Read-only Chat tab for terminal sessions** — *needs a feature plan*: a Chat tab for sessions started in a
  terminal, following the session's transcript file.
- **wigley-harness adapter** — *needs a feature plan*: an adapter behind `AgentHarness`, so the app drives the C#
  harness as it drives Claude Code. Builds on Harness seams.
- **"Always allow" on a chat permission card** — *needs a feature plan*: writes the rule to the project's local Claude
  settings; Claude's permission-prompt tool path for it is undocumented, so it starts with a spike.
- **Step and tool-call durations in the activity line** — *agent-ready*: every chat entry carries `at`, so a step row
  in an open activity line shows the time from its `at` to the next entry's, and a tool call shows how long it took;
  the activity line already shows its run's time (`src/plugins/chat/page/activity-runs.ts`).
- **Ctrl+j/k cursor keys in the remaining list views** — *agent-ready*: `<C-j>`/`<C-k>` are bound for primer, chat,
  workflow, forms, docs, backlog and gallery (`src/plugins/keymap.ts`). Still missing: settings sections and rows, the
  chat, docs and settings pickers, and the chat session list. `Ctrl+j`/`Ctrl+k` move the cursor a line and
  `Ctrl+Shift+j`/`Ctrl+Shift+k` half a page, so the scroll keys (`docs/keymap.md`, Layers) reach every view.
- **Layout name picker in Settings mode** — *agent-ready*: each `<owner>.layout` setting (and `shell.layout`) draws as
  a plain text row; a picker listing the owner's layout names, as the theme row lists themes, would read main's
  `api.layouts.names()`.
- **Latte theme and OS light/dark following** — *needs a feature plan*: the token model is theme-neutral
  (`colorScheme` per theme), so this is a theme file, its `DESIGN.md` light rules, and a light/dark choice.
- **Theme editor in Settings mode** — *needs a feature plan*: the user's `themes/*.json` token sheets are hand-edited
  today, and the userConfig service writes only `settings.json` and `keymap.json`
  (`docs/features/settings/design.md`).
- **Images in rendered docs** — *needs a feature plan*: loading local image files into the page needs a safe file
  protocol of its own; today they show their alt text.
- **Keyboard link hints in rendered docs** — *needs a feature plan*: vimium-style hints, if Tab between links is not
  enough.
- **Design skills in wigley-ai-marketplace** — *needs a feature plan*: tailor ui-skills' baseline-ui,
  fixing-accessibility and fixing-motion-performance (MIT) and Impeccable's critique, audit, polish and quieter
  guidance (Apache-2.0; keep notices) into wigley skills that read a project's `DESIGN.md`, dropping the detector
  CLI. Plan it in that repo.

- **Usage's cache mark has no preview route** — *needs a feature plan*: `rowCache` draws nothing without a cache expiry,
  and no `Space z l` sample holds usage, so a usage layout author cannot see the mark in the app. Decide between a usage
  preview and seeding chat's preview session (`AGENTS.md`: a view needing agent data has a preview sample).
- **Judge Large's agent count from the run log** — *needs a feature plan*: does Large use more agents than its results
  earn? The evidence is `runs.jsonl` in the `workflow` plugin's data folder of the stable app (`plugins/workflow/` in the
  app's user data folder), one JSON object per finished workflow with `at`, `sessionId`, `projectDir`, `workflow`,
  `movedUpFrom`, `activeMs`, `costUsd` and `fixCycles`: compare Large's lines against Medium's. Plan it when the file
  holds 20 Large lines, so that one odd run does not set the answer. The options: keep Large's agents as they are;
  reduce the plan drafters and cold readers in `wigley:feature`; reduce the review lanes in `wigley:review`. It waited
  because of `docs/features/workflow-levels/design.md` § Decisions, "Large stays exactly as it was": published guidance
  against many agents on coding work is vendor evidence, and the log gives the user's own.

## Code cleanup

Duplication and drift with no user-visible defect.

- **Split subscribes to its width key** — *agent-ready*: `Split` (`src/shared/page/ui/split.ts`) subscribes to its
  ui-state key instead of each owner calling `reloadWidth()` when shown (the shell, docs' session tree, forms' rail,
  the primer's two splits), so a new split owner cannot forget it.
- **One native-input reset in the input frame** — *agent-ready*: five plugins copy the same eight-declaration reset
  for the plain `<input>` that `textBoxInput` puts in an `inputFrame` (transparent background, no border,
  `font: inherit`, no outline, no padding, full width, `min-width: 0`): `.docs-box` (`src/plugins/docs/page/docs.css`),
  `.settings-box-input` (`settings/page/settings.css`), `.backlog-filter-input` (`backlog/page/backlog.css`),
  `.notes-title` (`notes/page/notes.css`) and the sessions rename dialog's box. Move it into the primitive (a rule on
  `.ui-input > input` in `src/shared/page/ui/input-frame.css`, or a class `textBoxInput` adds) and delete the five
  copies, checking each box's look in a drive capture.
- **Sessions split picker rows through the sessions layout** — *agent-ready*: the split's "Show session" picker
  (`openSplitPicker`, `src/plugins/sessions/page/start.ts`) passes no `drawRow` to the picker's `open`, so its rows do
  not draw through `sessions.layout`, against `docs/features/layouts/design.md`'s "a dialog follows its opener". Add a
  picker-row part to the sessions layout contract and `default` layout, as docs, chat, settings, notes and backlog
  do.
- **Toasts through the shell layout** — *agent-ready*: `createToasts` (`src/renderer/toasts.ts`) builds every toast
  in code, and the shell layout contract has no toast part, so no layout file restyles one. Add a `toast` part to
  the shell contract and its `default` layout; the core keeps the layer, timing and removal.
- **Dialog frames and confirms through the opener's layout** — *agent-ready*: `createDialog`
  (`src/shared/page/ui/dialog.ts`) draws every dialog's frame and title in code, the keys help dialog's Close button
  included, and the forms and primer cancel confirms pass no `drawBody` to `createConfirmPrompt`
  (`src/plugins/forms/page/forms-view.ts`, `src/plugins/primer/page/primer-view.ts`). Give the dialog a frame hook
  each owner fills, as `drawRow` and `drawBody` already are, and pass `drawBody` in forms and the primer. Then drop
  "the cancel dialog" from what AGENTS.md § A forms layout says the app keeps.
- **Forms and primer column chrome through their layouts** — *agent-ready*: forms' rail head, item pager and rail
  foot (`src/plugins/forms/page/round-view.ts`), the primer's column heads, tasks foot and card edge strip
  (`src/plugins/primer/page/primer-view.ts`), and the shared status line both use (`createStatusLine`,
  `src/shared/page/status-line.ts`) are built in code. Add their parts to the forms and primer layout contracts and
  `default` layouts. Then drop the carve-outs for status lines and column strips from
  `docs/features/layouts/design.md` (§ What a layout draws, § The primer's columns).
- **Fixed texts in layout slots** — *agent-ready*: the layout places a slot and the app writes fixed text or
  elements into it: backlog's and docs' status text (`backlog/page/backlog-view.ts`, `docs/page/tree-view.ts`), the
  cursor-row action prompts (backlog, docs, settings, primer and notes), and the settings edit-box message
  (`settings/page/row-box.ts`). Pass each as part input so the layout draws it.
- **Info tone for the on-demand tag** — *agent-ready*: the `on-demand` load-state tag uses the accent tone
  (`CHIP_TONES`, `src/plugins/docs/layouts/default/layout.js`), against DESIGN.md's rule that colour at rest means a
  status; it was `status-info` before docs-browser plan C, and `listed` now reads the same as `not-loaded`. Needs an
  `info` tone on the Tag primitive (`TagTone`, `src/shared/page/ui/tag.ts`).
- **ownsRoot helper** — *agent-ready*: "a `repo` or `features` entry owns its root" is spelled inline in four places;
  one `ownsRoot(entry)` beside `isKnownSource` gives it one home (`src/plugins/docs/tree.ts` `buildTree`,
  `path-guard.ts`, `page/docs-state.ts`, `index-document.ts`).
- **isStringArray reuse** — *agent-ready*: two inline string-array checks repeat `isStringArray` from
  `src/shared/json.ts` (`src/plugins/docs/main/script-locator.ts`, `src/shared/drive-args.ts`).
- **Redundant docs.css rule** — *agent-ready*: `src/plugins/docs/page/docs.css` keeps
  `.docs-tree.is-pane-inactive .ui-row.is-selected`, which the one rule in `src/shared/page/ui/row.css`
  (`.is-pane-inactive .ui-row.is-selected`) now covers.
- **Split form-state.ts and rename the FormsView union** — *agent-ready*: `src/plugins/forms/page/form-state.ts`
  (about 800 lines; autosave already split out) splits into session state, answers (dispatching to `PageKind.reduce`
  once kinds register), finding rules (into `kinds/finding/`) and a draft codec. Two types are named `FormsView` (the
  union in `src/plugins/forms/contract.ts`, the interface in `forms/page/forms-view.ts`): rename the union, which also
  names the key scope.
- **Forms tool table from one list** — *agent-ready*: forms' tool routing derives `FORMS_TOOLS`
  (`src/plugins/forms/main/tool-definitions.ts`) and the dispatch from one list of `{ definition, call }`;
  `isSavedOutcome` (`src/shared/agent-forms/form-store.ts`) derives from a `SAVED_OUTCOMES` const; `answerResult` and
  `findingResult` (`forms/main/round.ts`) share one status ladder on the answerable format.
- **Sessions page model** — *agent-ready*: the sessions page `start` (`src/plugins/sessions/page/start.ts`) moves its
  closure state and its multi-job `apply` into a DOM-free `createSessionsPageModel`.
- **"Answered" or "responded" on the forms page** — *needs a feature plan*: the forms page counts a notes-only item as
  `answered` (`isResponded`, `src/plugins/forms/item-response.ts`), while the payload's `answered` is pick-only
  (`isAnswered`). User-visible text still says "answered": the progress line "N of M answered" (`view-model.ts`), the
  card-parts labels 'Answered' and 'Not answered' (`src/plugins/forms/page/kinds/card-parts.ts`), and the
  `p.round-progress` comment in `src/plugins/forms/layouts/layout.d.ts`. Decide whether the page says "responded"
  there.
- **One `DEFAULT_NAME` for the layout host** — *agent-ready*: `const DEFAULT_NAME = 'default'` has 9 private copies
  (`src/shared/layout-url.ts`, `src/shared/layouts/layout-registry.ts`, `src/main/layouts/layout-service.ts`,
  `src/plugins/forms/page/layout/layout-resolver.ts`, and `draw-part.ts`, `layout-parts.ts`, `pick.ts`,
  `layout-loader.ts`, `show-layouts.ts` under `src/shared/page/layout-host/`). Export one from
  `src/contracts/layouts.ts` and import it at every site.
  Source session: Claude Code eb4e38a7-3b4f-4519-a0f6-31da367ff30f in /Users/jonathonwigley/Documents/ai-dev.
- **`DrawnPart` reports which layout object drew** — *agent-ready*: chat's entry list re-derives drawPart's bundled-pick
  check as `isBundledView: !drawn.drewPick || pick.layout === defaultLayout` (`src/plugins/chat/page/entry-list.ts`),
  copying `isBundledPick` in `src/shared/page/layout-host/draw-part.ts`. Have `drawPart` report whether the bundled
  default object drew (e.g. `drewBundled` on `DrawnPart`) and use it in chat, so the rule lives in one place.
  Source session: Claude Code eb4e38a7-3b4f-4519-a0f6-31da367ff30f in /Users/jonathonwigley/Documents/ai-dev.

- **One shared tick and one shared `fakeTimers`** — *agent-ready*: the block "one pending one-shot, set while needed,
  clear when not" has four copies (`grep pendingTick`: `chat/page/row-clock.ts`, `agent-strip/page/agent-strip.ts`,
  `workflow/page/workflow-view.ts`, `agent-lines/page/working-lines.ts`). The `fakeTimers` test helper has eight
  (`grep 'fakeTimers ='`). Give each one home in `src/shared`.
- **Legacy `question` tolerance in the question format** — *agent-ready*, after 2027-02-06: the form store prunes saved
  rounds after 90 days (`RETENTION_SECONDS` in `src/shared/agent-forms/form-store.ts`), so by that date none saved before
  the `question` to `summary` rename remains. Remove `LEGACY_SUMMARY_FIELD` in
  `src/plugins/forms/main/kinds/question/question-format.ts`, its filter in the missing-field check, the error for both
  fields present, and the two legacy rows in `question-format.test.ts`.

## Latent defects and tests

Defects with no path to the user today, checks waiting on a live window, and test cleanup. Test cleanup goes last
because the earlier items rewrite many of these tests anyway.

- **A repeated `forms.openRound` shows nothing** — a second `forms.openRound` of a default round already submitted in
  that session gets its stored answers back from form-service's `replaysLastSubmitted`
  (`src/shared/agent-forms/form-service.ts`). Nothing shows and nothing logs, so a drive run that opens the same
  round twice in one session sees no popup. A drive run passes a different `round` meanwhile
  (`.agents/skills/drive/SKILL.md`). Decide whether the drive action opens a fresh round on a repeat, or logs the
  replay.
- **`forms.openRound` leaves the pane on the previous session** — `forms.openRound` with no `sessionId` connects a
  `drive-forms-<n>` row through `sessions.mark` without selecting it, so the pane keeps showing the previous session
  (`src/shared/agent-forms/drive-actions.ts`).
- **Primer's self-test needs forms' preview session** — run alone (`npm run selftest -- --plugin primer`), the
  primer's script fails on its 'review and cancel' `alsoExpect`, which waits for
  `[sessions] activated Layout preview` (`src/plugins/primer/main/selftest-script.ts`). That line needs forms' Layout
  preview session, so the script passes only with `--plugin forms,primer` (from eb6f544b8). Either drop the wait, or
  have the script open the session it waits on.
- **A failing worktree list goes unreported** — *agent-ready*: `planCopies` (`src/shared/plan-copies.ts`) falls back to
  the plan's own copy, with no log, when `git.worktrees` rejects, so a list that keeps failing hides every worktree
  copy from Large and Backlog in silence. Log the rejection once per clone.
- **Backlog reloads once per worktree edit** — *agent-ready*: each change under a linked worktree's `docs/features`
  sends `changed`, and the Backlog page runs a full, uncoalesced load for each one (`src/plugins/backlog/main/start.ts`
  `watchWorktrees`). Coalesce the page's `changed` reloads if a burst of worktree edits proves slow.
- **A hand-back's join counts one step short** — *agent-ready*: in `src/main/claude-code/stream-decoder.ts`, a
  non-empty turn right after a hand-back result puts its init in the hand-back turn's events entry, so its divider
  counts one step fewer; a second hand-back right after the first does the same. Key the join on the next result
  being empty rather than on the init.
- **The live quit hold has no cap** — *needs a decision*: a main part whose dispose never settles makes the app
  quittable only by force-quit, and the `quit is waiting on …` log goes to stderr only. The plan ruled that a second
  quit holds. Options: a second quit exits in a live run, or a long cap after the log.
- **Each page start logs `[config] applied a new config` again** — *agent-ready*: the line repeats at every page start
  that follows a switch or restart. Log it only when the applied config changed.
- **Chat's `<C-n>` bind stays served under gallery's scope while gallery is off** — harmless, since the scope is
  unreachable. Drop it with the other binds of an off plugin if the served config ever lists scopes by owner.
- **Docs editor-landing issues** — when the docs editor lands: an editor key sequence bound only in other scopes is
  taken from vim in every editor, so a normal-mode Esc in a docs box runs nothing and logs `<Esc> has no bind in
  docs.…` while forms binds `<Esc>`. A row removed while its round stays open rebuilds that round's popup in a
  new frame for the gone session (`addPopup`'s `frameOf`, `src/plugins/sessions/page/session-tabs-view.ts`), and
  nothing drops that frame after the round closes.
- **Editor key replay limits** — editor key replay (a broken key sequence replayed into a box through
  `EditorHost.typeInto`, `src/renderer/page-keys.ts`) has three limits only a custom keymap reaches: focus moving
  mid-replay sends the rest to the old box, a replayed `:` does not open the vim command prompt, and Shift is lost on
  named keys.
- **Sends and draws after a plugin stops** — *agent-ready*: the host disposes a registration made after the stop, but
  a late send or draw is not a registration. Known sites:
  - workflow main's queued `ready.then` work and `chat.launch` reach its store after a stop
  - the `startFormsEvents` and `startPrimerEvents` subscriptions, and a late `sendFailed`
  - a late reply can draw into a disposed backlog view
  - late continuations in settings and sessions run against detached elements

  Decide one rule (a stopped flag each continuation checks, or a signal the part awaits against), apply it at these
  sites, and grep every async path in one pass: the docs view's guards landed one site at a time, across three rounds.
- **A page's invoke after its plugin's main part stopped** — *agent-ready*: `plugin:invoke` rejects with `no main
  handler` once main's part has stopped, and the page side only logs it (chat view, doc view). A self-test logs these
  errors after `all passed`: `watchDoc`, `pluginStatus`, `loadIndex`, `loadHistory`. The live switch stops page parts
  before main parts, but a restart leaves running the page part of a plugin that depends on the restarted one only in
  main, so a restart has the same invoke gap, and a quit produces these lines too: quiet them.
- **Withdrawn tools reach live hosts late** — *agent-ready*: at a stop, withdrawn tools and shrinking tool lists need
  to reach live hosts before `relay.close`, and the relay's second notice arrives only on the host's next `tools/call`.
- **A stop drops unsaved text** — notes' popup and a forms draft lose what the user typed when their part stops. A
  switch-off asks `mayStop` first and refuses while their text is unsaved or a round is open, so a restart (drive-only) is the stop that still
  drops it.
- **Switching off docs-session-tab drops unsaved Docs tab edits** — *agent-ready*: the part has no page `mayStop`
  (`src/plugins/docs-session-tab/page/start.ts`), so a live switch-off disposes a session's Docs tab with its unsaved
  text and asks nothing. Docs' own `mayStop` (`src/plugins/docs/page/start.ts`) runs only when docs itself is switched
  off. Give docs-session-tab a `mayStop` that refuses while a Docs tab's text is unsaved, as docs does, with a row in
  its `start.test.ts`.
- **Switching off session-stash drops a note being typed** — *agent-ready*: the part has no `mayStop`
  (`src/plugins/session-stash/page/start.ts`), so a live switch-off while its note dialog is open drops the note the
  user is typing. Refuse the switch-off while the dialog is open (`noteDialog.isOpen()`), with a test of the refusal.
- **A pushed scope after its host is disposed** — `PushedScope.pop` throws after host disposal (notes popup, rename
  dialog, settings view), and `keys.setScope` leaves its base behind. Same trigger as the item above.
- **A disposed layout preview still opens** — after `dispose`, the layout preview's `show` can open a preview, because
  it does not check. Make a disposed service refuse, as `track` does for a registration made after the stop.
- **A throwing teardown step skips the rest** — *agent-ready*: these remain plain sequences: chat's `detachAll` (a
  throwing `detach` or `kill` cannot happen today), `disposeAnchors`, `dispose` in the docs view, and the sessions tabs view's
  `drop`, `disposeText` and `disposeTabs`, where a throw leaves a half-disposed frame in the map. Run the remaining steps
  through `callEach`, the way `Registrations.dispose` does. Grep every plain teardown sequence in one pass: the fixes so
  far patched sites as each review found them.
- **Every view's dispose against what it drew** — *agent-ready*: the sessions side bar and the gallery's drag reorder
  each outlasted their view's `dispose` until fixed one at a time. Check every view's `dispose` against what it drew in
  one pass, for the same reason.
- **The part harness's fakes drift from their contracts** — *agent-ready*: three review rounds each found a fake that
  dropped a throw its contract states; the fake markdown's fence list still lacks the renderer's built-in `diff`. A
  contract row suite run against both fake and real, as `files-contract.test-support.ts` does, would end the site-by-site
  patching.
- **A viewport-sized wide visual ends one scrollbar tall after it grows** — a visual whose root follows the viewport
  (`min-height: 100vh`) and is wider than the column settles one horizontal scrollbar (15 px) taller than it needs
  once its content grows after load (the known limit in `docs/features/visuals/design.md` and
  `src/main/data-protocol/visual-height.test.ts`). One candidate rule: drop a report when the root grew by more than 0
  and no more than the viewport grew; it needs a check that a content-sized visual growing during a frame resize is
  still reported.
- **Chat remounts an unchanged visual on two updates in one task** — two assistant-entry updates landing in one task
  draw the new markdown twice before the mount's sweep, so a visual whose source did not change can mount again. Seen
  in the Visuals review, not reproduced live.
- **A visual may flash light in a dark theme before its first theme post** — the frame's root stays hidden until the
  page's first theme message, but the iframe's own background before that is unproved; check in a real window with a
  dark theme.
- **Per-run drive build** — each dev drive run could build main and preload into its own `.drive/<run>/build` and
  launch Electron on it directly instead of through `electron-forge start`, so drive runs and the user's `npm start`
  stop sharing `.vite/build` (forge plugin-vite fixes that folder at `<project>/.vite`). The start lock in `scripts/`
  covers drive and self-test starts only. Do this if the user's `npm start` keeps getting hit.
- **Docs addView session wording** — when a plugin first adds a non-session docs view, rename `addView`'s
  session-worded internals (`SESSION_TREE_SPLIT`, `sessionTree`, the `Docs tab shown` log line, the `c` toast) in
  `src/plugins/docs/page/start.ts`.
- **Title bar overlay alias blame** — `titleBarOverlayProblem` blames the file at the end of a colour alias chain
  (`src/main/title-bar-overlay.ts`). Colour tokens accept only hex, `transparent` or an alias today, so it is right; if
  the colour kind widens (`rgb()`, `color-mix()`), a user alias onto a built-in token would be blamed on the built-in
  theme and fail start.
- **Nested settings element checks** — settings.json array elements are checked for the default element's top-level
  keys only (`checkElements`, `src/main/config/user-settings.ts`); a nested object inside an element would pass with
  keys missing. No setting has that shape yet.
- **Memory Files folder watch events** — *agent-ready*: the memory Files adapter reports nothing to a watch when it
  makes, removes or trashes an empty folder, where Node's `fs.watch` on the parent reports the folder's name
  (`src/shared/memory-files.ts` `makeFolder`, the `removeKey` callers). No caller depends on it yet.
- **Primer self-test start-order dependence** — *agent-ready*: the primer self-test's last step
  (`src/plugins/primer/main/selftest-script.ts`) expects `[sessions] activated Layout preview`. That line depends on
  forms' self-test running just before and leaving its preview row to the left, so a change in plugin start order
  breaks it. Fix: a close log line of its own in the sessions page, or activate a known session first.
- **Restored row with a missing profile never gets its saved usage** — `restoreRecord`
  (`src/plugins/chat/main/chat-sessions.ts`, near line 1337; the `lastUsage` read at 1353) reads `harness.lastUsage`
  only when the profile is found at restore. History recovers once the profile returns (`loadHistory` retries, pinned
  by `loadHistory_ProfileMissing_ReadsOnceItIsBack`); usage does not, so the row draws `0k` until its first live turn.
  Choice: retry the saved-usage read from `loadHistory` when it reads (default: the same retry point as history), or
  on a profiles change. Source session: Claude Code 76f5a6f5-89a8-4d05-a525-af23402d29ad in wigley-ai-gui.
- **Restored saved usage is appended to the agents plugin's session log** — *needs a feature plan*: chat emits a
  restored (and resumed) row's saved usage on the shared `chat.agentEvent` bus, and the agents plugin appends every
  `chat.agentEvent` to `logs/<hostSessionId>.jsonl` (`src/plugins/agents/main/start.ts` near lines 65-68). Each app
  start therefore appends one replayed `usage` line, with an old `at`, per sent restored session. Workflow and the
  roster ignore `usage`. Choice: keep the bus and let the log skip replays (a marker on the event), or send saved
  usage to the usage store on its own route. Source session: Claude Code 76f5a6f5-89a8-4d05-a525-af23402d29ad in
  wigley-ai-gui.
- **A retro row whose process ends before its first turn never reads done** — *needs a feature plan*: `isRetroDone`
  (`src/plugins/auto-retro/main/retro-done.ts`) returns false while `hasStarted` is false, even when `info.running` is
  false, and `closeIfStillDone` / `checkDone` (`src/plugins/auto-retro/main/start.ts`) only run for a done row. A retro
  row whose process dies before its first turn (a failed launch, a crash) therefore never settles, and the queue waits
  on it forever. To decide: treat a row whose process ended with no turn as done (closed `finished`), or as failed
  (closed with a log naming the lost retro), and move the queue on either way. Check that a row not yet attached
  (`running` false before the process starts) is not read as ended.
- **A restored retro row resting idle reads done** — *needs a feature plan*: on restore, `begin` in
  `src/plugins/auto-retro/main/start.ts` (the `followRows` `added` callback) adds the row to `startedRows` so a retro
  that finished while the app was down closes. A restored row resting idle also reads done, so it is closed `finished`
  though the retro never ran (an app stop before its first turn). To decide: settle a restored row only after a turn
  seen in this app run, or relaunch the retro when the restored row has no turn.
- **A restored retro row the queue lost stays unclaimed and open** — *agent-ready*: when `queue.json` fails to load, a
  restore is late, or the profile is gone, the row's host id is not in `launched`, so the `added` callback in
  `src/plugins/auto-retro/main/start.ts` skips it. A close of it queues no retro, since `afterClose`
  (`retro-queue.ts`) reads its first message (`RETRO_COMMAND`), but nothing claims it into the Retro section or closes
  it when done. Fix: claim and watch rows whose first message starts with `RETRO_COMMAND ` as well as rows in
  `launched`. Add a start.test.ts row: GIVEN a restored row whose first message is a retro command and an empty
  queue WHEN the row joins THEN it joins the Retro section.
- **Chat's `close` and `closeSessionsIn` never resolve after dispose** — *agent-ready*: a call after the chat part's
  `dispose` (`src/plugins/chat/main/start.ts`, `closeSessionsIn` and `close` in `exports`) sets an `endWaits` entry
  that nothing resolves, since `dispose` resolved the waits it held and cleared the map once. Fix: reject once
  disposed, as `requireHeld` rejects an unheld session. Add a test: GIVEN a disposed chat part WHEN `close` is called
  THEN it rejects.
- **Docs page test seam for a session's host id change** — *agent-ready*: after `/clear`, the
  `docs-session-tab` part hears a row's host id change through `followRows` and calls `DocsViewHandle.sourceReplaced()`,
  which rebuilds a session Docs tab that has shown (`src/plugins/docs-session-tab/page/start.ts`, `docs-view.ts`). Two unit tests pin one half each: the
  `docs-session-tab` part's `start.test.ts` pins that the call reaches the changed row's view, and the docs page's
  `start.test.ts` pins that `sourceReplaced` rebuilds a view only once shown. No test joins them, and the chat
  self-test's clear step never shows chat-second's Docs tab. Add a self-test step that shows the Docs tab before the
  clear and expects a rebuild line after it (the self-test starts every plugin, `docs-session-tab` included).
- **The lost-retro log's emit-time capture has an untested second path** — *agent-ready*: the `chat.sessionClosed`
  listener in `src/plugins/auto-retro/main/start.ts` captures `isSettling` at emit, because chat's `closed()`
  (`src/plugins/chat/main/chat-sessions.ts`) deletes the `chat.session` slot entry synchronously after the emit, which
  clears `settle` before the chained step runs. It took three fixes (ab2ff884, e6baa24a, a5065f94) and the last was
  not re-reviewed. A second path clears `settle` the same way: `endClosed` calls `owned.end()` synchronously for a
  non-running session, which can drop the sessions row and reach `leaveRow` before the step. Fix: add a row for that
  path to the table test `sessionClosed_RunningRowClosed_LogsTheLostRetroOnlyBeforeDone` in
  `src/plugins/auto-retro/main/start.test.ts`, and read the capture afresh for correctness.
- **Shell layout swap failure tests** — *agent-ready*: `mountShell`'s rollback when a layout throws or misses an area,
  and the generation-guarded restore after a later `setLayout` (`src/renderer/shell/shell.ts`), are untested. Plan
  B's gallery `Space z s` covers only a good swap and its restore; a throwing test layout and a second swap would
  cover the rest.
- **Primer tests on a full task's add-item box** — *agent-ready*: `src/plugins/primer/page/primer-commands.test.ts`
  (the two tests at "from a task holding 20 items" and "from an add-item box on a task holding 20 items") mounts an
  add-item box on a full task. The page no longer reaches that state, since a full task shows no add-item box
  (`hasAddItemBox`, `src/plugins/primer/page/boxes.ts`). Retarget them at a stale box, or drop them.
- **form-service test over the memory store** — *agent-ready*: `form-service.test.ts` (`src/shared/agent-forms/`)
  runs its logic over `createMemoryFormStore`, leaving disk behaviour to `form-store.test.ts`.
- **Tests that restate shipped text** — *agent-ready*: drop or rewrite tests that restate shipped tables and authored
  text: `forms/manifest.test.ts` (every bind), `finding-origins.test.ts` and `tool-definitions.test.ts` (action
  words, `maxItems`, description sentences; build a local origin table and assert the derived functions),
  `verdict.test.ts` chip text, `formats.test.ts` `F1`/`N2`, `view-model.test.ts` `Saving…`, sessions' `harnessText`
  and `markToastText`, `languages.test.ts`'s `@codemirror/language-data` aliases, and docs'
  `nameProblem_Rules_PinnedMessages` unless those messages are a contract.
- **One test naming style** — *agent-ready*: sentences. `Name_Case_Result` names remain in `main-api.test.ts`,
  `layout-loader.test.ts`, `layout-registry.test.ts`, `card-input.test.ts`, `which-key.test.ts`,
  `help-sections.test.ts` and `docs-state.test.ts`.
- **`$name_<suffix>` vitest titles lose their case name** — *agent-ready*: vitest reads `$name_BadId…` as one key
  `name_BadId…`, so each row's title loses its name (the repo's own note, `src/shared/fake-agent-harness.test.ts:999`).
  Three sites: `src/plugins/usage/main/drive-actions.test.ts:101` and
  `src/main/drive/drive-commands.test.ts:132` and `:153`. Fix as the note says: each row carries its whole name, and
  the title is `'$name'`. Source session: Claude Code 76f5a6f5-89a8-4d05-a525-af23402d29ad in wigley-ai-gui.
- **Hosted process reads busy with no way out** — *needs a feature plan*: a process that reads busy leaves only on a
  `result`. Reached by a background subagent's `assistant` line after `result`, then an interrupt that prints no
  `result`, then a quit: the keep window never arms, a drain never finishes, and process and host run on. A crossing
  `user` line also reads idle at the earlier `result` until the first `stream_event`, which matters only under a drain
  or a window of 0. To decide: bound the busy state while no app is connected, weighed against long silent tools, after
  measuring what Claude prints after an interrupt. Mechanism: turn state read from pipe lines
  (`src/session-host/process-table.ts`, `CLAUDE_IDLE_RULE`), stacked on twice (`73bdb0c8` ignored lists, `540fb434` busy
  lists, which the user chose as the step back). Source session: Claude Code 4c0ab18e-9221-4838-ba7b-ecfa6e43c345 in
  wigley-ai-gui.
- **One rule for returning a dropped message once** — *needs a feature plan*: `clear` silently loses a message a replay
  left held, since the row has moved to a new process when the harness reports it at close (`chat-sessions.ts` `clear`,
  `claude-code-harness.ts` close). A resume that attaches has no `returnedDrops`, so its replay returns placed messages
  again, and `takeOverSkipped` discards a skipped record's list. A message whose process ended while the app was away is
  still lost, since its attach is null. Mechanism: a per-process saved dedupe list, patched in `675e5b1c` and
  `b66b3f02`; these want one rule, not a third patch. Source session: Claude Code 4c0ab18e-9221-4838-ba7b-ecfa6e43c345
  in wigley-ai-gui.
- **Drive quit should wait on the host's actual end** — *agent-ready*: the refusal of a plain `quit` on a kept run
  checks once, before `stop`. A plain `quit` during a kept quit's hold, or one ended by SIGTERM, still deletes a run's
  folders under a live host (`scripts/drive.mts`, `removeQuitEntries`). `removeIdleRuns` can also delete a kept run's
  folder while its host runs, and `kept` means only that a home and `start.json` exist, so it covers a crashed run too.
  A bounded wait for the host to go, then a refusal, is the likely shape. Source session: Claude Code
  4c0ab18e-9221-4838-ba7b-ecfa6e43c345 in wigley-ai-gui.
- **Codex tool timeout cannot fit a wait that restarts** — *needs a feature plan*: a re-sent call gets a fresh deadline
  from the new app, so a round open before a drop costs its time plus up to 75 s plus 240 s, past `tool_timeout_sec`
  330. Stated as a limit in the forms README. To decide: carry the time left through the relay, or accept it, since
  `collect_last_round` recovers the round. Source session: Claude Code 4c0ab18e-9221-4838-ba7b-ecfa6e43c345 in
  wigley-ai-gui.
- **Two hosts on one channel** — *agent-ready*: the check-then-listen at
  `src/shared/local-channel/local-channel.ts:91-102` lets two hosts listen, and a socket file gone lets a second start
  beside a live one. Reaping is safe since `30af5c3e`, but the older host's `shutDown` can remove the newer one's socket
  and record, and the newer one renames the older's log and sweeps its pipe logs. A lock around listening and acting
  only on a record still its own are the likely shape. Stated as a limit in `docs/features/session-host/design.md`.
  Source session: Claude Code 4c0ab18e-9221-4838-ba7b-ecfa6e43c345 in wigley-ai-gui.
- **An idle harness compaction cannot be interrupted** — *needs a feature plan*: it opens no turn, so `interrupt()` does
  nothing while the chip shows compacting and `compact()` would queue a second (`src/main/claude-code/claude-code-harness.ts`).
  It cannot happen until an idle compaction is seen under the app's flags (`docs/features/agent-chat/claude-stream.md`
  § Idle compaction); measure that shape, then treat an unended compaction as busy in both calls. Source session: Claude
  Code c2cde885-2f45-42e7-ad71-cd59618615db in wigley-ai-gui.
- **Chat self-test steps by single presses** — *agent-ready*: rows draw most recent first and rows opened in one
  millisecond tie, so the chat script's single `<A-S-o>` and `<A-S-i>` steps between its two rows may land elsewhere.
  It passes today and was not audited for ties or rows left open. Forms' `stepToRow` and sessions' `stepNextTo` hold
  the shape, and could become one shared helper. Source session: Claude Code e8ba2d1d-78ea-49b9-9c2e-b2a0b2382d85 in
  wigley-ai-gui.
- **Sessions header wraps at the side bar's least width** — *agent-ready*: `Sessions` draws as `Session` / `s` at
  160 px in the default layout. Its markup predates the session groups work. Source session: Claude Code
  e8ba2d1d-78ea-49b9-9c2e-b2a0b2382d85 in wigley-ai-gui.
- **The session clock counts a machine's sleep** — *needs a feature plan*: spans are wall-clock (`src/shared/active-time.ts`),
  so a lid closed during a turn or background work adds the whole sleep to the row's run time. Fixing it needs a power
  signal in chat main, or a cap on a span's gap.
- **Side swap prompt draws over content** — *needs a decision*: `.session-pane-edge.is-left` and `.is-right` in
  `src/plugins/sessions/page/sessions.css` sit at z-index 2 with no inset, while the up and down prompts reserve one.
  In a split the prompt can cover a side pane row while hints show. The choices are an inset, which narrows the pane,
  or moving the prompt. Source session: Claude Code 38d42f6d-8deb-450b-9655-d83e50e050c4 in wigley-ai-gui.
- **Esc on a new split's Folder picker leaves an empty pane** — *agent-ready*: choosing New session then Esc on the
  Folder picker leaves the split open and empty, while Esc on Show session cancels the split. Seen in a drive run;
  whether it predates that run's work was not checked. Source session: Claude Code
  38d42f6d-8deb-450b-9655-d83e50e050c4 in wigley-ai-gui.
- **Self-test has no click step** — *agent-ready*: `SelfTestStep` drives keys and file writes only
  (`src/contracts/plugin.ts`, `src/main/selftest-runner.ts`), so a first click in an unfocused pane is proved only by
  drive runs and the `sessionsView_FocusChange_KeepsPartWithUpdate` rows. Add a click step, then a step in chat's
  `session hub` group that clicks a head in an unfocused pane and expects its collapse log. Source session: Claude Code
  368f2c4b-5d54-47bf-8285-14fec015fc6b in wigley-ai-gui.
- **A restore that finds its saved row id held opens the row under a fresh id, so its `/clear` loses the pool claim** —
  *needs a decision*: a row's id now survives a relaunch (`rowId` in `open-sessions.json`), but when another row holds
  the saved id the restore retries with a fresh one. A kept process re-attached to that row still carries the old id in
  `WIGLEY_SESSION_ROW`, so its first `/clear` starts the new process under the new id, the pool misses the handoff, and
  the claim falls back to the expiry rules (`~/wigley-agents/tools/unity-pool/README.md` § Claims). To decide: whether
  the case is rare enough to leave, or `/clear` passes the old row id to the new process.
- **Backlog `/` with no home open does nothing and leaves the letters as commands** — *agent-ready*: `openFilter` in
  `src/plugins/backlog/page/backlog-view.ts` returns silently when no home is open, so `backlog.filter` logs, no box
  opens, and the following letters run as `backlog.list` commands. Source session: Claude Code
  a65d02f6-eab9-453b-be96-34ac71d33876 in wigley-ai-gui.
- **Escape on a chat picker leaves focus off the box** — *needs a decision*: `open` in
  `src/plugins/chat/page/picker.ts` calls `blurFocusedElement()` and the `cancelled` path only logs, so after Escape
  nothing refocuses the box and the next keys go to the page until `i`. To decide: whether a cancelled step hands focus
  back to the box. Pre-existing since 80edb99c. Source session: Claude Code a65d02f6-eab9-453b-be96-34ac71d33876 in
  wigley-ai-gui.
- **Agent-lines row overflows at the side bar's least width** — *agent-ready*: `npm run selftest -- --plugin agent-lines`,
  group `working line`, fails `session-row holds 156px in 149px`: row content needs 156px at the side bar's 160px least
  width, and the header breaks `Sessions` beside its hints. The same on the base of plan-commands-and-state.
- **`[chat] session <id> closed (code 0)` after a session's close** — *needs a decision*: main's record of the turn it
  ended logs after `[chat] session closed: <label>`, by id, since the row is gone. To decide: keep it as main's record, or
  name the session from what main still holds.
- **Each chat tab draws twice per page load** — *agent-ready*: each load logs `Chat tab shown` twice and mounts each
  visual frame twice, the same on the base of plan-commands-and-state. By reading and log order, not confirmed:
  `show-layouts.ts` always calls `setLayouts` on a first load, which runs sessions' `checkVisible(true)` and chat's rebuild
  of the entries.
- **A user layout logs `layout st shown` then `layout default shown`** — *needs a decision*: `layout-loader.ts` loads
  `default` on every load and `show-layouts.ts` logs each one, though the user's layout draws. To decide: log only the
  layout in use, or log the default as loaded.
- **A terminal session's saved name is read from the app's `CLAUDE_CONFIG_DIR`** — *agent-ready*: a relay sends no
  config folder when its terminal sets no `CLAUDE_CONFIG_DIR`, and `hostSessionName` (`src/plugins/sessions/main/start.ts`)
  passes that null to `sessionName`, whose `projectsRoot` falls back to the app's own `CLAUDE_CONFIG_DIR` through
  `claudeConfigFolder` (`src/main/claude-code/claude-launch.ts`) rather than `~/.claude`. An app started from a
  personal-profile shell reads a default-profile terminal session's name from the wrong folder. The row's profile tag
  already resolves null through `AgentHarness.configFolder`, which ignores the app's environment.
- **The composer paints over the over-bars at 480px** — *needs a decision*: at a narrow window the chat composer
  draws above the side bar and right bar laid over the content (`.shell-side-bar[data-side-bar='over']` and
  `.shell-right-bar[data-right-bar='over']`, `src/renderer/shell/shell.css:193,202`, both `z-index: 1`). Since
  keyboard-reach the bars carry a key cursor, so the covered rows matter more. To decide: raise the over-bars above the
  composer, or keep the composer on top and inset the bars. Source: the keyboard-reach review (finding 32).
- **The Sessions title wraps letter by letter at the least width** — *agent-ready*: the Sessions header title
  (`src/plugins/sessions/layouts/default/layout.css:35`) has no `min-width`/`white-space` rule, so at the side bar's
  least width it breaks one letter per line beside its hints. Source: the keyboard-reach review (finding 33).
- **Backlog records area `side` while its open editor keeps the keys** — *needs a decision*: in a narrow window with
  the editor open, `sideBarOpenedOver` (`src/plugins/backlog/page/backlog-view.ts`) and `src/renderer/shell/modes.ts:142-145`
  record the focus area as `side` while the editor still holds DOM focus and the keys, so the next pane move starts
  from the wrong area. To decide: the editor keeps the area `main`, or the side bar overlay takes focus from the
  editor. Source: the keyboard-reach review (finding 34).
- **A click into the Backlog detail is pulled back to the list** — *agent-ready*: no Backlog `focusin` handler sets the
  scope, so a click into the detail pane while a right-bar stop holds the keys ends the stop's turn, and the deferred
  `focusMain` (`src/plugins/backlog/page/backlog-view.ts:986-998`) focuses `lastMainFocus`, often the list, off the
  clicked pane. Fix: a focusin on each Backlog pane records it as `lastMainFocus` (and sets the scope) before
  `focusMain` runs. Pre-existing before keyboard-reach (it ran synchronously then). Source: the keyboard-reach
  re-review.
- **Self-test `forms: cancelled preview` fails on main** — *agent-ready*: `npm run selftest -- --plugin forms`; after
  `<D-w>` closes the Layout preview session the app selects `selftest 3` (its right neighbour in main's rows) where the
  step expects `Codex session`, and the `R` and `<A-o>` steps after it fail on that. Fails the same on a plain `main`
  checkout (b72c74a3): decide whether the close picks the left neighbour or the step follows main's rows.
- **Primer `placeRestored` may restore a stale review cursor** — *agent-ready*: since keyboard-reach met hot-reload,
  `primer-state.ts`'s reducer restores a stored place without resetting the review view's `reviewRow`, so a restored
  review could hold a row past the list's end. Trace it and pin it with a row in the primer-state tests.
