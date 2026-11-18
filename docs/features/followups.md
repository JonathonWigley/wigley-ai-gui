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
- **Built-in plugin hot reload** — *needs a feature plan*: built-ins still need a rebuild to change. Reloading one
  with new code compiles TypeScript inside the running app, so a compiler ships with it (a third-party ask). The
  runtime loader's `PluginSource` seam and `reload` are the base: a third source over the repo clone.

## Bugs seen in use

Defects seen in a drive run, a transcript or the user's own use.

- **Chat self-test fails the minimum-width fit on the session tab bar** — *needs a feature plan*:
  `npm run selftest -- --plugin chat` fails 8 steps with `<keys> fits the minimum width: nav.ui-tabs.session-tabs
  holds 120px in 99px` (groups: permission round Cmd+Enter, transcript focus Enter twice, controls e and Escape,
  interrupt and close three times). It fails the same on base 46f417b5, so it predates the usage change. The session
  tab bar (`.ui-tabs.session-tabs`, `src/plugins/sessions/page/sessions.css` near line 348, with the usage line from
  `usage-tab-line` in its tab line) does not fit at the minimum width. Find what grew it (check recent commits
  touching the sessions tab bar or the usage tab line, such as 4c8a2b0b and 4b7f175a) and make the bar fit or
  scroll. Source session: Claude Code 76f5a6f5-89a8-4d05-a525-af23402d29ad in wigley-ai-gui. Needs a repro before a fix: the rule is now at `sessions/layouts/default/layout.css:397,414` and the bar was reworked since (ed63f147f, 370a47974); re-run `npm run selftest -- --plugin chat`.
- **Window adapter misses page load 1** — *agent-ready*: the window adapter numbers page loads from 1 only because both
  `electronDrivenWindow` calls (`src/main/main.ts` `createWindow`, `src/main/selftest.ts` `startSelfTest`) run in the
  same synchronous pass that starts the first load (`src/main/window.ts` `loadURL`); an `await` added between them
  shifts every load number down by one, so dev starts hold the start lock the full 10 s instead of releasing on the
  startup reload. Create the adapter before the first load, or pass it into the window factory, so the count cannot
  miss load 1 (`src/main/drive/driven-window.ts` `navigationCount`).
- **Interrupt in the gap before a message's init** — *agent-ready*: `interruptAnswered` with no turn open
  (`src/plugins/claude-code/main/turn-tracker.ts`) also closes a message after its `queued`/`started` frame and before its
  `init` — e.g. Ctrl+C in `/compact`'s gap between `started` and `init` (`agent-chat/claude-stream.md` § Message
  lifecycle) — so the session shows idle and the turn-finished mark fires, then the init shows working again. Option:
  in lifecycle mode keep a uuid whose last state was `started` open through `interruptAnswered`.
- **Terminal resume of a cleared conversation** — *needs a feature plan*: after `/clear`, the sessions list refuses
  any relay hello carrying the row's pre-clear host id while the row lives (`retiredHostIds`,
  `src/plugins/sessions/main/session-list.ts` `connect`), which is meant for the old process's late relay. A user
  resuming the pre-clear conversation in a terminal (`claude --resume <old id>`) is refused too, so its forms and
  primer tool calls fail until the cleared row ends. Options: retire the id only until the old process ends, or give
  a hello after that a plain connected row. Source session: Claude Code b8ee3503-3c04-48fc-bd7d-bc4f2ec56c17 in
  wigley-ai-gui.
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
- **One newest-wins open rule** — *agent-ready*: docs opens race each other with no shared rule: `openDoc` and `openMain` drop
  a waiting request only for a newer one of either, so a doc the user opens from the tree or a link while it waits on a
  rebuild is replaced when the rebuild lands. One open-intent sequence shared by `openDoc`, tree leaf opens and
  in-doc links, checked where the open happens, gives one newest-wins rule (`src/plugins/docs/page/docs-view.ts`
  `openDoc`, `followFile`). A path snapshot was tried and dropped: it could not tell an earlier `openDoc`'s own open
  from a user's.
- **Missed rebuild on a rules folder write** — *needs a feature plan*: in a drive run, a doc written into the temp home's
  `.claude/rules/` from outside the app started no rebuild until Rescan. Check whether the docs watches cover that
  folder or the change was debounced away (`src/plugins/docs/main/view-watches.ts`, which watches one file per view). Open: no folder or source watch exists, so decide between source-folder watches and Rescan as the route.
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

- **`/clear` then relaunch loses the row's selection** — *needs a feature plan*: select a row, `/clear` it (running or idle),
  and restart; no row is selected and the main pane says `Pick a session in the side bar`, though
  `open-sessions.json`'s `selectedHostSessionId` holds the row's new host id. A selected row with no `/clear` stays
  selected. Seen on the fake harness through a drive `restart`; the cause isn't traced, and it may be fixture-only,
  since the fake has no saved history for the new id. Needs a repro before a fix: Lane H rewrites the clear path.
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
- **A re-attach on the real harness reports `Earlier conversation not read: ENOENT`** — *needs a feature plan*: after a drive
  `restart` with `--harness claude`, the first transcript entry read that, for
  `~/.claude/projects/-tmp-claude-session-hub-p3/<id>.jsonl`; later entries stayed. The text comes from
  `src/plugins/chat/main/chat-sessions.ts`. Cause not traced: one lead is a Claude config folder other than `~/.claude`,
  which this machine's profile uses. Source session: Claude Code 368f2c4b-5d54-47bf-8285-14fec015fc6b in wigley-ai-gui. Needs a repro before a fix: a real-harness run, since Lane H rewrites the history path.
- **The `chat: visuals` self-test step failed once** — *needs a feature plan*: `v -> [visual] visual overlay showing 2 of 2`
  (`src/plugins/chat/main/selftest-script.ts`) failed in 1 of 4 filtered runs at 914024cd, with no page reload in the
  log, then passed twice under `--plugin chat` and once under the same wider filter. The cause isn't traced; a late
  rest position on the reply's last block is one lead, since `d3ca10c9` had just changed the chat cursor's band move.
  Source session: Claude Code 368f2c4b-5d54-47bf-8285-14fec015fc6b in wigley-ai-gui. Needs a repro before a fix: re-run it after the chat cursor fixes land.
