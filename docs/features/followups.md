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

- **Plugin state registry** — *needs a feature plan*: a core registry of typed state slots, so a plugin added late
  or reloaded reads the current value of any state another plugin owns, and a rebuild is needed only for new data.
  Each owner declares its slot keys in its `contract.ts` (`slot<ChatSession[]>('chat.sessions')`, keeping the
  contract import and the layer check); `api.state.publish(key)` gives the owner the only writer;
  `api.state.read(key)` gives anyone `get()` (undefined while the owner is absent or disabled) and a disposable
  `on`. The core holds each slot, so it outlives the owner's reload, and mirrors main slots to the page, replacing
  the hand-written state-plus-push pairs (`ChatChannel.sessions`, agents `rosters`, usage `snapshot`, workflow
  `flows`). An untyped global store was weighed and rejected: every read becomes a cast, and owner-only writes
  (sessions' close guards, chat's queue) go. Behaviour stays as dependency exports (`addTab`, `contributeTools`,
  `send`). What it replaces: event-only session rows and session list (no late-starter read, Sessions queries and
  row decorations); chat's session state, which has no cross-plugin read model, so agents, usage and workflow each
  re-fold `chat.agentEvent` and a reloaded one cannot catch up; main parts' live state held in `start` closures
  (sessions list, chat processes, agents rosters); visual reading chat's focused entry as an `HTMLElement`
  (`ChatPageExports.focusedEntry`, an entry id slot instead); and the hard `dependsOn` a plugin takes only to hear
  another plugin's event (agents on chat), since reading a slot needs the contract import but not start order. A
  layout kit gets `kit.state.read(key)` too, so a user layout can show data its owner did not pass in (today
  `BaseKit` reads no settings, sessions or other plugins' data). Questions for the plan: deltas or whole values for
  streamed data (chat entries), and how a reloaded owner re-attaches to its slot. Builds on
  disposable registrations landed (plan-foundation-sweeps).
- **PluginHost stop and reload, with a live enable switch** — *needs a feature plan*: `PluginHost` has `stop(id)`
  and `stopAll()` (stop landed, plan-foundation-sweeps); add `reload(id, part)` (`src/shared/plugin-host.ts`),
  stopping dependents first and starting them again after. Dependents hold the view `exports(consumer)` gave them, so
  a reload leaves them stale: hand them a stable export proxy or restart them too. A reloaded main part keeps its live state through the plugin
  state registry above, not its `start` closure. On top of it, the `plugins.disabled` setting
  (`src/config/settings.ts`, read once by `startPlugins`) takes effect live from a per-plugin switch in Settings
  mode, so view and interaction behaviours (the completion row's description, key hints and the like) ship as
  plugins the user switches on and off rather than settings inside the plugin they change. Builds on
  disposable registrations landed (plan-foundation-sweeps).
- **Quit does not hold for a plugin's suspending dispose** — *agent-ready*: quit runs `stopAll` on the main parts
  (`src/main/main.ts`), but a live quit does not wait for it, so a `dispose` that really suspends (forms' on an
  unfinished layout write, sessions' `relay.close`) is cut off and the parts after it never stop. Chat stops after
  forms, so a forms `dispose` that suspends can keep chat's `detachAll`, and with it the last save, from running (the
  cut save itself: **A quit can lose a session's open run time**). Hold the quit until `stopAll`
  settles, and prove it in a live quit, which a drive run cannot show because it holds the quit itself. The hold
  changes quit latency, which is why it waits here.
- **Runtime command API** — *agent-ready*: commands at runtime and around other plugins:
  `commands.register(id, decl, handler)`, `keys.bind(bind)`, `commands.intercept(id, (next, ctx) => …)`,
  `commands.onDidRun`, all disposable, and `MainApi.commands.run`. Commands take a count or argument, so
  `choose1..9` (`src/plugins/forms/manifest.ts`, `forms-commands.ts`) becomes one `forms.choose`.
- **Every click runs a command** — *needs a feature plan*: keys always run a command, but about two thirds of
  pointer actions do not, so a future `commands.intercept` or `onDidRun` misses them. Of 40 click sites sampled, 13
  run a command, 18 call what a command's handler calls (forms' card kit choose, clear, accept and toggles;
  chat's Allow and Deny, image remove, entry toggle and queued pull-back; the agent strip's box toggle; visual's
  expand; help's Close; the list picker's choose; sessions' tab and row select; settings' cursor set), and 9 have no
  command (docs `followLink` and opening a tree node by id, notes `pickColour`, backlog `openHome` and row select,
  chat opening the image viewer at an index). The cause: a command takes no target, so "do X to this row" cannot be
  one. Give commands a target (row, index, href) through the runtime command API above, move each site onto its
  command, and fold forms' layout action vocabulary (`kit.run({ type })`, `runLayoutAction` in
  `src/plugins/forms/page/layout/card-kit.ts`) into commands. The activity bar's click calls `ModeHandle.show()`
  (`src/renderer/shell/shell-chrome.ts`) where it should run the mode's show command. Builds on the runtime command
  API.
- **Events for every state change** — *agent-ready*: the core emits its own events on the bus under `core` — mode and
  scope changes, window focus, theme applied, config changed, page ready — each typed in `src/contracts`. Chat and
  docs fill out their events, typed in each `contract.ts`: chat has `ChatMainEvents` (agent event, plan usage,
  session opened) and still needs message sent, turn started and finished, and control changed (model, permission
  mode, effort); docs has `DocsMainEvents` (index loaded) and still needs doc opened, saved, created and trashed.
  Five more plugins send their state changes only over their own channel, so no other plugin hears them: backlog
  (follow-up created, edited, deleted, applied; `channel.send('changed')` in `backlog/main/start.ts`), workflow (a
  session's flow and stage, `channel.send('flows')`), agents (roster changed), usage (snapshot changed) and notes
  (note sent or filed, `note-sender.ts`). Sessions' page still needs activity set and tab added; visual and keys
  need visual opened and help opened. Then
  add a standing rule to the AGENTS.md Intent so new work stays hookable: every user action runs as a command through
  the runtime command API, and every state change a plugin owns is published as an event typed in its `contract.ts`.
  Today AGENTS.md § Architecture says how to emit, not that a plugin must.
- **Page state survives a page reload** — *needs a feature plan*: a core per-plugin page-state slot kept outside the
  page, which a page reload restores. Chat's draft and its images: a layout reload keeps them (the box moves into the
  redrawn composer), but a page reload starts the box empty (`docs/features/layouts/design.md`). Forms: focus, review
  row and view (review, confirm) go into the draft or the slot; pending autosaves flush on `pagehide`; restored rounds
  do not take over their session again.
- **Picker ranks recent targets higher** — *needs a feature plan*: the user's ranking requirement has two parts.
  `docs/features/agent-chat/plan-slash-completion/` (not started) lands the first: the `FuzzyMatcher` page service,
  every list picker ranked, and a row's name outranking its path, so `gui` in the Notes target picker puts
  `wigley-ai-gui` first. This item is the second: a recently updated target ranks higher. Build it after that plan.
  `NoteHome` has no updated time, and "updated" still needs a definition (for example the home's latest commit).
- **Core picker and folder services** — *agent-ready*: core page services for what plugins duplicate:
  `services.picker` (chat-private today, `src/plugins/chat/page/picker.ts`; docs needs it), and `chooseFolder()` and
  `openExternal(url)` on `PageServices` with the scheme check inside (both are `MainServices` only today), deleting
  the per-plugin channel pass-throughs in chat and docs. Confirm already landed as the shared `createConfirmPrompt`.
- **keysFor and box focus in the core keys API** — *agent-ready*: `keysFor` moves from the keys plugin
  (`src/plugins/keys/contract.ts`) into the core keys API, so a plugin reads a command's keys without depending on
  `keys`; it returns unformatted hints (page and editor) with a keymap-changed subscription, so drawn buttons follow
  a rebind. Box focus (`page` or `editor`) becomes a core `keys.onWhereChanged`, replacing keys' own
  `document.activeElement` reading. With it, the renderer root builds the pending-keys hub without the nullable
  `pageKeys` (`src/renderer/renderer.ts`), and the editor-bind miss policy moves into `editor-binds.ts`. `anchor`
  moves with `keysFor`: the renderer reads the keys plugin's exports by `KEYS_PLUGIN_ID` to hand the shell chrome its
  anchors, a reach a plugin from a user folder would not have, and the chrome's hints vanish with `keys` disabled.
- **Forms takes the timers service** — *agent-ready*: `MainServices.timers` exists, but `FormsService`
  (`src/shared/agent-forms/form-service.ts`) still calls the global `setTimeout`; move it onto `timers`, and move its
  32-bit overflow clamp into the timers adapter.

## Bugs seen in use

Defects seen in a drive run, a transcript or the user's own use.

- **Chat sessions get forms' 240 s deadline, not the relay's 300 s** — *agent-ready*: in a session the app's chat
  started, a round's draft comes back every 240 s (forms' `deadlineSeconds` default), though the wigley plugin entry
  sets `WIGLEY_FORMS_DEADLINE_SECONDS` to `300` and `relay.py` sends it in its hello. Cause: chat opens the row with
  `deadlineSeconds: null` (`src/plugins/chat/main/chat-sessions.ts`, `sessions.open`), and `connect` joining that
  owned row (`src/plugins/sessions/main/session-list.ts`, `join`) keeps the row's info and drops the hello's
  `deadlineSeconds`. Fix: a join takes the hello's `deadlineSeconds` into the owned session's info, as the host id is
  kept; check that the form service, which reads it once per session in `startSession`
  (`src/shared/agent-forms/form-service.ts`), starts after the join. Add a row to the session-list join tests: GIVEN
  an owned row opened with a null deadline WHEN a relay joins with 300 THEN the session's info reads 300.
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
- **One newest-wins open rule** — *agent-ready*: docs opens race each other with no shared rule: `openDoc` drops a
  waiting request only for a newer `openDoc`, so a doc the user opens from the tree or a link while it waits on a
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
- **Background subagent misattributed and dropped early** — *needs a feature plan*: two faults a real session showed
  on 2026-11-03, a haiku background subagent under an Opus main told to run `sleep 90`. Take the first one first; it
  misattributes who said what. (1) The subagent's replies show in the main transcript as the main agent's: the
  decoder's text entries read no `parent_tool_use_id` (`decodeTextBlock`, `src/main/claude-code/stream-decoder.ts`).
  Only a background subagent was seen doing this; check a foreground one. To decide: where a subagent's text belongs,
  such as its strip box or nowhere. (2) A subagent waiting on its own background shell lost its strip box about 80 s
  before it really ended, then replied and handed back with no box. The box follows `agentFinished`, which for a
  launched subagent comes from `task_notification` (`finishByNotification`; `docs/features/agent-chat/claude-stream.md`
  § its end event notes the measurement). The raw line was not captured, so capture it first. To decide: whether a late
  reply lists the subagent again, or its box waits for the shells it owns. Source session: Claude Code
  2294388c-6fcc-4d43-a794-070e11683453 in /Users/jonathonwigley/Documents/ai-dev

- **A quit can lose a session's open run time** — *needs a feature plan*: chat's final save at quit is not waited for
  (`detachAll`, `chat-sessions.ts`), and `src/main/main.ts` lets the user's quit exit without waiting, so a cut write
  leaves the last saved total, which can lack the whole span of a long turn. Deciding means choosing between a bounded
  hold on the quit path and a synchronous write. `docs/features/session-clock/design.md` § Across relaunch states the
  current behaviour.
- **`/clear` then relaunch loses the row's selection** — *agent-ready*: select a row, `/clear` it (running or idle),
  and restart; no row is selected and the main pane says `Pick a session in the side bar`, though
  `open-sessions.json`'s `selectedHostSessionId` holds the row's new host id. A selected row with no `/clear` stays
  selected. Seen on the fake harness through a drive `restart`; the cause isn't traced, and it may be fixture-only,
  since the fake has no saved history for the new id.
- **Tabs lose their first click in an unfocused pane** — *agent-ready*: the first click on a tab in an unfocused pane
  focuses the pane but does not select the tab. Pane focus moves on the release, and `drawFrame`
  (`src/plugins/sessions/page/session-tabs-view.ts`) then rebuilds the strip with `strip.replaceChildren()`, so the
  released tab leaves the document before its `click`: `pointerup` lands on the tab, `mouseup` on the `NAV`, and no
  `click` fires. A second click selects it. The bar's other controls (Split right, Close pane) work on the first click.
  Keep the tab elements across draws. Source session: Claude Code 368f2c4b-5d54-47bf-8285-14fec015fc6b in wigley-ai-gui.
- **Pane focus keys leave the keyboard in the old pane** — *agent-ready*: `Alt+h` from a focused box moves pane focus
  while `activeElement` stays in the old pane's box (seen: active in slot 1, focused slot 0). A click already moves it
  (`panePressed`, `src/plugins/sessions/page/start.ts`); give the keys the same treatment. Source session: Claude Code
  368f2c4b-5d54-47bf-8285-14fec015fc6b in wigley-ai-gui.
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

## Harness seams

What a second harness — Codex, wigley-harness — and the agent settings and plugin features need.

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
- **Agent plugin management and sync** — *needs a feature plan*: list each profile's installed plugins and
  marketplaces (version, enabled, scope), and install, update, enable, disable, uninstall and reload them from the
  app, behind the harness seam: Claude Code's adapter runs `claude plugin` (`list`, `install`, `update`, `enable`,
  `disable`, `uninstall`, `marketplace`), Codex's its own commands. The Docs view then syncs the user's own plugins:
  commit, push, update the plugin for each harness and reload, acting on the docs-browser statuses (uncommitted,
  unpushed, not installed, session stale; `docs-browser/design.md`). A push still needs the user's press each time.
  `/reload-plugins` is terminal-only in print mode (`agent-chat/claude-stream.md` § Init), so the first questions are
  how a running chat session picks up a changed plugin (a restart with `--resume`, or a stream control) and which
  statuses each sync step acts on.

