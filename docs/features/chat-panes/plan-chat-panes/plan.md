# Chat panes — plan

Feature: chat panes · Implements: none · Ticket: none
Target: main · Written: 2026-10-30

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — tmux-style panes in Sessions mode.
- **Architecture** — the systems this plan touches.
- **Preconditions** — repository state the plan rests on, with the commands that check it.
- **Docs written ahead** — the docs already committed, and the commit.
- **Mandatory Reads** — the docs every implementer reads first.
- **Design Overview** — the after-state flow, decisions, and out of scope.
- **File Structure** — files modified and created, and the boundary rules.
- **Tasks** — the wave checklist.
- **Run log** — written by `wigley:make`.

## Goal

Sessions mode splits into a tree of panes. Each pane shows one whole session. The one side bar
drives the focused pane. The keys copy the user's tmux config, and `Alt+hjkl` passes from a view's
own panes to the chat panes, as smart-splits does between Neovim and tmux.

## Architecture

- **Core pane keys** (`src/contracts/panes.ts`, `src/renderer/`, the page plugin API): a new
  focus target seam beside the resize target, an outer-panes slot, and the core focus commands.
- **Shared pane tree** (`src/shared/page/pane-tree/`): a new module with a pure tree core and a
  DOM view.
- **Sessions plugin, page part**: the pane rules, the per-session tab frames, the picker, the
  pane commands, persistence, and the layout contract.
- **Tab plugins** (chat, forms, docs, primer, and `src/shared/page/session-form-tabs.ts`): each
  tab names its icon.
- **Focus target owners** (docs, primer, backlog, settings): each per-view `Alt+h`/`Alt+l` command
  becomes a focus target.

## Preconditions

`wigley:make` runs each command again before the first dispatch.

- The branch is `main`, at or after the docs commit: `git merge-base --is-ancestor 8ba0285 HEAD`
  exits 0.
- Ten scoped `Alt+h`/`Alt+l` binds exist, and task 02 removes all of them:
  `grep -cE "'<A-[hl]>'" src/plugins/keymap.ts` prints `10` (measured at plan time, re-verify).
- No bind holds the new keys yet:
  `grep -nE "<A-[jkw';]>|<C-A-|<A-S-[jk]>" src/plugins/keymap.ts` prints nothing.
- The resize contract holds two directions only: `grep -n "ResizeDirection = 'left' | 'right'"
  src/contracts/panes.ts` prints one line.
- The vertical resize commands only log today: `grep -n "no pane divider runs up or down"
  src/renderer/renderer.ts` prints one line.
- `DESIGN.md`, `docs/features/agent-chat/design.md` and `docs/features/layouts/design.md` held
  uncommitted edits from another session at plan time. Leave them alone, and commit only the paths
  each task names.