- **Skills lists a slash the CLI did not recognise** — *needs a feature plan*: on the real harness, `/tiny` drew a Skills row
  `tiny main` while the agent replied that `/tiny` isn't a command in this session. The skill's file was written after
  the session started, so a loaded skill was not seen doing this. The event source is not traced; start at
  the decoder and fold (`src/plugins/claude-code/main/session-fold.ts:361`, `stream-decoder.ts:276`), not the roster. Source session: Claude Code 368f2c4b-5d54-47bf-8285-14fec015fc6b in
  wigley-ai-gui. Needs a repro before a fix: a real-harness run.
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
- **The right bar overlays the main cell at a narrow window** — *needs a feature plan*: at a narrow window the shell's right
  bar (`.shell-right-bar`, System stats; `src/renderer/shell/shell.css`, `shell-layout.ts`) overlays the mode's main
  cell instead of stacking under it or hiding. At the 420px minimum it covers the right half of Backlog (seen at x 220,
  200 wide, in the backlog launcher's live check), so the filter bar is cut off. `fit` does not report the overlap, only
  truncated cells. Fix: below the width the main cell needs, the right bar stacks or hides, as a split's stacked panes
  do; add an overlap check to `fit`. Open: the overlay is deliberate (`src/renderer/shell/shell.css:202`), so decide stack, hide or keep over.
- **Keys do nothing after a resume and send-now until the pane is refocused** — *needs repro*: seen in the Lane H
  final-verification drive run on Claude (`WIGLEY_DRIVE_HARNESS=claude`). After resuming a session and sending with
  ⌘↩ (send now), key presses did nothing until `<A-h>`/`<A-l>` moved focus to another pane and back. Not yet known
  whether Lane H caused it or whether it reproduces on a fake run. A first step is a fake drive run of resume, then
  ⌘↩, then a key that logs, reading `app.log` for the key.
- **Chatroom: an ended session's thread shows its raw `session:<row id>` label** — *agent-ready*: the side bar names a
  `session:<row id>` thread after its row (`src/plugins/chatroom/page/chatroom-state.ts:86`), and once the row is gone
  from the sessions list the thread falls back to the raw id. Fix: keep the last title seen for a row id (in the
  thread's record or the page's state) and show it, marked ended. Source session: Claude Code
  ae5bbb7a-62aa-4437-8d30-93cd8c0132e0 in ai.

## Harness seams

What a second harness — Codex, wigley-harness — and the agent settings and plugin features need.

- **The drive `wait-log` misses lines logged before it starts** — *agent-ready*: a driver waiting on a line a page
  start already logged never sees it. Read earlier lines back with `drive log`, or let `wait-log` scan the log it
  already holds.
- **Agent settings through an adapter** — *needs a feature plan*: Settings mode edits only the app's own
  `settings.json`, so changing an agent's config (Claude's model, effort, permissions, hooks, env, per profile and per
  user, project and local scope) still needs a terminal: in print mode `/config` takes only `key=value`
  (`agent-chat/claude-stream.md` § Terminal-only commands). Add an agent settings seam beside `AgentHarness`
  (`src/contracts/agent.ts`) that each harness adapter fills: the settings it declares (key, label, type, choices,
  scope, current value) and a write checked by the harness's own rules. Settings mode then draws whatever the adapter
  declares, as the Chat tab draws session controls. Claude Code is the first adapter (`src/plugins/claude-code/main/`) and
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

- **Headless off note: chat sends it, not the workflow tools** — *needs a feature plan*: turning a session's
  headless flag off reaches the agent only as a line on its next `set_workflow_step` or `set_workflow_checklist`
  result (`src/plugins/workflow/main/headless-line.ts`). Four stacked fixes in the retro-briefs run (track at tool
  start, re-seed at a host id change, `launchedHeadless` at the first result with `forget`, `launchHeadless`
  saved in `SavedSession`) still leave two gaps: a workflow main restart loses the line state, and an agent that
  calls neither workflow tool never hears the flag went off. Chosen direction: chat owns the off note and sends it
  with the user's next prompt (or on the next tool result of any kind), so the workflow tools carry no line state.
- **Clear aliases are app-wide** — *needs a decision*: `clearAliasesOf` (`src/plugins/chat/page/clear-commands.ts:70`)
  takes the union of every registered harness's `clearAliases`, and `registerAliases` (`:44`) registers each as an
  alias of `/clear` for every row. So one harness's alias clears the rows of other harnesses and shadows a native
  command of another harness with the same name. Task 12 of lane H chose this global slash-command pattern on purpose.
  Decide per-row scoping (an alias that applies only to rows of its harness) when a second harness lands.
- **The docs write guard and a `--harness claude` drive run** — *needs a decision*: in a drive run with
  `--harness claude` the guard (`guardFolders`, `src/plugins/docs/main/doc-files.ts:447-468`) admits the user's real
  `~/.claude*`, because the adapter resolves `configDir` against the agent home, and refuses a create in the run
  home's `.claude`. Options: expand each profile folder against the docs home dir (`docs/main/start.ts:104-131`), or
  settle `HarnessConfigRoots.configDir` as adapter-resolved. Either way, say which in `docs-browser/design.md`.
- **Entry renderers take precedence over a chosen or live default layout** — *needs a decision*: `pickEntryDraw`
  (`src/plugins/chat/page/chat-layouts.ts:106-122`) returns a layout's named entry first, then any renderer, and
  only then the default layout. With no renderer, `defaultBuilderKind` (`:133`) forces the builder kind to `raw`, so
  a live default layout's own `entries['<id>:<kind>']` never runs. To decide: whether the default layout's entry
  outranks a renderer, and whether the builder kind follows the layout that draws.
- **The start prompt opens nothing for a default harness that is missing or has no profiles** — *needs a decision*:
  `src/plugins/chat/page/start-prompt.ts:193-202` reports and returns unless `defaultHarness` is registered with
  profiles. That blocks the resume rows, the recents and the projects of every other harness. To decide: whether the
  prompt falls back to the first harness that declares profiles, or shows the sections of each harness.
- **A clear alias dropped for a conflicting command does not return when that command goes** — *agent-ready*:
  `addAlias` (`src/plugins/chat/page/clear-commands.ts:31-43`) drops an alias whose name another command holds, and
  `registerAliases` runs only on a `core.agentHarnesses` change (`:56`). When the conflicting command is disposed,
  the alias stays gone until the next harness change. Re-run `registerAliases` when the conflicting command is
  disposed.
- **Claude Code's `configRoots(null)` and `installedPlugins(null)` ignore `CLAUDE_CONFIG_DIR`** — *needs a decision*:
  both resolve a null profile through `defaultConfigFolder`
  (`src/plugins/claude-code/main/claude-code-harness.ts:1292-1296`, `:1358-1359`), while the sessions' launch env
  honours an inherited `CLAUDE_CONFIG_DIR` (`claude-launch.ts:123`). Decide whether the contract's `configDir` follows
  the launch env (the docs guard and the plugin list then read the folder the sessions use) or stays the default
  folder.