## Platform and packaging

What Windows support and installers need.

- **Platform record** — *agent-ready*: a `Platform` record chosen in the composition root (`createMacPlatform` /
  `createWindowsPlatform`), exposed read-only on both sides as `services.platform`, replacing today's
  `'macos' | 'windows' | 'linux'` string under the same name: an `os` field holding that string, app lifecycle quirks,
  attention and badge (the alerts adapter splits into mac and Windows variants), default program paths, the relay
  endpoint. Every plugin that reads `services.platform` today moves to `services.platform.os` when the record lands.
  Replaces the other `process.platform` reads (`main.ts`, `electron-alerts.ts`, `node-files.ts`, the forms plugin's
  `main/selftest-script.ts`, and the session host's own composition root `src/session-host/session-host.ts`) and sessions'
  direct `os.userInfo`, `process.env`, `execPath` and `cwd` reads in `openRelay`; path rules already sit behind
  `services.paths`.
- **Forms self-test platform from services** — *agent-ready*: `src/plugins/forms/main/selftest-script.ts:63` sets
  `IS_WINDOWS` from `process.platform` at module level, so the chip paths ignore the platform the app chose. The forms
  main start passes `services.platform` into `formsSelfTestScript`, which picks the paths from it. Waits on that
  file's staged changes being committed.
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
- **Native window vibrancy** — *needs a feature plan*: macOS `vibrancy` and Windows 11 mica behind a window adapter,
  in place of the CSS backdrop under L1 glass (`docs/features/ui-design/design.md`).
- **Menu labels by label** — *agent-ready*: the app menu labels commands by `label`, not id
  (`src/main/keybindings.ts`).

## Plugin extension points

Closed lists that become registrations, so a plugin adds what is hardcoded today.

- **Runtime plugin loader** — *needs a feature plan*: a `PluginSource` seam (built-in list and a user folder of
  `manifest.json`, `main.js`, `page.js`); main `import()`s from disk and the page through `dataUrl`, and a
  `validateManifest` gives every plugin the checks `definePlugin` makes at compile time. `requireListed` and the
  static lists in `src/plugins/{main,page,manifests}.ts` are what block it. Builds on PluginHost stop and reload.
- **Forms item kinds as registrations** — *agent-ready*: forms item kinds register as one unit (`registerKind`, main
  and page, disposable), each declaring its wire keys (`argsKey`, `bodyKey`, `resultKey`,
  `fingerprintJoinsWhenEmpty`) so saved rounds, retro and the Python fingerprint stay byte-compatible. `Round` /
  `FormBody` / `AnswersPayload` hold `Record<kind, …>` inside and convert at the store and payload edge. On the page
  each kind is a `PageKind` module (items, restore/entry codec, reduce, boxes, kit, card input, review facts, rail
  order), replacing `RAIL_ORDER`, `ROUND_ITEMS`, `ANSWER_ARRAYS`, `PICK_ANSWERS`, `RECOMMENDED_PICKS`, `TextTarget`,
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
- **Workflow stage actions as commands** — *agent-ready*: a stage's actions (`StageActionSpec.command`,
  `src/plugins/workflow/contract.ts`) are a private string namespace sent over workflow's `runAction`, not commands,
  so a stage's buttons take no key, no palette entry and no intercept. Page-side actions are a closed switch
  (`switch (spec.command)` in `src/plugins/workflow/page/workflow-view.ts`), so a stage registered through `addStage`
  cannot add one. Each stage registers its actions as commands, main and page. With it, the shared flow fold stops
  naming one stage's skill (`MAKE_SKILL = 'wigley:make'`, `src/plugins/workflow/flow.ts`): the stage that owns it
  declares it.
