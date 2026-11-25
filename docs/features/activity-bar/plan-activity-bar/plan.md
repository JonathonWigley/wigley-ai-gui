# Activity bar — plan

Feature: Activity bar · Implements: none · Ticket: none
Target: main of wigley-ai-gui (worktree `../.worktrees/wigley-ai-gui-activity-bar`, branch `activity-bar`) · Written: 2026-11-25

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The activity bar shows the 11 modes in the user's order and groups, split by hairlines, with the last group at
the bar's bottom. Resting the pointer peeks the names out over the content. `Space v p` or the Pin button pins the
bar open wide. Inbox marks its item with its Needs you count. The order comes from each plugin's suggestion, and
the core `shell.activityBar` setting overrides it wholly. The whole design is
`docs/features/activity-bar/design.md`; read it first.

## Architecture

Core page shell only, plus each built-in mode's registration:

- `src/contracts/plugin.ts`: `Mode` gains `place` and `showCommand`; `ModeHandle` gains `setCount`.
- `src/contracts/settings.ts`, `src/config/settings.ts`: the core setting `shell.activityBar`.
- `src/renderer/shell/activity-order.ts` (new): the pure arrangement of modes into groups.
- `src/renderer/shell/shell-chrome.ts`, `modes.ts`, `shell.ts`, `shell.css`, the shell layout contract and its
  `default` layout: groups, dividers, counts, key hints, the peek and the pin.
- `src/renderer/renderer.ts`, `src/renderer/plugins/page-api.ts`: wiring, the pin command, qualifying `showCommand`.
- Theme tokens, core command and key.
- Each built-in mode plugin's `page/start.ts`: its suggested place and show command; Inbox's count.

## Preconditions

- The branch `activity-bar` starts from `origin/main` 30ee04cb: `git merge-base --is-ancestor origin/main HEAD` in the
  worktree.
- Every built-in mode's show command is `showMode` in its manifest:
  `grep -n "showMode:" src/plugins/{sessions,docs,settings,backlog,work-inbox,work-board,practice,scheduling,chatroom,builds,gallery}/manifest.ts`
  (11 declarations, measured at plan time, re-verify).
- Mode ids as `modes.show` takes them (measured at plan time, re-verify with
  `grep -n -A3 "api.modes.add({" src/plugins/*/page/start.ts`): `sessions.sessions`, `docs.docs`, `gallery.gallery`,
  and `<plugin>.main` for backlog, builds, chatroom, practice, scheduling, settings, work-board, work-inbox.
- `<Leader>vp` is unbound: `grep -n "'<Leader>vp'" src/plugins/keymap.ts` prints nothing.
- `src/config/themes/` holds one theme, `catppuccin-mocha.json`.
- The user's `~/.config/wigley-ai-gui/settings.json` sets no `shell` key and no `shell.layout`, so the `default`
  shell layout draws the user's screen.

## Docs written ahead

Commit e69a9461 on `activity-bar`, plus the narrow-window correction to `design.md` committed with this plan:

- `docs/features/activity-bar/design.md` — the feature's design (new)
- `DESIGN.md` — § Space, size and shape tokens; the Activity bar line
- `AGENTS.md` — § Architecture › A mode
- `docs/keymap.md` — the `v` view group's `vp`
- `docs/features/layouts/design.md` — the shell owner's parts
- `README.md` — the `shell.activityBar.groups` and `shell.activityBar.hidden` core settings

## Mandatory Reads

- `AGENTS.md` (repo root): § Intent, § Architecture (A mode, The shell, A setting, A layout, A key, Key hints, A theme,
  A command), § README, changelog and boundary, § Running and testing
- `DESIGN.md`: § Tokens and themes, § Space, size and shape, the Activity bar line
- `docs/keymap.md`
- `docs/features/activity-bar/design.md`
- `docs/features/layouts/design.md`
- `~/wigley-agents/AGENTS.md` (the user's global rules)

## Design Overview

```
plugin page part ── api.modes.add({ …, place, showCommand }) ──► page-api (qualifies id, showCommand)
                                                                   │
                                                                   ▼
                     handle.setCount(n) ──► modes registry ──► shell chrome ◄── shell.activityBar (config)
                                                                   │  arrangeActivityItems(modes, setting)
                                                                   ▼
                                activity bar: start track = top groups, end track = bottom groups,
                                activityDivider between groups, activityPin last in the end track
                                                                   │
                     shell.ts: hover ─ peek delay ─► is-peeking is-expanded (track stays collapsed)
                               activityBar.togglePin ─► is-pinned is-expanded (track widens; uiState)
                               window < 680px ─► pin not applied (collapsed, peeks)
```

Decisions (interview and design review):

- Order and groups (round 1): the user's three groups, the third at the bottom (round 2). No group headers: hairlines
  only (Decided).
- Plugins suggest, the setting overrides wholly (round 1); a mode the setting leaves out shows in a group of its own
  after the last top group (round 2); the setting names modes by qualified mode id (Decided: `modes.show`'s id is the
  one id a mode has).
- `place` is numbers (`group`, `order`) and an edge, with no group registry (design review: an open set any plugin
  joins with no core list, the arrangement a pure module — depth).
- Names show by hover peek and a pin, both (round 1). The pin key is `Space v p` (round 2). Peek delay and the
  expanded width are theme tokens; the pin persists in `uiState` (Decided).
- The expanded content is drawn always and shown by CSS on `is-expanded`, so a peek redraws nothing (design review).
- Key hints draw through key anchors, so the user's `keys.showHints: false` hides them (Decided).
- Counts: a `setCount` on the mode handle, beside `setContext` (design review: the same seam a mode already uses for
  what the shell shows of it); only Inbox sets one, its Needs you count (round 1 notes).
- Narrow window: only the 680px query drops the pin, never the left bar's crowding (design review: avoids a pin
  that crowds, unpins and re-pins in a loop).