- **Chat's host-id → process-id map lives one chat run** — *needs a decision*: `processIdsOfHost`
  (`src/plugins/chat/main/chat-sessions.ts:829`, read at `:3779`) is filled at `adoptHostId`, attach and restore. After
  a page reload resume falls back to the `${hostSessionId}-` prefix, so a row-prefixed process left running unheld, or
  one never saved before a crash, still gets a second `--resume`. Options: persist the map in chat's data, or have the
  session host record the conversation id per hosted process (a contract change). Also, `adoptHostId` moving a row
  from host id X to Y with no pending clear could delete the stale X entry (`:1854-1856`).
- **Pending plans name removed symbols** — *agent-ready*: re-read these before running them.
  `intent-alignment/plan-lane-e-extension-points/06-forms-kinds-main.md` and `08-finding-origins.md` use `arraySchema`
  and `argsErrorName`, which lane H replaced with `describe()` and `argsErrorText`. Update each plan to the landed names
  before `wigley:make` runs it.
- **`AgentHarnessRegistry.register` pushes the harness before it calls `info()`** — *agent-ready*:
  `src/main/agent-harness-registry.ts:75` pushes to `harnesses`, then `setChangedEntries` (`:52-53`) runs
  `computeEntries` (`:20-23`), which calls `info()`. A throwing `info()` leaves the harness listed with no slot key.
  Compute the entries first, and push once they succeed.
- **The sessions sidebar does not redraw on a `core.agentHarnesses` change** — *agent-ready*:
  `src/plugins/sessions/page/sidebar-view.ts:431-434` reads `harnessLabel(harnesses(), …)` at each draw only, so a row
  drawn before a harness registers keeps its raw id label until the row next redraws. Redraw the rows on the slot's
  change.
- **`harnessToolUseId` lets a relay without a `harness` field past the `mainAgentOnly` guard** — *needs a decision*:
  `harnessToolUseId` (`src/plugins/sessions/main/start.ts:84-90`) returns null when the session's `info.harness` is
  null, and `callerGuard` (`src/plugins/chat/main/tool-callers.ts:109-111`) runs a call whose tool-use id is null. A
  relay that predates the `harness` field therefore bypasses the `mainAgentOnly` guard. Decide whether a null harness
  falls back to the app's default harness, or the guard refuses the call.

## Platform and packaging

What Windows support and installers need.

- **Session host starts a claude shim on Windows** — *needs a feature plan*: the session host process's own spawn
  starts `claude` unwrapped, so a `claude-code.command` set to an npm `claude.cmd` cannot start a session, and the
  PATH lookup looks only for `claude.exe`. The fix puts the session host's adapters (`src/session-host/`) behind the
  same shim handling, then lets the Windows lookup find shims. Killing a shim's `cmd.exe` also leaves its child
  running, as `run` does today.
- **A `.cmd` shim re-parses its arguments once more** — *needs a decision*: `shimLaunch`
  (`src/shared/program-lookup.ts`) escapes cmd metacharacters once. cross-spawn 7.0.6 escapes twice for a `.cmd`
  under `node_modules\.bin` (`lib/parse.js` `needsDoubleEscapeMetaChars`, checked), because a cmd-shim batch file
  re-parses `%*`. The open question is whether that re-parse breaks this code's single escape (the BatBadBut class);
  the theory, unchecked, is that it matters only when a setting or a bare name resolves to an npm `.cmd` shim and an
  argument holds cmd metacharacters. Options: escape twice for every `.cmd` shim, or refuse `"` in arguments as the
  line-break refusal does. Check cmd's parse rules first.
- **Packaging and installers** — *needs a feature plan*: installers for macOS and Windows (`forge.config.mts` has only
  `packagerConfig`, no makers).
- **Stable signing identity on macOS** — *needs a feature plan*: an agent session lost all access to `~/Documents`
  (`Operation not permitted`) right after the stable app relaunched, and regained it once the user changed the macOS
  privacy setting. The likely cause, not yet confirmed, is that the app is ad hoc signed with no team ID, so macOS
  ties the folder permission to one build and each `npm run install-app` can drop it for every running agent. Confirm
  the cause, then decide which signing identity `install-app` uses.
- **The app install waits while `main` holds half-finished work** — *needs a feature plan*: a half-finished state on `main`,
  such as an in-progress merge, blocks `npm run install-app`: one install rebuilt mid-merge and broke. Make the
  install wait until `main` is clean of it. Open: `scripts/install-app.mts` packages a committed ref and never reads working-tree or merge state, so the observed failure and what "wait" means need settling first.
- **Native window vibrancy** — *needs a feature plan*: macOS `vibrancy` and Windows 11 mica behind a window adapter,
  in place of the CSS backdrop under L1 glass (`docs/features/ui-design/design.md`).
- **Scheduled tasks start at login on Windows** — *needs a feature plan*: the session host starts at login only on
  macOS, so on Windows a scheduled task does not fire after a restart until the app opens. It needs a launcher outside
  the `app-*` build folders that sets `ELECTRON_RUN_AS_NODE` and starts the host, and a Windows `LoginStart` adapter
  behind `src/contracts/login-start.ts`.
- **A shareable build without the user's workflow** — *needs a feature plan*: the user wants to give the app to other
  people with every reusable tool and none of the user's workflow. The workflow is interview, plan, make, review and
  retro: the plugins `workflow-large`, `workflow-medium`, `workflow-small`, `workflow-spike`, `auto-retro` and
  `primer`. Being a wigley part does not make a tool part of the workflow. Sessions, chat, unity-pool, the audio
  picker, live view, usage, system stats, docs, notes, settings and keys all stay. A review of the plugins' `dependsOn`
  and `reads` found no reusable plugin with a hard dependency on a workflow plugin. The gaps are these:
  - The agent tools reach the app only through `relay.py`, and only the `wigley` marketplace plugin registers it (as
    the `wigley-forms` MCP server). That plugin also ships every workflow skill. Without it, chat works but forms,
    `set_session_title`, `start_session`, the audio picker, live view and the backlog and practice tools are missing.
    Options: move the relay into its own marketplace plugin, or have the `claude-code` adapter pass `--mcp-config`
    to the sessions the app starts. Sessions started in a terminal still need a plugin.
  - `docs` finds `docs_index.py` through the installed `wigley@wigley-ai-marketplace` plugin (`script-locator.ts`). It
    also fixes the wiki root at `~/wigley-agents/wiki/Main.md` (`doc-files.ts`), and `kinds.ts` fixes the
    `wigley-agents` folder and the user's file-placement rules. These become settings, and the index script ships
    with the app or with the relay's plugin.
  - The `forms` tool text points agents at `~/wigley-agents/forms.md` (`tool-definitions.ts`, `question-format.ts`),
    which another user does not have.
  - `notes` lists `backlog` in `dependsOn.main`, so notes cannot run without backlog. Backlog reads the follow-up files
    that review writes. Decide whether backlog stays. If it goes, invert the link: backlog registers a note target into
    notes.
  - `auto-compact` imports `workflow/contract` and reads `workflow.flows`. A disabled `workflow` is safe. A deleted one
    breaks the build.
  - `unity-pool` runs `~/wigley-agents/tools/unity-pool/unity-pool`, so the tool ships with the app.
  - `app-update` installs from the user's clone's `origin/main`. Another user needs a fork of their own.
  - `src/shared/plan-progress.ts` and `plan-copies.ts` are used only by `workflow-large`. They move into that plugin.
  - The app lives in the `ai` repo beside `wigley-agents`, and its `AGENTS.md` points at the user's rules and skills.
    A shared copy needs its own repo and a neutral `AGENTS.md`.

  Decisions for the plan: disable the workflow plugins by default (`plugins.disabled`) or remove them from the build
  (the folder and its entries in `src/plugins/manifests.ts`, `main.ts`, `page.ts` and `keymap.ts`; `npm run lint`
  flags a missed entry); whether `workflow` (the engine) and `backlog` stay; and where the relay lives. A build with
  the workflow folders deleted was not tried. Source session: Claude Code a20096e5-768a-4100-9290-f3696e2c4543 in
  `~/Documents/ai`.