- **Setting control kinds as registrations** — *agent-ready*: `SettingKind` (`'string' | 'number' | 'boolean'`,
  `src/contracts/plugin.ts`) and the settings layout's row `control` union (`src/plugins/settings/layouts/layout.d.ts`)
  are closed, and Settings mode switches over them (`setting-rows.ts`, `setting-rows-view.ts`). A plugin with a
  structured setting (chat's profiles, docs' config folders) cannot contribute its editor. A plugin registers a
  control kind with its row editor and its layout part, and the `control` field becomes a string so a new kind does
  not break a user settings layout. The layout name picker (Features) is then one such kind.
- **Sessions queries and row decorations** — *needs a feature plan*: `activeChanged` landed; still missing are
  `rows()` (page) and `sessions()` (main) queries so a late plugin sees live sessions (slots in the plugin state
  registry, Foundations, rather than hand-written queries), a page `tabShown` event,
  `SessionTabView.hidden()` beside `shown()`, row decorations a tab contributes (`handle.setBadge(key, text)`) or a
  sidebar row layout, since tabs' `setStatus` lines overwrite each other, and one close mechanism (`beforeClose` on
  the page and `addCloseGuard` in main both carry forms' "open round" today). With it, two tabs' take-overs released
  out of order must stop giving the session back to the first taker's tab after its take-over ended (pinned by
  `sessions/page/tabs.test.ts`; only forms takes over today).
