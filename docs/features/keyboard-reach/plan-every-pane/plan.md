# Keyboard reach for every pane — plan

Feature: keyboard reach · Implements: none · Ticket: none
Target: main (wigley-ai-gui) · Written: 2026-11-08

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

In normal mode (focus not in a text box), every pane, subpane and interactable surface of the app can be reached and
operated from the keyboard. Alt+h/j/k/l moves between panes. Inside a pane, vim's own keys (j/k, gg/G, h/l, Enter,
Esc) move and act the same way everywhere. The user's named gap: the Sessions side bar can't be selected or navigated
by keyboard.

## Architecture

Systems touched, all in wigley-ai-gui:

- **Core focus chain**: `src/renderer/pane-targets.ts`, the `Mode` contract and the shell areas in
  `src/contracts/plugin.ts`, `src/renderer/shell/` (modes, the right bar area), `src/renderer/plugins/page-api.ts`,
  `src/renderer/renderer.ts`.
- **Modes with side bars**: sessions (`src/plugins/sessions/page/`), docs, backlog, settings; gallery (no side bar,
  `focusMain` only).
- **Right bar**: unity-pool's panel (`src/plugins/unity-pool/page/`, its default layout).
- **Chat tab**: `src/plugins/chat/page/` (transcript, box, session hub), agent-strip.
- **Consistency**: docs right column, forms, primer, gallery, keys help, the shared list picker
  (`src/shared/page/list-picker.ts`).
- **Keys**: `src/plugins/keymap.ts` (every task), each plugin's `manifest.ts` scopes and commands, the self-test scripts.

## Preconditions

- Worktree branch `keyboard-reach` from `main` at `9ea97ead` (rebased from `e38de06f`), which matched `origin/main` at plan time
  (`git -C /Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui fetch origin && git status -sb` → `## main...origin/main`).
  Re-run, and rebase onto `main` if it moved.
- A sibling plan, `docs/features/session-popups/plan-form-popup/`, is not started (every box unticked; checked with
  `grep -n '\- \[' docs/features/session-popups/plan-form-popup/plan.md`). Its tasks touch
  `src/plugins/sessions/page/start.ts`, `src/plugins/docs/page/start.ts` and `src/plugins/primer/page/primer-commands.ts`,
  which this plan touches too. Whichever plan runs second rebases over the other. The session popup and its
  `<Leader>vf` key are out of scope here; they come with that plan. Re-run the grep before the first dispatch.
- No code calls `setFocusTarget` under `src/plugins/chat/` or `src/plugins/sessions/`
  (`grep -rn setFocusTarget src --include='*.ts'` → settings, primer, backlog, docs, forms (resize only), gallery
  (resize only), page-api, pane-targets). Re-run; a new caller changes Tasks 03 and 06.
- The follow-up "Pane focus keys leave the keyboard in the old pane" is at `docs/features/followups.md:192` (measured
  at plan time, re-verify by its title). Task 03 fixes it and removes the entry.

## Docs written ahead

Commits `e02122c5`, `2991f516` and `3e3c2fcb` on `keyboard-reach`: `docs/keymap.md` § Layers (the Alt+hjkl chain through the areas, the side-bar
list rule, the picker key set, gg/G and j/k on every pane, the scroll-key view list, the hub in the resize order, `ci`
in the chat-controls leader row), `AGENTS.md` (the mode bullet's `focusSideBar`/`focusMain`, the focus-target bullet's
areas, the right bar's `focus`, the side-part line's hub), and `DESIGN.md` § Keys and focus (the Sessions list's
cursor prompt). `2991f516` adds the session hub and the doc's right column to the Ctrl+n and scroll-or-rows
lists with the column's `Enter`/`l`/`Esc`, chat `y`/`n` on the permission under the cursor, `ci` on the page as well
as in a box, and the hub's Alt+Shift+h/l in AGENTS.md's side-part bullet. `3e3c2fcb` limits the hub's Alt+Shift+h/l to while
the hub has the keys, in keymap.md's resize order, DESIGN.md's Splits line and `docs/features/chat-bar/design.md`.

## Mandatory Reads

- `AGENTS.md` (wigley-ai-gui root) — every task reads § Architecture's bullets on the shell, a mode, a session tab, a
  chat pane, a key, a key scope, a resize target, a focus target and key hints (lines 421-600), and § Running and
  testing's self-test bullet. Chat tasks also read the composer part, side part and status part bullets.
- `DESIGN.md` § Keys and focus.
- `docs/keymap.md` whole.
- `~/wigley-agents/AGENTS.md`, `~/wigley-agents/decisions.md` (lead only).
- Every `AGENTS*.md` under a touched folder: `find src -name 'AGENTS*.md'` (none at plan time; re-run).