## Plugin extension points

Closed lists that become registrations, so a plugin adds what is hardcoded today.

- **View and interaction behaviours as switchable plugins** — *needs a feature plan*: behaviours such as
  `chat.completionDescriptions` and `keys.showHints` could ship as plugins the user switches on and off, rather than as
  settings inside the plugin they change. The live enable switch exists, so the split costs only the plugin boundary.
- **Layout hot reload keeps the user's place** — *agent-ready*: `round-view.ts` `rebuild` (run by `setLayouts` when a
  reload changes a layout it draws with, by a card part or review column added or disposed, and by a page kind
  registered or disposed) destroys and
  remounts every box. It focuses the focused box again (`keepFocusedBox`), in insert mode at the text's end when it
  was inserting, and keeps the main column's scroll, but loses the cursor, a visual mode and undo. Move its boxes to
  `EditorBoxes.place` and `release` (`src/shared/page/editor-boxes.ts`), as the primer, practice and the audio picker
  do, so a redraw keeps each box's editor. Redraw only the parts whose layout pick changed: compare each card's,
  notice card's and pane's pick (name and layout object) with the last draw's, in place of `setLayouts`' one
  `picksEqual` over the whole round, and redraw each changed part alone in its place (task 13 of the Lane L plan,
  `changedPicks`). Forms is the owner this covers: chat's composer keeps its box and draft across a redraw, and docs'
  doc pane redraws its frame only after the editor closes.
- **A finding origin registered only in main draws with the `caused` actions** — *needs a feature plan*: the page draws
  an origin it has no registration for with the `caused` card's fields and actions (`drawnOriginSpec`,
  `src/plugins/forms/page/kinds/finding/verdict.ts:36-55`). Main checks the user's pick against its own spec for that
  origin (`findingResult`, `src/plugins/forms/main/kinds/finding/finding-format.ts:686`), so a pick that main's spec
  lacks comes back untouched. Option: send the origin's action words with the round, so the page draws main's
  actions.
- **A broken plugin kind decode blocks its round** — *agent-ready*: `decodeAnswers`
  (`src/plugins/forms/page/round-draft.ts:60-81`) calls a plugin kind's `restore.decode` with no guard. A decode that
  throws propagates out of `restoreRound` into the reducer, and one that returns a non-array fails on `.length` as a
  bare TypeError. Either keeps the round from opening. Catch the failure, log it with the kind id, and start that
  kind's draft empty, as the wrong-count path does.
- **The proof description words every proof-requiring origin as the Nit's** — *agent-ready*:
  `src/plugins/forms/main/kinds/finding/finding-format.ts:144` says the proof is "why it cannot happen" for every
  origin whose spec requires proof. A plugin origin with another reading of proof gets the Nit's wording. Take the
  sentence from the spec, as the proof titles already are.
- **`ask_round` still names three item kinds** — *agent-ready*: its description says "question, finding or notice, and
  may carry any mix of the three" (`src/plugins/forms/main/tool-definitions.ts:53`), also when plugin kinds are
  registered. Build that sentence from the registered kinds.
- **A round submitted while a kind's plugin is off drops that kind's answers silently** — *agent-ready*: Lane E's live
  session (task 12, check 16) answered a plugin `poll` item, switched its plugin off, and sent the round. The poll
  answer was missing from the result, and nothing told the user. The round view hides a departed kind's items and
  keeps its draft entries only in the body (`rederiveRound`, `src/plugins/forms/page/round-draft.ts`). Options: name
  the held items in the send confirmation, or refuse to send while a round holds an answered item whose kind is gone.

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
- **Ctrl+j/k cursor keys in the remaining list views** — *needs a feature plan*: `<C-j>`/`<C-k>` are bound for primer, chat,
  workflow, forms, docs, backlog and gallery (`src/plugins/keymap.ts`). Still missing: settings sections and rows, the
  chat, docs and settings pickers, and the chat session list. `Ctrl+j`/`Ctrl+k` move the cursor a line and
  `Ctrl+Shift+j`/`Ctrl+Shift+k` half a page, so the scroll keys (`docs/keymap.md`, Layers) reach every view. Open: pickers have no half-page commands, so the `Ctrl+Shift` keys need new commands, and new keys are the user's call.
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
- **An image, video, HTML and artifact viewer** — *needs a feature plan*: a viewer in the app, so a render or page
  the agent asks the user to look at is visible inside the gui.
- **Chatroom: resolve a thread from the viewer** — *needs a feature plan*: the room service has `resolveThread`
  (`src/plugins/chatroom/main/room-service.ts:1147`) but nothing calls it, so a thread stays open for good. Plan the
  viewer action (key, confirm, how a resolved thread lists and whether a new post reopens it) and an agent tool if
  agents should resolve their own. Source session: Claude Code ae5bbb7a-62aa-4437-8d30-93cd8c0132e0 in ai.
- **Chatroom: wake a restored session that has not started** — *needs a feature plan*: delivery counts a row as idle
  only when its process runs (`src/plugins/chatroom/main/delivery.ts`), so a row restored at app start and never
  started rests, and a message to it waits until the user starts it. Waking it means starting its process, which needs
  chat to expose "never started since the app opened" apart from "stopped by the user" (a stopped row must stay
  resting). Source session: Claude Code ae5bbb7a-62aa-4437-8d30-93cd8c0132e0 in ai.