- **Sessions stops knowing forms** — *agent-ready*: `mark(sessionId, { text })` lets the marking plugin word the toast
  (today "Round from…", `sessions/page/tabs.ts`), the empty-state text is generic or contributed,
  `SessionRow.marked` is documented generically, and `SessionInfo.deadlineSeconds` moves to an opaque host record
  forms reads. The layout preview passes a `label` instead of `projectDir: 'Layout preview'`.
- **Layout hot reload keeps the user's place** — *agent-ready*: `round-view.ts` `rebuild` (run by `setLayouts` when a
  reload changes a layout it draws with, and by a card part or review column added or disposed) destroys and
  remounts every box. It focuses the focused box again (`keepFocusedBox`), in insert mode at the text's end when it
  was inserting, and keeps the main column's scroll, but loses the cursor, a visual mode and undo. Add
  `snapshot`/`restore` to `TextEditor`, restore them in `keepFocusedBox`, and swap a CSS-only change without a
  rebuild. Redraw only the cards a changed layout draws, reading `LayoutSet.changed` (kept unread for this, by the
  user's ruling). Forms is the owner this covers: chat's composer keeps its box and draft across a redraw, and docs'
  doc pane redraws its frame only after the editor closes.
- **Layout access to the raw bridge** — *needs a feature plan*: the page imports every layout module into its main
  world (`importModule` in `src/renderer/renderer.ts`), where preload exposes the whole Bridge as `window.wigley`
  (`src/preload/preload.ts`). A user layout can therefore invoke any plugin's channel outside every API, contract and
  disposal. Decide whether this is a sanctioned power-user hook (then document it and type it) or closed (layouts
  in a scope with no `window.wigley`, data through the kit). The plugin state registry's `kit.state.read`
  (Foundations) is the sanctioned route for data a layout needs.
- **Window plugin** — *agent-ready*: window commands (`window.summon`, registered in `src/main/window.ts`) move into a
  small `window` plugin.
- **Replaceable core services decision** — *needs a feature plan*: decide whether core services (`markdown`,
  `editor`, `alerts`) are replaceable by a plugin (a `provides` service registry) or deliberately not, and record it
  in `plugin-framework/design.md`.

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
  the keys). Builds on the runtime command API (command labels) and the core picker service. Deferred from the docs
  browser (`docs-browser/design.md`).
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
  (`openSplitPicker`, `src/plugins/sessions/page/start.ts`) passes no `drawRow` to `createListPicker`, so its rows do
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
  session-form idle state (`emptyState(deps.idleText)` in `src/shared/page/session-form-tabs.ts`; sessions' empty
  pane already draws through `parts.emptyText`), the cursor-row action prompts (backlog, docs, settings, primer and
  notes), and the settings edit-box message (`settings/page/row-box.ts`). Pass each as part input, or a `drawIdle`
  hook on `createSessionFormTabs`, so the layout draws it.
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

