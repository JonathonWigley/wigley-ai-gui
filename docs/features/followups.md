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
- **Built-in plugin hot reload** — *needs a feature plan*: built-ins still need a rebuild to change. Reloading one
  with new code compiles TypeScript inside the running app, so a compiler ships with it (a third-party ask). The
  runtime loader's `PluginSource` seam and `reload` are the base: a third source over the repo clone.
- **A confirm prompt's own buttons outlive their view** — *agent-ready*: `ConfirmPrompt`
  (`src/shared/page/confirm-prompt.ts`) disposes its buttons' key anchors only on its next `redraw`, and has no
  `dispose`, so the forms, primer and audio picker views' `dispose` leave the last two button anchors live. Add
  `ConfirmPrompt.dispose` and call it from each owner's view dispose.

## Bugs seen in use

Defects seen in a drive run, a transcript or the user's own use.

- **Practice's Solution tab sits under the file name** — *agent-ready*: in a drive run at 1400x900, the practice
  Solution tab lay under `span.practice-file-name`, so a real click on the tab was refused and only a DOM `.click()`
  opened its confirm. Find the overlap in practice's tab row layout and keep the tab clickable.

- **Chat self-test fails the minimum-width fit on the session tab bar** — *needs a feature plan*:
  `npm run selftest -- --plugin chat` fails 8 steps with `<keys> fits the minimum width: nav.ui-tabs.session-tabs
  holds 120px in 99px` (groups: permission round Cmd+Enter, transcript focus Enter twice, controls e and Escape,
  interrupt and close three times). It fails the same on base 46f417b5, so it predates the usage change. The session
  tab bar (`.ui-tabs.session-tabs`, `src/plugins/sessions/page/sessions.css` near line 348, with the usage line from
  `usage-tab-line` in its tab line) does not fit at the minimum width. Find what grew it (check recent commits
  touching the sessions tab bar or the usage tab line, such as 4c8a2b0b and 4b7f175a) and make the bar fit or
  scroll. Source session: Claude Code 76f5a6f5-89a8-4d05-a525-af23402d29ad in wigley-ai-gui. Needs a repro before a fix: the rule is now at `sessions/layouts/default/layout.css:397,414` and the bar was reworked since (ed63f147f, 370a47974); re-run `npm run selftest -- --plugin chat`.
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
- **Docs editor session module** — *needs a feature plan*: `createDocView` (`src/plugins/docs/page/doc-view.ts`) reads
  `editingSection` at about a dozen sites across the section editor, the conflict flow, `closeEditor` and `writeEditor`.
  An editor-session module owning those, with the mode as data (full text from the edit, saved text, restore, reload),
  would collapse most of them; it also moves the paste and drop code, so it is its own plan.
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
- **`<Tab>` in a forms round leaves the focused box off screen** — *agent-ready*: the box takes focus at y900 in a
  700px window and the pane does not scroll, so the user types into a box they cannot see. `focusBoxItem` reads the same
  on the base (`7001a175`), so it looks old, not proved. Steps: open a forms round with the notes box on a finding, size
  the window to 700px high, press `<Tab>`, then read the box's rect (`.cm-focused`) or take a screenshot; the box lies
  below the window until the caret moves.
- **`forms.choose` with an arg through `runCommand` across the Bridge is not proved live** — *agent-ready*:
  `window.wigley.runCommand("forms.choose", 2)` resolved with no `[forms]` line, with the round's row not the one
  showing, so the run proves nothing either way. The arg is proved through a `binds` entry only. To prove it: open a
  round that shows the row, run the command by `runCommand` from the page and from main, and read the `[forms]` line.
  A self-test step cannot prove it yet: a self-test page bind to another process's command makes the page throw
  `Keymap names unregistered commands` (`requireRegistered` in `src/renderer/renderer.ts`), because `applySelfTestConfig`
  (`src/main/selftest-config.ts`) filters only the fixture user plugin's binds, not those to a command main registers.
  The fix is a page runtime command in forms' page part.
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
- **A session host killed while the app runs is not replaced until the next request** — *needs a feature plan*: in
  the scheduled-tasks live check, after the drive run's host was killed with the app open, no new host started and no
  `[scheduling] queued` line came within 65 s; one started only when a chat request needed it. Until then the queued
  runs have no host to fire them. The client's connect loop (`src/main/session-host/session-host-client.ts`,
  `startConnecting`, `adopt`) starts only from a caller; the plan wanted the dropped link to reconnect and hand over
  the pending list (session-host design.md, task 13). Decide whether a dropped link with a pending list reconnects at
  once.