## Code cleanup

Duplication and drift with no user-visible defect.

- **Split subscribes to its width key** — *agent-ready*: `Split` (`src/shared/page/ui/split.ts`) subscribes to its
  ui-state key instead of each owner calling `reloadWidth()` when shown (the shell, docs' session tree, forms' rail,
  the primer's two splits), so a new split owner cannot forget it.
- **Forms' cancel confirm through the forms layout** — *agent-ready*: the forms cancel confirm passes neither
  `drawFrame` nor `drawBody` to `createConfirmPrompt` (`src/plugins/forms/page/forms-view.ts`), so its frame and body
  are drawn in code; the primer, the audio picker, practice and the session stash already draw theirs through
  `dialogFrame` and `confirmBody`. Add those two parts to the forms layout contract and `default` layout and pass
  both hooks, as `src/plugins/primer/page/primer-view.ts` does. Then drop "the cancel dialog" from what AGENTS.md
  § A forms layout says the app keeps.
- **Forms column chrome through the forms layout** — *agent-ready*: forms' rail head, item pager and rail foot
  (`src/plugins/forms/page/round-view.ts`), and the status line in it (`createStatusLine`,
  `src/shared/page/status-line.ts`), are built in code. Add their parts to the forms layout contract and `default`
  layout, as the primer's column strips (`tasksHead`, `itemsHead`, `tasksFoot`, `cardEdge`, `reviewFooter`) are.
- **ownsRoot helper** — *agent-ready*: "a `repo` or `features` entry owns its root" is spelled inline in four places;
  one `ownsRoot(entry)` beside `isKnownSource` gives it one home (`src/plugins/docs/tree.ts` `buildTree`,
  `path-guard.ts`, `page/docs-state.ts`, `index-document.ts`).
- **Saved outcomes from one list** — *agent-ready*: `isSavedOutcome` (`src/shared/agent-forms/form-store.ts`)
  hard-codes `'open' | 'submitted' | 'cancelled'` beside the `SavedOutcome` type; derive both from one
  `SAVED_OUTCOMES` const.
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
- **The LaunchAgent login adapter has no caller** — *needs a feature plan*:
  `src/main/login-start/launch-agent-login-start.ts` is built and tested, but `main.ts` picks only the agentService
  adapter. Either wire it as a runtime fallback when agentService reports not-found or a failure (the scheduled-tasks
  design's § Login start's intent), or delete it. Source: the scheduled-tasks review, lane p2 finding 1.
- **Scheduling's main part holds its queue rules in one closure** — *needs a feature plan*:
  `src/plugins/scheduling/main/start.ts` holds queue building, adoption outcomes and run-row marks together, and they
  are testable only through the whole part with six fakes. The proposal is to carve `main/run-queue.ts` with `prepare`
  passed in, tested by table. Source: the scheduled-tasks review, lane p3 finding 4.
- **Scheduling offers the first harness's controls, not the task profile's harness's** — *needs a feature plan*:
  chat runs several harnesses since Lane H, but `controlsHarness` in `src/plugins/scheduling/main/start.ts` hands the
  Schedules editor and the task tools the first registered harness's `startControls` and `capControls`, whatever
  harness declares the task's profile. With Claude Code the only real harness the two agree, and a run still rejects a
  control its own harness lacks (chat's `prepareLaunch`). A second harness needs the editor and tools to read the
  controls of the profile's harness (chat's `harnessOfProfile` in `src/plugins/chat/main/lookups.ts`). Source: the
  merge of main into `scheduled-tasks-plan`.
- **One `isStringOrNull` in `src/shared/json.ts`** — *agent-ready*: four copies exist —
  `src/plugins/chatroom/contract.ts:56` (exported type guard), `src/plugins/notes/draft.ts:33` (type guard),
  `src/plugins/workflow-large/contract.ts:197` and `src/plugins/workflow/main/flow-store.ts:278` (both `boolean`).
  Move the type guard into `src/shared/json.ts` beside `isJsonObject` and point every copy at it. Source session:
  Claude Code ae5bbb7a-62aa-4437-8d30-93cd8c0132e0 in ai.

## Latent defects and tests

Defects with no path to the user today, checks waiting on a live window, and test cleanup. Test cleanup goes last
because the earlier items rewrite many of these tests anyway.

- **The hosted busy rule lacks the adapter's interrupt rescues** — *needs a feature plan*: the host's busy reading
  (`src/session-host/process-table.ts`, `CLAUDE_IDLE_RULE` in `src/plugins/claude-code/main/claude-launch.ts`) now has
  turn-tracker's no-lifecycle fallback. It still lacks the close of every open message on an interrupt reply when no
  turn is open, and the 5 s interrupt abandon (`claude-stream.md` § Interrupt; `turn-tracker.ts`). Source: the
  scheduled-tasks review, lane c1 finding 2 and lane p1 finding 3.
- **A drain can still cut a late report turn** — *needs a feature plan*: the drain grace (`DRAIN_REPORT_GRACE_MS`,
  10 s, re-armed by each main stdout line) counts from Claude's last line before the first token. A first token later
  than 10 s still closes stdin before the turn reads busy. Whether Claude finishes a turn it has begun after stdin
  closes is unchecked. Source: the review's round-3 report, finding 1 (`process-table.ts`).
- **A run in a draining older host loses its real exit** — *needs a feature plan*: after a protocol bump, an imported
  run still running in the older host gets the host-death exit. Its history reads finished while its turn runs, and a
  message on its resting row resumes beside the running process. Tracking the older host by pid was tried and stepped
  back, because forgotten runs came back through the kept runs file (the in-memory `importedIds`). A fix needs the
  forgotten ids persisted, or `forgetRuns` sent to the older host. Source: review lane c1 finding 5, lane r2-c1
  finding 1; `session-host/design.md` § Older hosts.
- **A listed run can be marked finished while its first turn runs** — *needs a feature plan*: in the adoption of
  `src/plugins/scheduling/main/start.ts`, a run handled as `listed` on an attached row that reads idle counts as
  finished at adoption. Chat opens an adopted row idle (`busy: false`, `chat-sessions.ts` around :723, :1742, :1762)
  until a replayed activity event (:1546). A run fired during a re-plan's read can therefore get its done mark early.
  It is unchecked whether Claude's replay of a near-empty pipe log emits `working`. Source: the fix-X2 worker report.
- **A run on an unheld row stays running** — *needs a feature plan*: a scheduled run whose row rests unheld (the host
  list rejected, or a process in an older host) stays `running` in history until the row is re-attached and its turn
  ends, the row is removed, or the app restarts. The evidence does not show a clear rule for when such a run counts as
  done, so the fix starts with that choice. Source: review lane r2-c2 finding 2 (`scheduling/main/start.ts`).
- **Offline calls are dropped on a row whose callers are not noted** — *needs a feature plan*: on an unheld row, or a
  row with an unknown profile, adopt reads no history. Each replayed main-agent-only call is skipped, and
  `replayCalls` then deletes the calls file (`src/plugins/sessions/main/offline-calls.ts`). Source: review lane c5a
  finding 8.
- **Pool watch's missed-change read can drop a new pool** — *agent-ready*: in
  `src/plugins/unity-pool/main/pool-watch.ts`, an `onMissed` `readPools` can settle after a newer per-folder read and
  drop the pool that read added. A per-folder read number checked before `drop` would close it. Source: review lane
  c5b finding 3.
- **The Schedules page's pending title-context replay may be dead** — *agent-ready*: in
  `src/plugins/scheduling/page/start.ts`, the `pending.context` replay after `modes.add` never sees a non-null context
  in today's start order, so its test (`page/start.test.ts`, the F17 assertion) cannot fail. Prove it dead and remove
  it, or make the test reach it. Source: the review's round-3 report, finding 4.
- **A confirm prompt's scrim and anchors outlive the part that opened it** — *agent-ready*: `ConfirmPrompt` has no
  `dispose`, and primer discards the Disposable its overlay contribution returns
  (`src/plugins/primer/page/primer-view.ts`, the cancel prompt). When the primer part stops with the prompt open, the scrim and the Keep/Cancel key anchors stay.
  Give `ConfirmPrompt` a `dispose` and have each of its 4 callers (forms among them) dispose it, and the overlay
  contribution, with the part. Pre-existing: found by the Lane L review (#30).
- **Old plugin revisions are deleted on the launch path** — *agent-ready*: in
  `src/main/plugin-catalog/user-folder-source.ts` the `loadAll` sweep deletes the whole code folders of plugins that
  are gone (their revisions included), and `nextRevision` deletes a plugin's earlier revisions before its first copy
  this launch. The catalog start awaits `loadAll` (`src/main/main.ts`). The first launch after this change deletes
  every revision ever made (each a full copy with `node_modules`); later launches delete one launch's worth. Measure the first-launch cost, and if it is noticeable,
  run the deletes after `loadAll` returns.
- **A refused review click returns focus to the assistant pane's frame, not its ask box** — *needs a feature plan*
  (it adds a seam): in `src/plugins/backlog/page/backlog-view.ts` (844-849) a click into the review with no row
  selected, while the assistant holds the keys, calls `pane.element.focus()`. In the real pane that is the
  `scoped-agents-pane` body (`src/plugins/scoped-agents/page/agent-pane.ts`, 98-99 and 382), while the assistant's
  keys act in the ask box editor (`askBox.editor.focus`, 160-161) or the chat mount. A user typing in the ask box who
  clicks the empty review loses the caret. The `AgentPane` contract (`src/plugins/scoped-agents/contract.ts`, 96-108)
  has no member that returns DOM focus to where the pane's keys act; the fix is one (for example running
  `holdKeys(true)`), and the view test's fake should then assert that element. Test gap: the backlog view test's fake
  `pushScope` returns an `onBaseChanged` that never fires (`backlog-view.test.ts`, 353 and 362), so a box-close chain
  through a scope change is not modelled; a fake that fires it on `setScope` would.
- **`channelMayHaveListener` has no connect timeout** — *agent-ready*: in `scripts/drive-runs.mts` the socket connect
  has no timeout, and the check now runs every 250 ms in `waitForHostEnd` and once per idle run on every start. A
  connect that neither connects nor errors (a Windows named pipe is the likelier case) would hang the drive. Give the
  connect a timeout that answers "no listener". Pre-existing.
- **`removeExtraTask` never clamps `reviewRow`** — *agent-ready*: `removeExtraTask` in
  `src/plugins/primer/page/primer-state.ts` leaves `reviewRow` as it was, so the live state can hold a cursor past
  the last review row until the next `openReview` or restore clamps it. First check whether any path shows the review
  without `openReview` (for example a confirm Cancel back to the review); if one does, clamp in `removeExtraTask`.
  Pre-existing.
- **A reload can stop a main part as a `restart` that never restarts** — *needs a feature plan*: `reloadRunning`
  (`src/main/plugins/plugin-switch.ts`) picks each stop's `PartStop` before it knows whether a start follows.
  `removeMain(id, 'restart')` stops the old main part as a `restart` even when the new version has no main part. The
  handler-check fallback stops the new part as a `restart` whenever the last good version has a main part, but
  `restoreLastGood` starts it only while the config store admits that version. A part told `restart` keeps state for
  a successor. Chat keeps its rows until `KEPT_SESSION_MS` expires them. Decide whether the stop kind is settled
  after the start is known, or whether a `restart` with no successor is part of the contract.
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
- **`Git.commitPaths` has no caller** — *agent-ready*: `Git.commitPaths` (`src/contracts/git.ts`,
  `src/main/git/process-git.ts`) is called only from tests now that Backlog's Commit is gone, and `AGENTS.md`'s git
  adapter entry still lists "a commit of named paths only". Remove the method, its adapter, its tests and the
  AGENTS.md mention, or name the next caller.
- **A hand-back's join counts one step short** — *agent-ready*: in `src/plugins/claude-code/main/stream-decoder.ts`, a
  non-empty turn right after a hand-back result puts its init in the hand-back turn's events entry, so its divider
  counts one step fewer; a second hand-back right after the first does the same. Key the join on the next result
  being empty rather than on the init.
- **The live quit hold has no cap** — *needs a decision*: a main part whose dispose never settles makes the app
  quittable only by force-quit, and the `quit is waiting on …` log goes to stderr only. The plan ruled that a second
  quit holds. Options: a second quit exits in a live run, or a long cap after the log.
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
- **Withdrawn tools reach live hosts late** — *needs a feature plan*: at a stop, withdrawn tools and shrinking tool lists need
  to reach live hosts before `relay.close`, and the relay's second notice arrives only on the host's next `tools/call`. Open: this states a requirement, not a fix, so decide how withdrawn tools reach a host before `relay.close` (`src/plugins/sessions/main/start.ts:321`, `mcp/mcp-server.ts:59`); re-read after Lane H.
- **A stop drops unsaved text** — notes' popup and a forms draft lose what the user typed when their part stops. A
  switch-off asks `mayStop` first and refuses while their text is unsaved or a round is open, so a restart (drive-only) is the stop that still
  drops it.
- **A pushed scope after its host is disposed** — `PushedScope.pop` throws after host disposal (notes popup, rename
  dialog, settings view), and `keys.setScope` leaves its base behind. Same trigger as the item above.
- **A disposed layout preview still opens** — after `dispose`, the layout preview's `show` can open a preview, because
  it does not check. Make a disposed service refuse, as `track` does for a registration made after the stop.
- **A throwing teardown step skips the rest** — *agent-ready*: these remain plain sequences: chat's `detachAll` (a
  throwing `detach` or `kill` cannot happen today) and the sessions tabs view's
  `drop`, `disposeText` and `disposeTabs` (`sessions/page/session-tabs-view.ts:299,306,660`), where a throw leaves a half-disposed frame in the map. Run the remaining steps
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
- **One test naming style** — *agent-ready*: sentences. `Name_Case_Result` names remain in `main/plugins/main-api.test.ts` and
  `docs/page/docs-state.test.ts`.
