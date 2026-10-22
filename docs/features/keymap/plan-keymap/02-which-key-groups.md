# 02 — Which-key group names and the key bar's leader

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/keys/page/which-key.ts` · `src/plugins/keys/page/key-bar.ts`
           test `src/plugins/keys/page/which-key.test.ts` · `src/plugins/keys/page/key-bar.test.ts`
Consumes:  `Keymap.groups: KeyGroups` ← 01 · `vimTokenForPageKey(key: string): string` ← 01 ·
           `pageKeysFor(keys: string, leader: string): string[]` ← 01
Produces:  `whichKeyModel` (same signature) labels a prefix entry `+<name>` when `keymap.groups` names it
           `barHints` (same signature) leaves out page sequences starting with the keymap's leader
Decisions: named groups (round 1) · an unnamed prefix keeps today's label from command groups (round 2) · the page
           leader comes from the keymap's one `leader`, retiring `PAGE_LEADER_KEY` (round 2)

## What changes

- `which-key.ts` `entry`: a prefix's full keys (the pending keys plus the next key) are compared, as vim tokens, with
  each `groups` key spelled through `vimTokens(groupKey, keymap.editor.leader)`. Page pending keys convert with
  `vimTokenForPageKey`; editor pending keys are already vim tokens. A match labels the entry `+<name>`; no match keeps
  today's `+<group, group>` label.
- `key-bar.ts`: `PAGE_LEADER_KEY` goes; the page leader is `pageKeysFor(keymap.editor.leader, keymap.editor.leader)[0]`
  (one key), and page binds starting with it are left out as today.

## Tests

- GIVEN groups `{ '<Leader>k': 'windows' }`, leader `<Space>`, page binds `[' ','k','s']` and `[' ','k','d']`, WHEN
  page pending `[' ']` THEN the `k` entry is a prefix labelled `+windows` — `whichKeyModel_NamedGroup_LabelsPrefix`
- Same keymap, editor pending `['<Space>']` THEN `k` is `+windows` — `whichKeyModel_NamedGroupInBox_LabelsPrefix`
- GIVEN no groups THEN the label is today's `+<command group>` — `whichKeyModel_UnnamedPrefix_KeepsCommandGroups`
- GIVEN leader `,` and page binds `[',','k','s']` and `['j']` THEN the bar lists `j` only — `barHints_UserLeader_LeavesOutLeaderSequences`

Done when: compiles; the test gate runs the tests above.
Commit:    one commit for the group

## Proof