- **Main's startup log lines never reach the page log** — *agent-ready*: `createPageLog` (`src/main/page-log.ts`) holds
  lines until `did-finish-load`, then sends them, but the renderer registers `bridge.onLog` inside its async `start()`
  (`src/renderer/renderer.ts:126`), so lines sent before that are dropped. A drive run never shows a main part's start
  lines, such as `[scheduling] queued 0 runs` or the adoption and replay lines after a restart, while later lines show.
  Fix: let the page ask for the held lines once its listener is on, or hold them until a page-side ready message.
- **A scheduled run's `done` mark clears as its turn ends** — *needs a feature plan*: in the live check, the app
  selected the run's row by itself right after its turn ended (`[sessions] activated drive-project`), so the `done`
  mark and the Dock badge cleared before the user saw them. Find what activates a headless run row at turn end, and
  keep run rows out of it.
- **The scheduling tools leave `tools.json` at a keep-sessions quit** — *agent-ready*: at `quit --keep-sessions` the
  endpoint's `tools.json` is rewritten without the four scheduling tools, since scheduling stops before the endpoint's
  last write, and they return at the next start. A relay that starts while the app is closed reads that file. Decide
  whether the endpoint keeps a stopping part's tools at quit, then make it so.
- **The Schedules editor's mode line wraps and hides the Prompt text** — *agent-ready*: each editor field's
  `--NORMAL--` line wraps onto two lines, and the Prompt box cuts its text off behind it (live check 1 screenshots, in
  the drive run `sched-check2`). Lay the mode line out per `DESIGN.md`'s form rows.
- **No test checks that the restore sweep still finishes a row this start did not adopt** — *agent-ready*: the
  `adoptedRows` skip in `src/plugins/scheduling/main/start.ts` (`finishRestoredRuns`) has a test for the adopted row
  only. Add the non-adopted row as a case in the outcome table of `start.test.ts`.

## Harness seams

What a second harness — Codex, wigley-harness — and the agent settings and plugin features need.

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
- **Shareable build: what is still tied to the user** — *needs a feature plan*: the app now ships its own `auri` agent
  plugin and binds the user's workflow, retro, backlog and docs through `auri.json`, so a build without that plugin
  shows empty states. Three plugins still assume the user's setup:
  - `notes` lists `backlog` in `dependsOn.main` (`src/plugins/notes/manifest.ts`), so notes cannot run without backlog.
    Decide whether backlog stays. If it goes, invert the link: backlog registers a note target into notes.
  - `auto-compact` reads the `workflow` plugin's `workflowFlowsSlot` (`src/plugins/auto-compact/main/start.ts`,
    `reads.main` in its `manifest.ts`). A disabled `workflow` is safe. A deleted one breaks the build.
  - `app-update` installs from the clone's `origin/main` (`INSTALL_REF` in `src/plugins/app-update/main/install-command.ts`),
    so another user needs a fork of their own.

  Source session: Claude Code a20096e5-768a-4100-9290-f3696e2c4543 in `~/Documents/ai`.

## Plugin extension points

Closed lists that become registrations, so a plugin adds what is hardcoded today.

- **View and interaction behaviours as switchable plugins** — *needs a feature plan*: behaviours such as
  `chat.completionDescriptions` and `keys.showHints` could ship as plugins the user switches on and off, rather than as
  settings inside the plugin they change. The live enable switch exists, so the split costs only the plugin boundary.
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
- **Should Docs' feature tree depend on Backlog's features-home pick?** — *needs a decision*: Docs indexes the
  features homes Backlog hands it (`docs.setFeaturesHomes`, called from `syncBinding` in
  `src/plugins/backlog/main/start.ts`), so with Backlog off, or no backlog strategy picked, Docs indexes no features
  home. Open: keep Docs' feature tree tied to Backlog's pick, or let Docs read the homes from the `backlog` section of
  `auri.json` itself, so the tree shows with Backlog off. Source: the shareable-app cycle-2 re-review.

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
- **Ctrl+j/k cursor keys in the remaining list views** — *needs a feature plan*: `<C-j>`/`<C-k>` are bound for primer, chat,
  workflow, forms, docs, backlog and gallery (`src/plugins/keymap.ts`). Still missing: settings sections and rows, the
  chat, docs and settings pickers, and the chat session list. `Ctrl+j`/`Ctrl+k` move the cursor a line and
  `Ctrl+Shift+j`/`Ctrl+Shift+k` half a page, so the scroll keys (`docs/keymap.md`, Layers) reach every view. Open: pickers have no half-page commands, so the `Ctrl+Shift` keys need new commands, and new keys are the user's call.