- **`$name_<suffix>` vitest titles lose their case name** — *agent-ready*: vitest reads `$name_BadId…` as one key
  `name_BadId…`, so each row's title loses its name (the repo's own note, `src/shared/fake-agent-harness.test.ts:1014`).
  Three sites: `src/plugins/usage/main/drive-actions.test.ts:101` and
  `src/main/drive/drive-commands.test.ts:132` and `:153`. Fix as the note says: each row carries its whole name, and
  the title is `'$name'`. Source session: Claude Code 76f5a6f5-89a8-4d05-a525-af23402d29ad in wigley-ai-gui.
- **One rule for returning a dropped message once** — *needs a feature plan*: `clear` silently loses a message a replay
  left held, since the row has moved to a new process when the harness reports it at close (`chat-sessions.ts` `clear`,
  `claude-code-harness.ts` close). A resume that attaches has no `returnedDrops`, so its replay returns placed messages
  again, and `takeOverSkipped` discards a skipped record's list. A message whose process ended while the app was away is
  still lost, since its attach is null. Mechanism: a per-process saved dedupe list, patched in `675e5b1c` and
  `b66b3f02`; these want one rule, not a third patch. Source session: Claude Code 4c0ab18e-9221-4838-ba7b-ecfa6e43c345
  in wigley-ai-gui.
