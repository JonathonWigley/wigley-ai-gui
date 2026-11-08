# 06 — Doc re-read against the landed code

Status: not started
Type: Batch
Wave: 5 · Depends on: 01, 02, 03, 04, 05
Plan: [plan.md](plan.md)

Files:     modify, only where a line is stale: `docs/keymap.md` · `docs/features/settings/design.md` ·
           `docs/features/leader-keys/design.md` · `docs/features/plugin-framework/design.md` · `AGENTS.md` ·
           `DESIGN.md` · `docs/features/agent-chat/design.md` ·
           `docs/features/chat-panes/design.md` · `docs/features/chat-bar/design.md` ·
           `docs/features/session-log/design.md` · `docs/features/session-titles/design.md` ·
           `docs/features/session-popups/design.md` · `docs/features/workflow/design.md`
Consumes:  the landed code of 01–05
Produces:  nothing new; every doc above true to the code
Decisions: docs were written ahead in `28751244` (plan.md § Docs written ahead) and are hypotheses until this task
           (`wigley:writing-for-agents` § Doctrine before code)

Each doc is read line by line against the code:

- `docs/keymap.md` whole, for stale leader examples: § Leader groups first, then every other leader example in the
  file (the `groups` example "`<Leader>k` windows" is now "go to"), and § Layers' "Every list picker takes the same
  keys: `j`/`k`, `gg`/`G`, …" line against the leader search picker's binds as 03 left them. If 03 left out `gg`/`G`
  (`ListPicker` had no top/bottom member), reword that line to the code: the picker binds `j`/`k`, `Enter` and `l`
  choose, `/` filters, `Esc` closes. If 03 bound them, the line holds.
- `docs/features/plugin-framework/design.md`, the which-key lines: "docked full width just above the status bar" and
  "Commands draw in the theme's green and prefixes in its mauve" against the keys `default` layout and
  `keysManifest.themeTokens` (a full-width glass shelf on the window's bottom edge; a group's label and `›` in
  `accent`, an action's label in `fg-secondary`).
- `DESIGN.md` § Surfaces, the Floating line: "which-key … use … `row-list` rows" against the shelf, whose entries are
  not `row-list` rows (the leader search's picker rows are).
- `docs/keymap.md` § Leader groups: every row's keys and names against `defaultKeymap.binds` and `groups` in
  `src/plugins/keymap.ts`. The keyboard-reach and form-popup plans landed first and may have added leader binds this
  table must hold.
- `docs/features/settings/design.md` § Keybindings and Leader menu sections: every key, copy string, tag and pane against
  `keymap-view.ts`, `leader-menu-view.ts`, the settings binds and the settings `default` layout.
- `docs/features/leader-keys/design.md` § The popup and § The editors: the shelf's look against the keys `default`
  layout's CSS, `Space /`'s scope and rows against `keys.searchLeader`, and `captureKey`'s rules against plan.md's
  shared signature as landed.
- The moved-key lines in the other docs: `grep -rnE "Space (k n|r r|v s|v f|:)|<Leader>(kn|rr|vs|vf|:|x\b)"
  docs AGENTS.md DESIGN.md --include='*.md'` → hits only under `docs/features/*/plan-*/` folders (this plan's
  folder, which still exists when this task runs, included), or none. `docs/features/agent-chat/design.md` carries
  `chat.stopAll` as `<Leader>bX` already; a hit there is a regression.
- `AGENTS.md`'s key hints bullet (`Space /`) and the settings plugin line.

GIVEN a doc line that disagrees with the code WHEN this task reads it THEN the line is rewritten to the code, unless
the code is the bug, in which case the lead is told and the line stays.
Tests:     none: a doc change.
Done when: every doc above read through; the grep above clean.
Commit:    one commit, "Re-read the leader keys docs against the landed code", naming each doc changed.

## Proof