- **Latte theme and OS light/dark following** — *needs a feature plan*: the token model is theme-neutral
  (`colorScheme` per theme), so this is a theme file, its `DESIGN.md` light rules, and a light/dark choice.
- **Theme editor in Settings mode** — *needs a feature plan*: the user's `themes/*.json` token sheets are hand-edited
  today, and the userConfig service writes only `settings.json` and `keymap.json`
  (`docs/features/settings/design.md`).
- **Relative images in rendered docs** — *needs a feature plan*: an image by absolute path draws through the visual
  scheme's local image route (`docs/features/visuals/design.md`), but a doc's own images are relative to it
  (`images/<doc>-….png`, as the editor pastes them), and `document` has no folder to resolve them against, so they
  show their alt text.
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
- **Wrap-up action chips act on click** — *needs a feature plan*: the wrap-up card (`wigley:wrap-up` § Your move)
  draws standard actions — `push`, `install`, `/clear`, `restart`, `make`, `device build` — as chips, but a visual's
  frame is sandboxed, so a chip only shows the word the user then types. A click could send that word to the
  session, or run the command behind it (`install` through app-update's install line, `make` through the Large workflow's
  Clear & make action). It needs a way for a visual to ask the page to act, and which chips may run without a confirm.
  Source session: Claude Code 2d49f095-112d-44a6-acba-0359d2074186 in ai.