- **Codex tool timeout cannot fit a wait that restarts** — *needs a feature plan*: a re-sent call gets a fresh deadline
  from the new app, so a round open before a drop costs its time plus up to 75 s plus 240 s, past `tool_timeout_sec`
  330. Stated as a limit in the forms README. To decide: carry the time left through the relay, or accept it, since
  `collect_last_round` recovers the round. Source session: Claude Code 4c0ab18e-9221-4838-ba7b-ecfa6e43c345 in
  wigley-ai-gui.
- **An idle harness compaction cannot be interrupted** — *needs a feature plan*: it opens no turn, so `interrupt()` does
  nothing while the chip shows compacting and `compact()` would queue a second (`src/plugins/claude-code/main/claude-code-harness.ts`).
  It cannot happen until an idle compaction is seen under the app's flags (`docs/features/agent-chat/claude-stream.md`
  § Idle compaction); measure that shape, then treat an unended compaction as busy in both calls. Source session: Claude
  Code c2cde885-2f45-42e7-ad71-cd59618615db in wigley-ai-gui.
- **Chat self-test steps by single presses** — *agent-ready*: rows draw most recent first and rows opened in one
  millisecond tie, so the chat script's single `<A-S-o>` and `<A-S-i>` steps between its two rows may land elsewhere.
  It passes today and was not audited for ties or rows left open. Forms' `stepToRow` and sessions' `stepNextTo` hold
  the shape, and could become one shared helper. Source session: Claude Code e8ba2d1d-78ea-49b9-9c2e-b2a0b2382d85 in
  wigley-ai-gui.
- **The session clock counts a machine's sleep** — *needs a feature plan*: spans are wall-clock (`src/shared/active-time.ts`),
  so a lid closed during a turn or background work adds the whole sleep to the row's run time. Fixing it needs a power
  signal in chat main, or a cap on a span's gap.
- **Side swap prompt draws over content** — *needs a decision*: `.session-pane-edge.is-left` and `.is-right` in
  `src/plugins/sessions/page/sessions.css` sit at z-index 2 with no inset, while the up and down prompts reserve one.
  In a split the prompt can cover a side pane row while hints show. The choices are an inset, which narrows the pane,
  or moving the prompt. Source session: Claude Code 38d42f6d-8deb-450b-9655-d83e50e050c4 in wigley-ai-gui.
- **Esc on a new split's Folder picker leaves an empty pane** — *needs a feature plan*: choosing New session then Esc on the
  Folder picker leaves the split open and empty, while Esc on Show session cancels the split. Seen in a drive run;
  whether it predates that run's work was not checked. `docs/features/chat-panes/design.md` § Splitting, the picker
  and closing chooses this on purpose (the pane stays empty with "Pick a session", and `Alt+w` closes it), so closing
  the pane overturns a design choice: the user's call. A drafted fix (chat publishes `chat.startPromptCancelled`;
  sessions closes the still-empty split pane) was written in the 2026-11-17 follow-ups sweep. Source session: Claude Code
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
- **Escape on a chat picker leaves focus off the box** — *needs a decision*: `open` in
  `src/plugins/chat/page/picker.ts` calls `blurFocusedElement()` and the `cancelled` path only logs, so after Escape
  nothing refocuses the box and the next keys go to the page until `i`. To decide: whether a cancelled step hands focus
  back to the box. Pre-existing since 80edb99c. Source session: Claude Code a65d02f6-eab9-453b-be96-34ac71d33876 in
  wigley-ai-gui.
- **`[chat] session <id> closed (code 0)` after a session's close** — *needs a decision*: main's record of the turn it
  ended logs after `[chat] session closed: <label>`, by id, since the row is gone. To decide: keep it as main's record, or
  name the session from what main still holds.
- **Each chat tab draws twice per page load** — *needs a feature plan*: each load logs `Chat tab shown` twice and mounts each
  visual frame twice, the same on the base of plan-commands-and-state. By reading and log order, not confirmed:
  `show-layouts.ts` always calls `setLayouts` on a first load, which runs sessions' `checkVisible(true)` and chat's rebuild
  of the entries. Needs a repro before a fix: the double draw is unconfirmed.
- **A user layout logs `layout st shown` then `layout default shown`** — *needs a decision*: `layout-loader.ts` loads
  `default` on every load and `show-layouts.ts` logs each one, though the user's layout draws. To decide: log only the
  layout in use, or log the default as loaded.