- A hidden mode keeps its keys (Decided).
- Icons stay as they are (Decided, round 1).

Out of scope: new icons; counts for Chatroom or Builds; the activity bar as a keyboard focus stop; a demo step
(the shell is core and owns none; the demo's coverage check reads plugins only).

## File Structure

Modified:

- `src/contracts/plugin.ts` — `ModePlace`, `Mode.place`, `Mode.showCommand` (01); `ModeHandle.setCount` (02)
- `src/contracts/settings.ts`, `src/config/settings.ts`, `src/main/config/user-settings.test.ts` — `shell.activityBar` (01)
- `src/contracts/commands.ts`, `src/config/keymap.ts`, `src/plugins/keymap.ts` — `activityBar.togglePin` (02)
- `src/config/theme-tokens.ts`, `src/config/themes/catppuccin-mocha.json` — the two tokens (02)
- `src/renderer/shell/shell-chrome.ts`, `modes.ts`, `shell.ts`, `shell.css` and their tests (02)
- `src/renderer/shell/layouts/layout.d.ts`, `layouts/default/layout.js`, `layouts/default/layout.css`,
  `src/renderer/shell/read-shell-layout.ts` and its test, `src/shared/plugin-part-harness.test-support.ts` (02)
- `src/renderer/renderer.ts`, `src/renderer/plugins/page-api.ts` (02)
- Each built-in mode plugin's `page/start.ts`, and `src/plugins/work-inbox/page/start.test.ts` (03)
- `src/plugins/docs/main/selftest-script.ts` (04)
- `CHANGELOG.md` (01, 02, 03)

New:

- `src/renderer/shell/activity-order.ts` and `activity-order.test.ts` — the arrangement rule, kept pure so its
  table test needs no DOM (01)

Boundary rules: `activity-order.ts` imports only `src/contracts`. The `ModePlace` and `ActivityBarSetting` records
live in `src/contracts/` because plugins (the place) and main (the setting's check) both read them.

Shared names (used by more than one task, word for word):

- `export interface ModePlace { group: number; order: number; at?: 'top' | 'bottom' }` in `src/contracts/plugin.ts`
- `Mode.place?: ModePlace` and `Mode.showCommand?: string` in `src/contracts/plugin.ts`
- `export interface ActivityBarGroupSetting { modes: string[]; at?: 'top' | 'bottom' }` and
  `export interface ActivityBarSetting { groups: ActivityBarGroupSetting[]; hidden: string[] }` in
  `src/contracts/settings.ts`; `Settings.shell.activityBar: ActivityBarSetting`
- `export interface ActivityModeEntry { id: string; place: ModePlace | undefined; firstAdd: number }`,
  `export interface ActivityGroups { top: string[][]; bottom: string[][] }` and
  `export function arrangeActivityItems(modes: readonly ActivityModeEntry[], setting: ActivityBarSetting): ActivityGroups`
  in `src/renderer/shell/activity-order.ts`
- `ModeHandle.setCount(count: number | null): void` in `src/contracts/plugin.ts`
- `ModesDeps.counted(modeId: string, count: number | null): void` in `src/renderer/shell/modes.ts`
- `export const ACTIVITY_BAR_TOGGLE_PIN: CommandKey<void, 'activityBar.togglePin'>` in `src/contracts/commands.ts`
- Page log lines `activity bar pinned`, `activity bar unpinned`, `activity bar peeked`, logged under `page`

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 01 → 02 → 03 → 05

### Wave 1
- [x] [Arrangement rule and the override setting](01-arrangement-and-setting.md)

### Wave 2
- [ ] [Grouped bar, counts, peek and pin](02-grouped-bar-peek-pin.md) — after 01

### Wave 3
- [ ] [Built-in places and the Inbox count](03-built-in-places-inbox-count.md) — after 02
- [ ] [Self-test steps for the pin](04-selftest-pin.md) — after 02

### Wave 4
- [ ] [Doc re-read](05-doc-re-read.md) — after 03, 04
- [ ] [Final verification](06-final-verification.md)

## Run log

Review base: c22d3488

### Groups
- 01 · hard · 3755a76b (+ef08f2df layer fix, 5075429f format) · diff read: every Produces present; tsc and npm run lint pass after a layer fix and an oxfmt pass · concerns: ModeHandle doc comment still calls first-add order the activity bar's order (carried to 02); nothing pins the shipped shell.activityBar default empty since the merge test left src/config
### Contract changes
### Rulings
- A groups value with no well-formed group keeps the suggested layout; a well-formed group of only unknown ids still counts as a setting group — fallback to the default look on malformed input — one row and one check change if wrong · group 01 · group 01
- The mergeUserSettings case builds on the test's own defaults, not coreDefaultSettings, to stay in its layer — the test no longer guards the shipped default — group 01 · group 01
### Review rounds
### Test gate