## Latent defects and tests

Defects with no path to the user today, checks waiting on a live window, and test cleanup. Test cleanup goes last
because the earlier items rewrite many of these tests anyway.

- **Docs editor-landing issues** — when the docs editor lands: an editor key sequence bound only in other scopes is
  taken from vim in every editor, so a normal-mode Esc in a docs box runs nothing and logs `<Esc> has no bind in
  docs.…` while forms binds `<Esc>`; a new round selects its session's Form tab, switching away from a Docs tab
  mid-edit; and a row removed while its round stays open rebuilds that round's Form tab in a hidden body nothing drops
  after the round closes.
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
  errors after `all passed`: `watchDoc`, `pluginStatus`, `loadIndex`, `loadHistory`. Decide whether a live `stop(id)`
  stops the page part first, and quiet the lines a quit produces.
- **Withdrawn tools reach live hosts late** — *agent-ready*: at a stop, withdrawn tools and shrinking tool lists need
  to reach live hosts before `relay.close`, and the relay's second notice arrives only on the host's next `tools/call`.
- **A stop drops unsaved text** — notes' popup and a forms draft lose what the user typed when their part stops. The
  page-stop path has no production caller yet, so this bites when a plugin can be switched off live.
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
- **Docs page test seam for a session's host id change** — *agent-ready*: after `/clear`, the docs page hears
  `sessions.sessionHostChanged` and calls `DocsView.sourceReplaced()`, which rebuilds a session Docs tab that has
  shown (`src/plugins/docs/page/start.ts`, `docs-view.ts`). No test pins it: the docs page has no unit test file, and
  the chat self-test's clear step never shows chat-second's Docs tab. Either give the docs page a test seam with a row
  for a shown tab (rebuilds) and an unshown one (does nothing), or add a self-test step that shows the Docs tab before
  the clear and expects a rebuild line after it.
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
  and `roundToastText`, `languages.test.ts`'s `@codemirror/language-data` aliases, and docs'
  `nameProblem_Rules_PinnedMessages` unless those messages are a contract.