- **A terminal session's saved name is read from the app's `CLAUDE_CONFIG_DIR`** — *agent-ready*: a relay sends no
  config folder when its terminal sets no `CLAUDE_CONFIG_DIR`, and `hostSessionName` (`src/plugins/sessions/main/start.ts`)
  passes that null to `sessionName`, whose `projectsRoot` falls back to the app's own `CLAUDE_CONFIG_DIR` through
  `claudeConfigFolder` (`src/plugins/claude-code/main/claude-launch.ts`) rather than `~/.claude`. An app started from a
  personal-profile shell reads a default-profile terminal session's name from the wrong folder. The row's profile tag
  already resolves null through `AgentHarness.configFolder`, which ignores the app's environment.
- **The composer paints over the over-bars at 480px** — *needs a decision*: at a narrow window the chat composer
  draws above the side bar and right bar laid over the content (`.shell-side-bar[data-side-bar='over']` and
  `.shell-right-bar[data-right-bar='over']`, `src/renderer/shell/shell.css:193,202`, both `z-index: 1`). Since
  keyboard-reach the bars carry a key cursor, so the covered rows matter more. To decide: raise the over-bars above the
  composer, or keep the composer on top and inset the bars. Source: the keyboard-reach review (finding 32).
- **Self-test `forms: cancelled preview` fails on main** — *needs a feature plan*: `npm run selftest -- --plugin forms`; after
  `<D-w>` closes the Layout preview session the app selects `selftest 3` (its right neighbour in main's rows) where the
  step expects `Codex session`, and the `R` and `<A-o>` steps after it fail on that. Fails the same on a plain `main`
  checkout (b72c74a3): decide whether the close picks the left neighbour or the step follows main's rows. Open: that choice (`src/plugins/forms/main/selftest-script.ts:770-790`).
- **Windows live view under mixed-DPI monitors** — `src/main/screen-capture/windows-window-list.ts` converts each
  window's pixel rect to points with that window's own DPI (pixels x 96 / dpi). On a desktop whose monitors have
  different DPIs, the point ranges of the monitors can overlap. Live view's window pick (`pickEditorWindow`,
  `src/plugins/live-view/window-pick.ts`) then compares that rect with the Game View rect Unity reports, and the
  coordinate space of Unity's Windows `screenPosition` on mixed DPI is unproven. What closes it: a Windows run on a
  mixed-DPI desktop with the Game View on the non-primary monitor, comparing the two rects. If they disagree, convert
  both to one space, for example physical pixels through per-monitor DPI awareness. Source session: Claude Code
  8bbb8a20-7952-4e78-af3b-888ed8197fde in new-games-prototypes.
- **The harness-return self-test never re-attaches and leaves a detached fake per run** — *agent-ready*:
  `runHarnessReturn` (`src/plugins/chat/main/selftest-script.ts:1602`) detaches the fake harness's processes, but they
  are not on the session host, so the return finds none to re-attach and the re-attach path goes untested. Each run
  also leaves one detached fake record in the fake's records (`record.detached`,
  `src/shared/fake-agent-harness.ts:2063`). Add an end API to `fake-agent-harness.ts` for the self-test to call, and
  host the fake's processes on the session host so the return attaches.
- **A reload restores the wrong rail item when a user page part registers a kind** — *needs a feature plan*: the saved
  rail position (`focus`) indexes the rail as it stood before the user's page parts register their kinds, and the
  rail grows with each kind, so the restored position can land on another item (`restorePlace` and `changeKinds`,
  `src/plugins/forms/page/form-state.ts:171-198`). Save the focused item's identity (kind and index) with the
  position, and restore by identity after the kinds register.
- **The Forms tools contribution is not undone when a later start step throws** — *agent-ready*: `contributeFormsTools`
  runs at `src/plugins/forms/main/start.ts:338`, and the steps after it up to the return (`:373`) can throw. The tools
  stay contributed, with no part to stop them. Pre-existing: it predates Lane E. Wrap the later steps so a throw
  disposes the contribution, or move the contribution to the end of start.
- **`ex-definitions.test.ts` imports an undeclared package** — *needs the user's yes*: the test imports
  `@replit/codemirror-vim-core?raw` (`src/renderer/codemirror-vim/ex-definitions.test.ts:1`), and `package.json`
  does not declare it. It resolves only as a hoisted dependency of `@replit/codemirror-vim`, so a change to that
  package's layout breaks the test. Declaring it is a package change, which needs the user's yes.
- **A block whose `render` throws loses its line marks** — *agent-ready*: the fallback in
  `src/renderer/markdown-it/markdown-it-renderer.ts` (`pushBlockAsText`, `:565-579`, called at `:347-349`) draws one
  paragraph per source line with no `data-md-lines`, while a block that renders carries its `map` marks. Text from a
  broken block cannot be marked or picked by line. Give each fallback paragraph its source line range.
- **Retro lists an older file's Nit `follow_up` header pick as an override** — *needs a feature plan*: in a round
  saved before `action_label`, a Nit's `follow_up` header pick lists as `override · … | Follow-up`, though the forms
  README says a Nit offers no `follow_up` (`wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md:96`). The
  test `test_a_nit_follow_up_header_pick_saved_before_action_label_lists_as_an_override`
  (`wigley-ai-marketplace/plugins/wigley/scripts/retro/tests/test_answers.py:547`) pins that reading. Decide whether
  the listing drops such a pick or keeps the Defect word, then change the test with it.
- **Chatroom: room names past the file-name limit** — *agent-ready*: a room's file name is its name with each unsafe
  character written as `%XX` per UTF-8 byte (`src/plugins/chatroom/main/room-store.ts:15`), so a long or non-ASCII
  name passes 255 bytes and the write fails with `ENAMETOOLONG`. Cap the encoded length where a name is accepted (a
  refusal the tool reports) or hash the tail of a long name; add a table row for a 300-byte name. Source session:
  Claude Code ae5bbb7a-62aa-4437-8d30-93cd8c0132e0 in ai.
- **Chatroom: the board keeps an expired claim until something else refreshes it** — *agent-ready*: the board drops a
  claim past `expiresAt` only when it is next built (`src/plugins/chatroom/main/board.ts:120`), so an open viewer
  shows an expired claim until a post or session event. Arm one timer per room at the earliest live `expiresAt` and
  refresh the room's board when it fires; test it with the harness's fake clock. Source session: Claude Code
  ae5bbb7a-62aa-4437-8d30-93cd8c0132e0 in ai.
- **Chatroom self-test fixture: a re-seed after a failed seed duplicates its sessions** — *agent-ready*:
  `seedChatroomFixture` (`src/plugins/chatroom/main/selftest-fixture.ts:46`) creates its two rows without looking for
  rows a failed earlier seed left, so a retry adds a second pair. Reuse the rows by title, or remove them before
  seeding. Source session: Claude Code ae5bbb7a-62aa-4437-8d30-93cd8c0132e0 in ai.
