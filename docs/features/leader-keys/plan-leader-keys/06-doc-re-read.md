# 06 — Doc re-read against the landed code

Status: not started
Type: Batch
Wave: 5 · Depends on: 01, 02, 03, 04, 05
Plan: [plan.md](plan.md)

Files:     modify, only where a line is stale: `docs/keymap.md` · `docs/features/settings/design.md` ·
           `docs/features/leader-keys/design.md` · `AGENTS.md` · `DESIGN.md` · `docs/features/agent-chat/design.md` ·
           `docs/features/chat-panes/design.md` · `docs/features/chat-bar/design.md` ·
           `docs/features/session-log/design.md` · `docs/features/session-titles/design.md` ·
           `docs/features/session-popups/design.md` · `docs/features/workflow/design.md`
Consumes:  the landed code of 01–05
Produces:  nothing new; every doc above true to the code
Decisions: docs were written ahead in `9016b55e` (plan.md § Docs written ahead) and are hypotheses until this task
           (`wigley:writing-for-agents` § Doctrine before code)

Each doc is read line by line against the code:

- `docs/keymap.md` § Leader groups: every row's keys and names against `defaultKeymap.binds` and `groups` in
  `src/plugins/keymap.ts`. The keyboard-reach and form-popup plans landed first and may have added leader binds this
  table must hold.
- `docs/features/settings/design.md` § Keybindings and Leader menu sections: every key, copy string, tag and pane against
  `keymap-view.ts`, `leader-menu-view.ts`, the settings binds and the settings `default` layout.
- `docs/features/leader-keys/design.md` § The popup and § The editors: the shelf's look against the keys `default`
  layout's CSS, `Space /`'s scope and rows against `keys.searchLeader`, and `captureKey`'s rules against plan.md's
  shared signature as landed.
- The moved-key lines in the other docs: `grep -rnE "Space (k n|r r|v s|v f|:)|<Leader>(kn|rr|vs|vf|:|x\b)"
  docs AGENTS.md DESIGN.md --include='*.md'` → hits only inside `docs/features/*/plan-*/` folders of other plans, or
  none.
- `AGENTS.md`'s key hints bullet (`Space /`) and the settings plugin line.

GIVEN a doc line that disagrees with the code WHEN this task reads it THEN the line is rewritten to the code, unless
the code is the bug, in which case the lead is told and the line stays.
Tests:     none: a doc change.
Done when: every doc above read through; the grep above clean.
Commit:    one commit, "Re-read the leader keys docs against the landed code", naming each doc changed.

## Proof