- **One test naming style** — *agent-ready*: sentences. `Name_Case_Result` names remain in `main-api.test.ts`,
  `layout-loader.test.ts`, `layout-registry.test.ts`, `card-input.test.ts`, `which-key.test.ts`,
  `help-sections.test.ts` and `docs-state.test.ts`.
- **`$name_<suffix>` vitest titles lose their case name** — *agent-ready*: vitest reads `$name_BadId…` as one key
  `name_BadId…`, so each row's title loses its name (the repo's own note, `src/shared/fake-agent-harness.test.ts:875`).
  Six sites: `src/plugins/usage/main/drive-actions.test.ts:101`, `src/plugins/workflow/page/workflow-view.test.ts:484`,
  `src/plugins/workflow/layouts/default/layout.test.ts:117`, `src/plugins/workflow/main/flow-store.test.ts:87` and
  `src/main/drive/drive-commands.test.ts:131` and `:152`. Fix as the note says: each row carries its whole name, and
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
- **Docs tab's first show has no test** — *agent-ready*: `handle.shown` runs `showFirstTime`
  (`src/plugins/docs/page/start.ts`), which runs `loadIndex` (`docs-view.ts`). The forms self-test used to pin it live
  through its `y` step, and now presses `R`, because rows draw in no fixed order and an earlier step can pass the Codex
  row first. No test creates `createDocsView` (about 20 deps) and `page/start.ts` has no test, so a pin needs a small
  seam first. Source session: Claude Code e8ba2d1d-78ea-49b9-9c2e-b2a0b2382d85 in wigley-ai-gui.