- Two other plans were in flight on `main` at plan time and touch the same files:
  `docs/features/agent-chat/plan-activity-line/` (chat view and chat layout; overlaps 04's
  `chat-view.ts` edit) and `docs/features/agent-tower/plan-subagent-lines/` (sessions' `addRowPart`
  under each side bar row; overlaps 05b's `sidebar-view.ts`, `layout.d.ts` and default layout).
  Before each wave, check `git log` for their landed commits. Build on top of what landed, and keep
  their row parts drawing under each row.

## Docs written ahead

Commit `8ba0285`, plus the plan commit that follows it:

- `docs/features/chat-panes/design.md` — the settled design. It is the source for every rule
  below that it states.
- `AGENTS.md` § Architecture — the session tab icon, **A chat pane**, **A resize target** (the
  fallthrough chain), **A focus target** and **The outer panes**.
- `docs/keymap.md` § Layers — `Alt+hjkl`, `Alt+Shift+hjkl`, and the split, swap and close keys.

## Mandatory Reads

- `AGENTS.md` (whole file; § Architecture holds the seams this plan changes)
- `DESIGN.md` § Keys and focus, § Primitives, § Icons and copy
- `docs/keymap.md`
- `docs/features/chat-panes/design.md`
- `docs/features/layouts/design.md` (every new layout part follows it)
- `docs/features/key-hints/design.md` (every new bind has an anchor)

The repo holds no `.claude/rules/` folder and no nested `AGENTS*.md` outside `.drive/` (measured
at plan time).

## Design Overview

```
 key press (Alt+l)                                     side bar click / Alt+Shift+o / chat reveal
       │                                                              │
       ▼                                                              ▼
 core panes.focusRight ──► view FocusTarget.move ──true──► done    sessions exports.activate(S)
       │ false (view edge)                                            │
       ▼                                                              ▼
 OuterPanes.focus.move ──► pane tree focusToward          pane-sessions activationTarget
       │ (Sessions mode only)        │                       ├─ S in another pane → focus it
       ▼                             ▼                       └─ else → load S in focused pane
 null at outer edge: log    sessions: focused pane                    │
                            changes → its session's                   ▼
                            selected tab `shown()`        main.activate(S) ─► stateChanged echo
                            → main.activate(session)      (the page's own echo changes nothing)

 resize press (Alt+Shift+dir): view ResizeTarget.nudge ─false─► OuterPanes.resize.nudge
                                ─false─► side bar divider (left/right) ─false─► log
```

Decisions (each from the interview or the design review):

- A pane shows a whole session with its tab bar. A session shows in at most one pane (round 1).
- A side bar pick loads the session into the focused pane, or focuses the pane that shows it.
  Session steps skip sessions shown in other panes (round 1).
- A split opens the shared list picker. Esc closes the new pane (round 1).
- `Alt+w` closes the pane only. A pane whose session leaves closes. The last pane never closes
  (round 1).
- The layout persists in uiState by host session id (round 1).
- Smart-splits through one core focus target seam (round 2).
- Icon-only tabs: Chat `comment`, Form `checklist`, Docs `book`, Primer `lightbulb` (round 2).
- Rows on screen in an unfocused pane carry a quieter mark (round 2).
- A round in an unfocused pane leaves focus where it is (round 2).
- The focused pane's border uses the existing `focus-border` token, the app's one focus ring. No
  new theme token (design review; replaces the round-2 notice that named a new token).
- The pane tree is a shared module: a pure core that tests drive without the DOM, and a view
  (design review: depth, testability).
- Main's session list does not change. The page derives the side bar's selected row from the
  focused pane, and keeps main in step through `activate` (design review: locality).
- `SessionTabHandle.isVisible` and `SessionTabView.shown` keep one meaning: the focused pane's
  selected tab. No new on-screen API, since no consumer needs one yet (design review).

Out of scope:

- Pane zoom (tmux `prefix z`): the user's tmux config binds no key for it.
- Splits in Docs, Backlog or Settings mode.
- One session drawn in two panes.
- Moving the shared list picker over the new pane: it opens in its usual place.

## File Structure

Modified:

- `src/contracts/panes.ts` — `PaneDirection`, `ResizeTarget.nudge` returns boolean, `FocusTarget`,
  `OuterPanes`, `PANE_FOCUS_COMMANDS` (01).
- `src/contracts/plugin.ts` — `PageApi.panes` grows (01).
- `src/renderer/renderer.ts`, `src/renderer/plugins/page-api.ts`, `src/config/keymap.ts` (01).
- `src/shared/page/ui/split.ts`, `split-width.ts` and their tests (01).
- `src/plugins/keymap.ts` (01 vertical resize binds; 02 focus binds; 05 pane binds).
- docs, primer, backlog and settings page parts, manifests, default layouts and self-test scripts,
  and `src/shared/page/layout-host/base-kit.ts` with `kit.d.ts`, so a layout can name a core
  command (02).
- `src/plugins/sessions/` contract, layout contract, default layout, page part (04, 05a, 05b).
- `src/shared/page/session-form-tabs.ts`, `src/plugins/chat/page/chat-view.ts`,
  `src/plugins/docs/page/start.ts`, forms and primer tab sites (04).

Created:

- `src/renderer/pane-targets.ts` and its test, replacing `pane-resize.ts`: the chain grows from one
  target to three, so the module is renamed for what it now holds (01).
- `src/shared/page/pane-tree/` — `pane-tree.ts` (pure), `pane-tree.test.ts`, `pane-tree-view.ts`,
  `pane-tree.css`: no tree-of-splits module exists; the two-pane `Split` stores one pixel width
  and cannot describe a nested tree (03).
- `src/plugins/sessions/page/pane-sessions.ts` and its test: the rules that tie panes to
  sessions, pure (05a).
- `src/plugins/sessions/main/selftest-script.ts`: the sessions plugin has no self-test script yet
  (05b).

Boundary rules:

- `src/shared/page/pane-tree/` imports only `src/contracts` and `src/shared`. It knows nothing of
  sessions: a leaf is an id string.
- A plugin reaches the focus and outer-pane seams only through `api.panes`.
- No plugin binds `Alt+hjkl` in its own scope.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1

- [x] [Core focus and resize targets](01-core-pane-targets.md)
- [x] [Tab icons](04-tab-icons.md)
- [x] [Pane session rules](05a-pane-session-rules.md)

### Wave 2

- [x] [Focus targets in docs, primer, backlog and settings](02-view-focus-targets.md) — after 01
- [x] [Shared pane tree](03-pane-tree.md) — after 01

### Wave 3

- [x] [Sessions panes](05b-sessions-panes.md) — after 01, 02, 03, 04, 05a

### Wave 4

- [x] [Doc re-read](06-doc-re-read.md) — after 05b

### Wave 5

- [x] [Final verification](07-final-verification.md) — after 06

## Run log

Review base: 6562c495f9c5949743e50df7b963f344c3ee6d31

### Groups
- 05a · ab1e090 · diff read + typecheck clean in its files · concerns: none
- 04 · ed4d503 · diff read (SessionTabView.icon, SessionTabInput.icon, form-tabs deps icon present) + typecheck clean in its files; 3 touched test files pass per the worker (22); peer chat-view.ts hunk left unstaged · concerns: contract.ts SessionTabView comment's first line runs past the wrap width
- 01 · e5a3813 · diff read (PaneDirection, ResizeTarget boolean, FocusTarget, OuterPanes, PANE_FOCUS_COMMANDS, PageApi.panes, PaneTargets, createPaneTargets present) + whole-tree typecheck clean; named tests pass per the worker, primer-view's base-failing rows aside · concerns: docs/features/usage/plan-usage/01-right-bar-area.md:28 still names createPaneResize (another plan's doc); Alt+Shift+j/k show no key-hint prompt until a vertical divider exists
- 03 · 83cebe9 · diff read (every Produces in pane-tree.ts and pane-tree-view.ts present; split.ts prompt output unchanged) + typecheck clean in its files; pane-tree and split tests pass per the worker (79) · concerns: a slot moved in the DOM loses keyboard focus (focused slot on split, both on swap, sibling's on close) so 05b must restore editor focus; swap calls changed but not focused
- 02 · 9c84f9d · diff read (four any focus binds; each view hands a FocusTarget beside its resize target; kit resolves dotted names) + whole-tree typecheck clean; Done-when grep prints nothing; view tests pass per the workers (707 + 167, primer-view's 3 base-failing rows aside); self-test passes every step but the pane binds' unplaced lines (see ruling) · concerns: backlog-view.ts: paneTo was inserted between cursorActionsSlot's comment and its function, orphaning that comment; a pushed scope (backlog filter, picker, confirm) keeps the view's targets and any-scope Alt+h/l fire there, moving list/detail behind the overlay (the scoped binds did not); self-test unplaced lines for panes.focus* and resizePaneUp/Down until 05b
- 05b · 6090d0d + c1dcc6b (chord fix) · diff read + typecheck clean; selftest all passed, every key placed · concerns: up/down focus edges overlay the tab bar's buttons in a stacked pane
- 06 · 2b44679 · Diff read: AGENTS.md 4 hunks (sessions folder line, least sizes, chord keys, resize/focus edge logs), docs/keymap.md 2 lines, chat-panes design.md 2 bullets; oxfmt clean on AGENTS.md and design.md, keymap.md fails identically at HEAD (pre-existing) · concerns: DESIGN.md ~388 omits Alt+Shift+j/k; keymap.md Raw key bullet does not name docs.backToTree; design.md key table misaligned (pre-existing)
- 07 · none · typecheck pass; npm test 4284/4284; selftest all passed; lint only pre-existing DESIGN.md + docs/keymap.md format. Screenshots: frame on focused pane only, rings on unfocused rows; stacked right-column tab icons clipped to '[', bottom-right frame short of the right edge, resize prompt overlaps swap prompt. Drive (reports/07-drive-1.md): 1 PASS, 2 PASS, 3 PASS (draft survives swap and cancelled split), 4 PASS, 5 PASS via eval location.reload() (Cmd+r key does not reload under drive), 6 FAIL partly — focus stays, attention dot right, but .form-tab .round is hidden while its pane is unfocused so the round is not drawn until focused, 7 PASS at 320px and 187px. Also: tab icon clipped at ~280-300px; in a 700px window panes were 213/187px (under the 280px least) and the right pane's close button cut off. · concerns: Findings for review: check 6 round hidden in unfocused pane; tab icon clipping in narrow panes; panes below least size in narrow window; stacked prompt overlap
### Contract changes
- pane-tree.ts: also exports clampedRatio(ratio, least) and withSplitRatio(tree, split, ratio) · why: the view's drag clamps and sets a ratio with nudgeFocused's own functions · consumers: none · group 03
- split.ts: exports NUDGE_PROMPT_MS and splitResizePrompt(anchor, start: ResizePromptEnd, end: ResizePromptEnd): { element, anchors } (the helper the task named) · why: the pane tree view shares the prompt and its linger · consumers: none · group 03
- sessions manifest: adds a picker scope and four picker commands (down, up, choose, cancel) bound j, k, Enter, Esc there · why: the shared list picker pushes an owner scope · consumers: none · group 05b
- tab bar hints: is-no-target sits on the key inside each split/close button, not the button · why: on the button it hides it, and a click in an unfocused pane must focus it and run the command · consumers: none · group 05b
### Rulings
- plan.py matches only NN- task prefixes, so 05a and 05b's Status, box and Proof edits are made by hand in the same shape — none — a mis-shaped hand edit, caught at the final gate · lead
- peer ai-dev-e8's uncommitted chat-view.ts hunk (turn-end latest, ~lines 233-240) stays in the tree; 04 edits the file and commits only its own hunk through a cached patch, checked with git diff --cached — settled with the peer — a swept peer hunk, caught by the cached-diff check · lead
- paneOf returns the first pane in map order when two show one session; restorePanes takes the first row when two share a host id — neither can happen under the one-pane-per-session rule — none · group 05a
- FormTabView in session-form-tabs.ts also gains icon so the value reaches addTab; icon colour lives on a sessions.css session-tab-icon class, ui/tabs.css untouched since other tab bars still draw labels — none · group 04 · group 04
- nudgedSplitWidth takes Extract<PaneDirection,'left'|'right'>; a divider's nudge returns true for left/right also when disposed or mid-drag; renderer registers the eight commands in one loop over PANE_DIRECTIONS — none · group 01 · group 01
- 02 splits across two workers by file: A takes items 1 (keymap), 2 (docs), 5 (settings), 6 (base kit) and the docs and settings self-tests; B takes items 3 (primer) and 4 (backlog) with the primer self-test — its files read past 60k tokens in one agent — a seam the split misses, caught at the 02 diff read · lead
- no new layer entry: pane-tree/ sits in the existing src/shared/page layer, so 05b imports it without a check-layers edit, but the check does not stop the pure core importing DOM code — a later DOM import in pane-tree.ts goes uncaught · group 03 · group 03
- least share capped at half the span, so a split narrower than two least sizes centres its divider; a nudge that moves nothing calls no callback yet returns owned — none · group 03 · group 03
- 02's npm run selftest Done-when moves to 05b and 07: the any-scope panes.focus* and panes.resizePaneUp/Down binds stay unplaced until 05b's pane edges (focusEdge, anchored with no scope) and the pane tree's column-divider prompt reach the page; every other self-test step passes at 02A — if 05b's self-test never shows a column divider or a pane edge in some scope, the lines persist and 05b must anchor them · lead
- Docs: Alt+h no longer reveals a hidden tree (item 2's focus target returns false there); Esc (docs.backToTree) still does, and the docs-browser design says so — none · group 02 · group 02
- primer hands its focus target only while the primer view shows a primer's panes, else null; backlog's target also returns false with the editor open — none · group 02 · group 02
- 05b BLOCKED: the page chord notation admits only a letter, digit or Enter after modifiers, so <A-'> and <A-;> cannot bind; the user's tmux keys stand, and a fix group widens src/shared/chord-notation.ts and key-sequences.ts chordCode (Semicolon, Quote) and binds both, outside 05b's file list — keeps the decided keys — a chord the matcher reads by code mismatching on another layout · lead
- peer commit 22dfcf9 (workflow design) landed between this run's commits, so the review takes an explicit commit list rather than the review-base range · lead
- main's fallback pick reads 'two panes or more remain' as two or more before the close, matching the p1/p2 behaviour line; a pending echo is recorded only when the session differs from the selection main ends on; the pick hint shows only in an empty focused pane; the self-test adds an <A-k> step, expects the <A-S-j> resize log line, widens the window to 1800 for the cancel split, and ends its three fixture sessions — the fallback reading, if wrong, keeps a removed pane's neighbour unfocused · group 05b
- the chord fix maps ; and ' by US-layout codes; Electron's sendInputEvent takes them as keyCodes (per its accelerator docs, confirmed by the passing self-test) — another layout's physical keys differ · group 05b fix
- Test gate failure in shell-chrome traced to 9c84f9d; fixed by re-dispatch 02-fix-1 (opus-medium), committed 2aafb86 before the review.
### Review rounds
### Test gate
- Picks: full suite (07 names npm test), typecheck, lint, selftest. Round 1: typecheck pass; npm test 4282/4283 — shell-chrome 'an unregistered command' fails, caused by 9c84f9d (base kit passes dotted names unchecked), fix dispatched as 02-fix-1; lint fails only on DESIGN.md and docs/keymap.md formatting, both pre-existing (neither file's format touched by this run); primer-view base failure no longer fails.
- Round 2 after 2aafb86 (02-fix-1, base kit dotted names checked against commands.exists): typecheck pass; npm test 4284/4284 pass; selftest all passed incl. every key placed; lint only the DESIGN.md + docs/keymap.md format failures, both failing at review base 6562c49 (pre-existing).