- **Dock badge counts sessions that need the user** — *needs a feature plan*: the Dock badge counts only unviewed
  scheduled runs (`docs/features/scheduled-tasks/design.md`), and session-titles leaves a needs-you badge out of
  scope. Add a count of the sessions waiting on the user (an open form round, a pending approval), and a bounce when
  one starts waiting while the app is hidden. What counts as waiting needs settling against session-titles'
  activities. Reference: OpenCode 2.4.0 taskbar status (https://github.com/anomalyco/opencode/pull/65317). Accepted
  in harness watch 2026-11-23 (`~/harness-watch/decisions.md`).
- **Sidebar marks a session whose last turn was cut off** — *needs a feature plan*: a machine reboot or a dead host
  ends a turn and the row just rests (`docs/features/session-host/design.md` § Intent), so nothing shows that the work
  stopped partway. Mark such a row and offer a Continue action that resumes it. Reference: Qwen Code 0.28.4
  "Continue" badge (https://github.com/QwenLM/qwen-code/pull/18044). Accepted in harness watch 2026-11-23
  (`~/harness-watch/decisions.md`).
- **Edits made through the shell or by another session are attributed** — *needs a feature plan*: a session's
  changed files miss files changed by a shell command (`sed -i`, a heredoc, a script), and sessions share clones and
  worktrees, so two sessions editing one file go unseen. Count shell edits as the session's own, and mark an edit that
  overlaps another session's instead of crediting it to the wrong one. Reference: Nimbalyst 0.84.3
  (https://github.com/nimbalyst/nimbalyst/releases/tag/v0.84.3). Accepted in harness watch 2026-11-23
  (`~/harness-watch/decisions.md`).
- **Scheduled tasks start on events** — *needs a feature plan*: scheduled tasks start only by clock or cron. Add
  event triggers — a chatroom post, a land on `main`, a CI result, an MCP server event — and settle which events the
  app can observe and how a run receives the event's details. Reference: OpenCode 2.4.0 Automations
  (https://github.com/anomalyco/opencode/pull/65296), OpenHands 1.43.0. Accepted in harness watch 2026-11-23
  (`~/harness-watch/decisions.md`).
- **Side questions on a running session** — *needs a feature plan*: the user cannot ask about a running session
  without interrupting its turn. Fork the session's context into a short background session with read-only tools,
  answer there, and leave the main turn untouched. Claude Code's `/btw` does this in its terminal UI only. Reference:
  OpenClaw 2026.11.10-beta.2 side questions
  (https://github.com/openclaw/openclaw/releases/tag/v2026.11.10-beta.2). Accepted in harness watch 2026-11-23
  (`~/harness-watch/decisions.md`).

## Code cleanup

Duplication and drift with no user-visible defect.

- **One clamped cursor move for every list view** — *agent-ready*: `movedKey`
  (`src/plugins/builds/page/builds-view-model.ts`) is the eighth copy of the same rule — find the cursor's key, step
  by the delta, clamp to both ends, fall back to the first row when the key is gone. Move it to one shared page helper
  and point each copy at it (grep the page view models and states for the clamped `findIndex` step).
- **Saved outcomes from one list** — *agent-ready*: `isSavedOutcome` (`src/shared/agent-forms/form-store.ts`)
  hard-codes `'open' | 'submitted' | 'cancelled'` beside the `SavedOutcome` type; derive both from one
  `SAVED_OUTCOMES` const.
- **"Answered" or "responded" on the forms page** — *needs a feature plan*: the forms page counts a notes-only item as
  `answered` (`isResponded`, `src/plugins/forms/item-response.ts`), while the payload's `answered` is pick-only
  (`isAnswered`). User-visible text still says "answered": the progress line "N of M answered" (`view-model.ts`), the
  card-parts labels 'Answered' and 'Not answered' (`src/plugins/forms/page/kinds/card-parts.ts`), and the
  `p.round-progress` comment in `src/plugins/forms/layouts/layout.d.ts`. Decide whether the page says "responded"
  there.
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
  `src/plugins/workflow/plan/` (the former `workflow-large/contract.ts:197`; re-check the line) and `src/plugins/workflow/main/flow-store.ts:278` (both `boolean`).
  Move the type guard into `src/shared/json.ts` beside `isJsonObject` and point every copy at it. Source session:
  Claude Code ae5bbb7a-62aa-4437-8d30-93cd8c0132e0 in ai.

## Latent defects and tests

Defects with no path to the user today, checks waiting on a live window, and test cleanup. Test cleanup goes last
because the earlier items rewrite many of these tests anyway.

- **The build offer card clips in a short window** — *agent-ready*: at a 900x700 window the Builds offer card (a chat
  composer part, `builds.offer` in `src/plugins/builds/page/session-parts.ts`) is clipped inside the scrolling area
  above the composer and its Dismiss button is partly hidden. Seen in the builds plan's live-fix drive run; screenshots
  were in that run's `lf2-*.png`. Find which composer-part container clips it before changing the card.
- **A TeamCity log save holds the whole log in memory** — *agent-ready*: `saveLog` in
  `src/plugins/builds-teamcity/main/teamcity-backend.ts` reads the whole `downloadBuildLog.html` output from the
  `teamcity` CLI into one string, then writes it with `services.files.write`. A long build's whole log sits in main's memory
  before it reaches disk. Stream the CLI's stdout to the file instead, which needs a streaming run on the
  `ProcessRunner` contract and a streaming write on the files contract. Source: the builds redesign review,
  recommendation R2.

- **A second `chat.start` hangs the drive run** — *agent-ready*: in a drive run (fake harness), after the first
  session ran `fake: agents`, a second `npm run drive -- do chat.start` never returned and every later drive command,
  `eval 1+1` included, hung until `restart`; a retry after the restart hung the same way. Seen in the builds plan's
  task 10 drive (check 11's hidden-hub case). Cause not checked: find what `chat.start` waits on.

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
  `scoped-agents-pane` body (`src/plugins/scoped-agents/page/agent-pane.ts`, 108-109 and 409), while the assistant's
  keys act in the ask box editor (`askBox.editor.focus`, 178-179) or the chat mount. A user typing in the ask box who
  clicks the empty review loses the caret. The `AgentPane` contract (`src/plugins/scoped-agents/contract.ts`, 113-129)
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
- **Withdrawn tools reach live hosts late** — *needs a feature plan*: at a stop, withdrawn tools and shrinking tool lists need
  to reach live hosts before `relay.close`, and the relay's second notice arrives only on the host's next `tools/call`. Open: this states a requirement, not a fix, so decide how withdrawn tools reach a host before `relay.close` (`src/plugins/sessions/main/start.ts:321`, `mcp/mcp-server.ts:59`); re-read after Lane H.
- **A stop drops unsaved text** — notes' popup and a forms draft lose what the user typed when their part stops. A
  switch-off asks `mayStop` first and refuses while their text is unsaved or a round is open, so a restart (drive-only) is the stop that still
  drops it.
- **A pushed scope after its host is disposed** — `PushedScope.pop` throws after host disposal (notes popup, rename
  dialog, settings view), and `keys.setScope` leaves its base behind. Same trigger as the item above.
- **A disposed layout preview still opens** — after `dispose`, the layout preview's `show` can open a preview, because
  it does not check. Make a disposed service refuse, as `track` does for a registration made after the stop.
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
- **Demo: the real-session step's row lands in recency and saved panes** — *needs a feature plan*: page readers spot
  a demo row by its harness, but the real-session step runs on the claude harness as an ephemeral session, so
  `sessions/page/session-recency.ts` stamps it and `pane-sessions.ts` saves its `hostSessionId` to uiState. Carry
  `ephemeral` on the page `SessionRow` (from `HeldSession.ephemeral` in `chat-sessions.ts`) and filter there; one
  `isDemoRow(info)` helper in `contracts/demo.ts` would serve every reader. Source: demo-mode review, plan lane 1 M2.
- **Demo: Practice edits made just before the step can save into the sample folder** — *agent-ready*: the page's
  autosave of a draft typed just before `practice.mode` enters can land in the sample folder and be lost when the
  sample goes. The leave also calls the async `saveDrafts()` dispose without awaiting it (`demo/page/start.ts`
  `leave`), so main's `leaveStep` can release the sample first. Flush drafts before main swaps the folder, and decide
  whether a leave awaits an async dispose.
- **Demo: smaller edge cases** — *agent-ready*: a dispose during an in-flight notes draft op can save sample fields
  to the real draft (`notes/page/popup.ts` ~970); the Docs sample split uses the real uiState key, so a drag writes
  the user's tree width (`docs/page/start.ts` `createAddedView`); `live-view/window-pick.ts` `UNITY_EDITOR_TITLE` is
  loose; `next`/`previous`/`reset` with no held step enter the first step (`run-driver.ts`), with no test row;
  `goToCursor` (`demo/page/start.ts`) runs outside the page queue; chatroom `addSessionEntry` writes the real room's
  agent entries for demo sessions. Source: demo-mode review lanes C, D and 2.
- **Demo self-test: the walk's end depends on the last beat** — *agent-ready*: the walk's `until` waits on the last
  beat succeeding, and the report is taken before the final leave (`demo/main/selftest-script.ts`). Wait on the
  driver's step state instead, and report after the leave. Source: demo-mode review, lane 08 M2/M3.
- **Demo: cleanup** — *agent-ready*: `createStepAgentStore` copies backlog's `createAssistantStore`; share one. Two
  `unicorn(no-useless-spread)` warnings remain in `src/shared/page/demo-start-prompt.test.ts`. The correctness-A
  lane's missing test rows for the per-plugin demo steps are worth one row each where a step holds state.
- **A step's duration ends at any entry no agent wrote** — *needs a feature plan*: `stepDurationMs`
  (`src/plugins/chat/page/activity-runs.ts:113`) skips only entries of another agent, so an entry with no `agentId`
  (a raw entry or a permission entry) ends every step before it. A raw entry ends a subagent's step, against the
  function's comment, and a permission entry ends the tool step it asks about, so a tool waiting on permission shows
  its time only up to the prompt. Options: end a step only at an entry of its own agent, or exempt permission and raw
  entries from ending one.
- **A refused invoke to a stopped plugin rejects in the renderer** — *needs a feature plan*: once `dropParked` ran
  while a plugin's main part had no handlers, `plugin-channel.ts` (`src/main/plugins/plugin-channel.ts:107`) throws
  `Plugin "<id>" has stopped` for each later invoke, and a page caller with no `.catch` logs an unhandled rejection.
  Options: resolve a sentinel the page channel swallows once the caller's part has stopped, or wrap the page channel
  so a stopped part's invoke never settles, which would also close the whole task 24 Rule 1 class (no continuation
  runs after stop) at once.
- **A docs saved place holds one doc's edits, so a held draft leaves it** — *needs a feature plan*: `writePlace`
  (`src/plugins/docs/page/docs-view.ts:829`) writes `edits: doc.edits() ?? draft`. Editing another doc while a beaten
  restore's draft is held saves only that doc's edits, so a reload then loses the draft, though it stays in memory.
- **The pane tree's draw pass drops stale boxes in a plain loop** — *agent-ready*: in
  `src/shared/page/pane-tree/pane-tree-view.ts:304-310` a throwing `box.divider.dispose()` leaves that box in `boxes`
  and skips the rest, so the next pass disposes it again. Hold the stale boxes, delete them from the map, then run
  their disposes through `callEach` (task 24 Rule 3); add a table row with a throwing divider.
- **Forms' main start logs a late layouts failure after stop** — *agent-ready*: `registerLayoutsAfter`
  (`src/plugins/forms/main/start.ts`) attaches `registration.catch(log)` at once, so a fixture write that rejects after
  `dispose` still logs `layouts not registered`, after the plugin stopped (task 24 Rule 1). It happens only in the
  self-test, where `fixtureWritten` is a real write. Check `isDisposed` before logging, with a table row in the
  `registerLayoutsAfter` test. The rest of that file holds no continuation that logs or toasts after stop.
- **Teardowns and guards still without a test row** — task 24 Rule 1 and Rule 3 coverage left over: no throwing-dispose
  row for chatroom-view, settings-view (`disposeEntries`), the Settings page start, problem-workspace, forms-view and
  round-view (reached only through the forms start row); no `disposeDraws`-throws row for schedules-view,
  task-editor and backlog-view, whose harnesses lack a throwing drawn-part fake; no guard row for problem-workspace's
  `writeQuit` (`src/plugins/practice/page/problem-workspace.ts:1066`); the audio-picker and primer main teardowns
  cannot make their first step (`service.detach()`) throw without a fake form service; and
  `src/plugins/scheduling/page/task-editor.ts` has no test file.
- **A Chat tab whose build throws stays half-built and live** — *agent-ready*: `hold`
  (`src/plugins/chat/page/chat-view.ts:546-547`) puts a tab in `tabs` only after `createTab` (:1289) returns. When a
  step of `createTab` throws, the tab is not in `tabs`, so the view's `dispose` (:893-907, which tears down only what
  `tabs` holds) never reaches it. That step can be `entries.rebuild` (:1418), `attach` (:1423),
  `deps.editor.create` (:1425) or a later step. What it already built stays live:
  - its side sections (`deps.sideSections.openTab`, :1377)
  - its `rootSize` ResizeObserver (:1412)
  - its entry list and composer surface
  - from :1423 on, its mounted host
  Options: `createTab` tears down what it built when a step throws and rethrows, or `hold` sets the tab in `tabs`
  before building it, so `dispose` reaches a partly built tab (and `tearDownTab` then copes with null `box`/`host`).
  Add a row where `rebuild` throws on arrival, then stop, and assert every registration was released.
- **node-files watch rows flake under load** — *agent-ready*: `src/main/files/node-files.test.ts` has a
  `watch_TempFileEvent_ReportsItsTargetOnceWhenPresent` table. Different rows fail at random: "target and temp file in
  one window", "temp file only, target present" and "temp file then rename". They fail on `main` as well, 2 of 5 runs
  alone and once in a full suite run, with no change to the watcher. They depend on real file-system event timing.
  Options: drive the watcher with a fake event source, or widen the window the rows wait on.
- **Every session open runs a Docs index load** — *needs a feature plan*: each session's Docs tab (docs-session-tab) is
  shown as its row opens, before the Chat tab takes over. Its first-show load (`showFirstTime`, `hasRun` in
  `src/plugins/docs/page/docs-view.ts`) therefore runs a `docs_index.py` index read and a status fetch for every session
  that opens, even one where the user never opens Docs. The chat self-test log shows `Docs tab shown` then `session
  index read` for each of its 4 sessions. This may be intended. Options: defer the first load until the Docs tab is
  shown by the user, or keep it and confirm the cost is fine.
- **Docs' first binding at launch never rebuilds the machine index** — *needs a feature plan*: `createDocsBinding`
  (`src/plugins/docs/main/start.ts`) writes the contributions file at its first binding but rebuilds nothing, since the
  launch file is the text the cached index was built from and Backlog's homes come after. A later rewrite whose text
  differs from that launch text rebuilds. A `docs` strategy changed while the app was closed (a plugin update) leaves
  `index.json` built from the old file until a rescan when no later rewrite comes: Backlog hands homes equal to the
  first binding's, and no strategy changes. Options: compare the file with the built text at Backlog's first homes
  handing, rewrite or not, or after a short settle once the app starts. Source: the shareable-app cycle-2 re-review.