- **Chat self-test steps by single presses** — *agent-ready*: rows draw most recent first and rows opened in one
  millisecond tie, so the chat script's single `<A-S-o>` and `<A-S-i>` steps between its two rows may land elsewhere.
  It passes today and was not audited for ties or rows left open. Forms' `stepToRow` and sessions' `stepNextTo` hold
  the shape, and could become one shared helper. Source session: Claude Code e8ba2d1d-78ea-49b9-9c2e-b2a0b2382d85 in
  wigley-ai-gui.
- **Sessions header wraps at the side bar's least width** — *agent-ready*: `Sessions` draws as `Session` / `s` at
  160 px in the default layout. Its markup predates the session groups work. Source session: Claude Code
  e8ba2d1d-78ea-49b9-9c2e-b2a0b2382d85 in wigley-ai-gui.
- **Preview's sample statuses read as chat's** — *agent-ready*: `PREVIEW_STATUSES` in
  `src/plugins/sessions/page/preview.ts` holds `working` and `waiting for permission`, though chat no longer sends a
  status and a row's second line now shows only a form's or primer's. Source session: Claude Code
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
- **A row's id changes across an app relaunch, so a re-attached session's `/clear` loses its pool claim** — *needs a
  feature plan*: once the `unity-pool` plugin lands, the launcher sets `WIGLEY_SESSION_ROW` to the row's app id
  (`AgentStart.rowId`). Chat reopens each saved row through `sessions.open`, which makes a new `randomHex()` id
  (`src/plugins/sessions/main/session-list.ts`). A process the session host kept running and chat re-attached keeps
  the old id in its environment. Its first `/clear` hands off under the old row id and starts the new process under
  the new one. The pool then misses the handoff, and the claim falls back to the expiry rules
  (`~/wigley-agents/tools/unity-pool/README.md` § Claims). The badge still finds the row by host session id. To
  decide: keep a row's app id across relaunch, or have `/clear` pass the old row id to the new process.