## Design Overview

### The focus chain, after

```
Alt+<dir> (panes.focus*, scope any)
  │
  ├─ a scope is pushed? ──────────────► log "no pane <dir> while a scope is pushed"
  │
  ├─ area = side   : right → mode.focusMain()            else log "no pane <dir>"
  ├─ area = right  : left  → mode.focusMain()
  │                  up/down → previous / next right-bar stop    else log
  │
  └─ area = main   : view FocusTarget.move(dir)
                     → OuterPanes.focus.move(dir)          (Sessions' chat panes)
                     → left  & side bar shown & mode.focusSideBar  → mode.focusSideBar(), area = side
                     → right & right bar shown & ≥1 stop            → stops[0].focus(), area = right
                     → log "no pane <dir>"

every base scope change the core did not make itself → area = main
```

- `area` is core state in `pane-targets.ts`. The core sets it after the hook it calls, so that hook's own
  `setScope` (which resets `area`) doesn't undo it.
- A stop that hides (its contribution disposed, or the right bar hidden) while it holds the area ends the area's
  turn: the core calls `focusMain`.
- Every move hands the DOM focus to the pane it enters, so no box in the pane it leaves keeps the caret.

### Decisions

From the interview round (all on the recommendation):

- One core rule reaches the side bar. Docs, Settings and Backlog drop their own side-bar step and use it; Sessions
  gains it.
- The right bar is a stop for contributions that pass `focus`, starting with unity-pool's session links.
- Sessions list keys follow the docs tree: j/k, gg/G, Enter (show the session in the focused pane and focus it),
  l (show it, keep focus), Esc (back to the pane), plus `s`, `J`/`K`, `r`, `d` on the cursor row.
- Chat tab: Alt+l/h enter and leave the hub, and Alt+j/k move between the transcript and the box before leaving the
  tab.
- Chat items: y/n act on the permission under the cursor, Enter toggles the expander in the cursor's block,
  and `<Leader>ci` shows the attachments in the image viewer, with `x` removing the shown one.
- The Docs right column becomes a pane.
- Every in-pane vim-key gap closes, including one shared picker key set and one side-bar Enter/l rule.
- Alt+h with the side bar hidden stays put.

Decided by the agent (sent as notices in the round, or in the hand-off reply):

- The title, activity and status bars stay off the chain.
- The follow-up at `followups.md:192` is folded in.
- Sessions gets the narrow-overlay hooks.
- The Sessions cursor walks session rows only.
- The hub gets a resize target.
- Ctrl+j/k scroll an open agent-strip box.
- Notes markup drawing and the Gallery samples stay mouse-only.
- Popups are left to their own plan.
- Doc links stay on Tab.
- The hub cursor walks section heads only.
- The Forms rail stays a follower.
- `focusMain` is required on every `Mode` and `focusSideBar` is optional, so the compiler reaches every mode.
- The right bar's `focus` sits on a right-bar-only options type, so other areas' `contribute` stays as it is.

Decided by the lead after the drafts and the cold read (each in its task's rulings):

- The Sessions selected card keeps its hidden prompt line at all times (`DESIGN.md`'s cursor prompt rule).
- A key move into a Chat tab lands on the transcript in normal mode (from Task 03); a click still focuses the box.
- The narrow side-bar overlay holds the keys as the side area (`ModesDeps.sideBarOpened`).
- The right bar's turn ends when the DOM focus leaves it; the core calls the contribution's `left`.
- The hub resizes by Alt+Shift+h/l only while it holds the keys; a box focus or transcript click ends its turn.
- Docs `focusMain` returns to the right column when it was the last pane and is still in sight.
- The Backlog homes bind only their own keys; `h / a i d t T o` are list-only.
- The unity-pool cursor re-enters on the shown session's holder.

### Out of scope

- Session popups.
- Pointer-only canvas drawing.
- Gallery samples.
- A link cursor inside a rendered doc.
- Collapsing project groups in the Sessions list.

## File Structure

Existing files modified (by task):

| File | Tasks |
|---|---|
| `src/contracts/plugin.ts` | 01 |
| `src/renderer/pane-targets.ts`, `pane-targets.test.ts` | 01 |
| `src/renderer/shell/modes.ts`, `shell.ts` (right bar area), `src/renderer/plugins/page-api.ts`, `src/renderer/renderer.ts`, `modes.test.ts`, `shell.test.ts`, every test that builds a `Mode` | 01 |
| `src/plugins/settings/page/settings-view.ts`, `src/plugins/backlog/page/backlog-view.ts` (`focusMain` members) | 01, 05 |
| each mode's `mode.add` site: `src/plugins/{sessions,docs,backlog,settings,gallery}/page/start.ts` (`focusMain`) | 01 |
| `src/plugins/unity-pool/page/{start,pool-view-model}.ts`, `pool-view-model.test.ts`, `unity-pool/layouts/layout.d.ts`, `layouts/default/layout.{js,css}`, `unity-pool/manifest.ts` | 02 |
| `src/plugins/sessions/page/{start,sidebar-view,sessions-view,sidebar-order}.ts`, `sessions/page/layout/sessions-parts.ts`, `sessions/manifest.ts`, `sessions/layouts/layout.d.ts`, `sessions/layouts/default/layout.{js,css}` (cursor ring), `src/shared/page/pane-tree/pane-tree-view.ts`, `docs/features/followups.md`, `src/shared/plugin-part-harness.test-support.ts` | 03 |
| `src/plugins/docs/page/{start,docs-state,docs-view,doc-aside,doc-view}.ts`, `doc-view.test.ts`, `docs/manifest.ts` | 04 |
| `src/plugins/settings/page/{start,settings-view}.ts`, `src/plugins/backlog/page/{start,backlog-view,backlog-state}.ts`, the backlog layout files, `settings`/`backlog` manifests | 05 |
| `src/plugins/chat/page/{chat-view,start,side-sections,chat-commands}.ts`, `chat.css`, `chat/manifest.ts`, `src/contracts/editor.ts` and `codemirror-vim-host.ts` (`blur(options?: BlurOptions)`), `src/shared/page/test-dom.ts` (`getClientRects`) | 06 |
| `src/plugins/chat/page/{chat-commands,chat-kit,composer-kit,image-viewer,entry-list}.ts`, `chat/manifest.ts`, `chat/layouts/layout.d.ts`, `chat/layouts/default/layout.{js,css}`, `src/plugins/agent-strip/page/{agent-strip,start}.ts`, `agent-strip/manifest.ts`, `src/shared/fake-agent-harness.ts` | 07 |
| `src/plugins/docs/page/doc-view.test.ts` (scroll edges), `src/contracts/list-picker.ts`, `src/shared/page/list-picker{,-state}.ts`, `list-picker.css`, `src/renderer/plugins/page-api.ts`, `src/plugins/keys/{manifest.ts,page/help-view.ts}`, `primer`, `forms`, `gallery` page commands and the primer layout, the docs and backlog scroll commands, the six picker plugins' (`sessions`, `chat`, `docs`, `settings`, `backlog`, `notes`) manifests and views | 08 |
| `src/plugins/keymap.ts` | every code task |
| each touched plugin's `main/selftest-script.ts` | the task adding that plugin's keys |

New files: `src/shared/list-picker-commands.ts` (08) — the one picker command set every picker scope binds, so the
keys can't drift per plugin again. A new module is otherwise justified only where a task document names one.

New contract members (one name, used by every task):

- `Mode.focusSideBar?(): void` — sets the side bar's key scope and focuses its list.
- `Mode.focusMain(): void` — gives main's last pane back its scope and DOM focus.
- `RightBarOptions extends ContributeOptions { focus?(): void; left?(): void }`, taken by the right bar area's
  `contribute`; the core calls `left` when the stop's turn ends (Task 01's rulings).
- `ModesDeps.sideBarOpened(): void` — modes tells the core the side bar opened over main.
- `PaneTargets` keeps `area: 'main' | 'side' | 'right'` internally. Public: `baseChanged()` (replaces
  `dropViewTargets`), `stopRemoved(stop)`, `sideBarOpened()`; `createPaneTargets` takes `areas: PaneAreas` last.
- `PaneAreas { focusSideBar(): boolean; focusMain(): void; rightBarStops(): readonly RightBarStop[] }`,
  `RightBarStop { focus(): void }`, `RightBarArea`, `ShellAreas`; `PluginAreas.rightBar: RightBarArea`.
- Core log lines every self-test waits on: `[page] focus in the side bar`, `[page] focus in the right bar`,
  `[page] focus back in main`.

New scopes:

- `sessions.sidebar`
- `chat.hub`
- `unity-pool.panel`
- `docs.aside`
- `backlog.homes` (05)

Boundary rules:

- Plugins reach the areas only through `Mode` and `RightBarOptions`; none imports `pane-targets.ts`.
- No view binds Alt+hjkl.
- Every new bind that isn't one of vim's own keys has an anchor (the placement check fails otherwise).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Every code task edits `src/plugins/keymap.ts`, so the code tasks run one per wave.

### Wave 1
- [x] [Core area focus](01-core-area-focus.md)

### Wave 2
- [x] [Unity-pool right-bar stop](02-unity-pool-right-bar.md) — after 01

### Wave 3
- [x] [Sessions list pane](03-sessions-list-pane.md) — after 01

### Wave 4
- [ ] [Docs side bar and right column](04-docs-side-bar-and-aside.md) — after 01

### Wave 5
- [ ] [Settings and Backlog side bars](05-settings-backlog-side-bars.md) — after 01

### Wave 6
- [ ] [Chat tab panes](06-chat-tab-panes.md) — after 01

### Wave 7
- [ ] [Chat mouse-only items](07-chat-items.md) — after 06

### Wave 8
- [ ] [In-pane key consistency](08-in-pane-consistency.md) — after 04, 05

### Wave 9
- [ ] [Doc re-read](09-doc-re-read.md) — after 01–08

### Wave 10
- [ ] [Final verification](10-final-verification.md) — after 09

## Run log

Review base: 1a938e2f

### Groups
- 01 · 5e5cca77 · diff read (every Produces present or in Contract changes), typecheck pass, worker ran 6 touched test files (278 pass) · concerns: baseChanged row asserts ['outer left','side bar'] since baseChanged drops the view target; a hook moving DOM focus before its setScope while a stop holds the keys runs focusMain early (narrow sideBarOpenedOver); a click into main from the right bar runs focusMain on mousedown before the click picks its pane — live check; lint oxfmt fails on docs/keymap.md, pre-existing from docs-ahead 3e3c2fcb
- 02 · 9c50228e · diff read (Produces present, five binds found), typecheck pass; worker ran pool-view-model tests (70 pass), lint pass, selftest --plugin unity-pool pass · concerns: no typed HolderInput literals existed to gain isCursor; drawPanel builds panelInput twice per draw to clamp the cursor; re-entry step cannot tell the shown session's holder from index 0 (one holder in the fixture); inline panelSlot.style.outline='none' to stop :focus-visible drawing a second ring
- 03 · 8173424e · diff read (12 binds, SessionList, SidebarCursor, cursor rules, keyFocused, isPrompted/cursorPrompt present; follow-up removed), typecheck pass; worker ran 1026+212 tests, lint, selftest sessions and unity-pool pass · concerns: sessions-view-fakes.ts edited outside Files for the two deps; paneKeyFocused_ReshowsTheTab's no-focusBox check is weak (harness cannot run it); an Alt pane move runs the new tab's shown twice; selected card always one line taller (hidden prompt line) — visual check; right-bar focusin and list focusin-in-main listeners can both run on one move (disjoint state)
### Contract changes
- focus leaving the right bar: a document focusin listener inside the core → PaneTargets.focusLeftRightBar() + Shell.rightBarHolds(node), the one listener in renderer.ts · why: keeps pane-targets.ts DOM-free and node-env testable · consumers: 02 (gets left through it) · group 01
- SessionsParts.row (internal): (parent, input) → (parent, input, cursorPrompt) · why: the prompt element reaches the row kit's appSlot · consumers: none · group 03
- PagePartHarness gains mode(id), picks, setSideBarShown, scope(), outerPanes() · why: start.test needs them · consumers: 04, 05, 06 tests · group 03
### Rulings
- Alt+j/k between stops calls the left stop's left before the next stop's focus — left runs on every end of a turn — harmless if wrong · group 01 · group 01
- every return to main writes area=main and calls left before focusMain (unlike entering, written after the hook) so a focusin during focusMain finds main already holding — double focusMain if wrong · group 01 · group 01
- focusLeftRightBar logs focus back in main; sideBarOpened ends a held stop's turn first — an extra log line if wrong · group 01 · group 01
- focus() also logs cursor on <label> so the re-entry step can expect the row — an extra log line if wrong · group 02 · group 02
- added exported heldCloneCursor in pool-view-model.ts for re-entry — one more export if wrong · group 02 · group 02
- lead: docs/keymap.md oxfmt reflow committed on its own (9764f9bc), a pre-existing lint failure on main · lead · group 02
- harness sideBarShown follows a settable flag, false by default — later tests call setSideBarShown(true) · group 03 · group 03
- cursor ring is the card's border-color focus-border with box-shadow none, not the inset ring — reads 2px if the plan meant inset · group 03 · group 03
- pointerdown/focusin inside main end the turn through checkVisible(true) (chat's shown moves no DOM focus) · group 03 · group 03
- list.cursorSessionId() returns the selected row's id while the list lacks the keys · group 03 · group 03
- list overlay ends with Space p f unfavoriting panes-b so the script ends with no favorites · group 03 · group 03
### Review rounds
### Test gate
