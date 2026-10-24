# 04 — Trash takes every walked link to what goes

Status: in progress
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/main/doc-files.ts` · `src/plugins/docs/page/docs-state.ts`
           test `src/plugins/docs/main/doc-files.test.ts` · `src/plugins/docs/page/docs-state.test.ts`
Consumes:  `IndexEntry.walked: string[]` ← 03
Produces:  `trashTargets(path)` in `src/plugins/docs/main/doc-files.ts` also naming walked links (signature unchanged)
           `trashQuestion(targets, homeDir, keys, paths)` in `src/plugins/docs/page/docs-state.ts` wording any number
           of targets (signature unchanged)
Decisions: every walked link resolving into what goes is trashed with it, or nothing goes; the prompt names every
           path (round 1 notice) · the user's case: deleting a synced skill from the tree also removes
           `~/.claude/skills/<name>` (follow-up, now design.md § Delete)

## Behaviour

- `trashTargets(path)` returns today's list (the real target, then the path itself when it is a link), then each
  **walked link**, in entry order and then walk order, each path once (`samePath`), none already in the list:
  - the entries considered are `deps.entries()` whose `path` is the real target or inside it (`paths.isInside`)
  - for each of their `walked` paths, the walked link is the nearest of that path and its ancestors that is a link
    (`files.stat(...).isLink`) and whose `files.realPath` is the real target or inside it
  - a walked path with no such link adds nothing: a linked folder above the target (`~/.claude/skills` → the repo's
    `skills/`) resolves to the target's parent, so it stays
  - a link that is itself inside the real target adds nothing; it goes with the target
  - each walked link is named with its folder resolved (`folderRealTarget`, as the path itself is today) and
    deduped by `samePath` after resolving, so a Claude config folder reached through a link still passes the guard,
    whose folders are real paths
- `trash(path)` is unchanged: the guard checks every target before any moves, so one refused link refuses the
  whole trash, and the moves run in list order with today's partial-failure result.
- `trashQuestion`: one target keeps today's base-name wording. Two or more read
  `Move <first, tilde> and its link <second, tilde> to the Trash?` for two and
  `Move <first, tilde> and its links <second>, <third>, … to the Trash?` (tilde paths, joined with `, `) for more,
  then the key hints as today.

GIVEN a repo skill folder `repo/skills/s` and a link `~/.claude/skills/s` → it, the entry for
`repo/skills/s/SKILL.md` walked at `~/.claude/skills/s/SKILL.md` WHEN `trashTargets` runs on the SKILL.md THEN it
returns `[repo/skills/s, ~/.claude/skills/s]` (absolute)
GIVEN the same, but the link is `~/.claude/skills` → `repo/skills` WHEN `trashTargets` runs THEN it returns
`[repo/skills/s]` only
GIVEN a walked link the guard refuses WHEN `trash` runs THEN it rejects and nothing moves
GIVEN three targets WHEN `trashQuestion` runs with no keys THEN
`Move ~/repo/skills/s and its links ~/.claude/skills/s, ~/.codex/skills/s to the Trash?`

Tests:     `doc-files.test.ts` (with its existing links fake): `trashTargets_WalkedLinkToSkillFolder_NamesLinkAfterTarget`,
           `trashTargets_LinkedParentFolder_NotNamed`, `trashTargets_WalkedLinkInsideTarget_NotNamed`,
           `trashTargets_TwoEntriesSameLink_NamedOnce`, `trashTargets_WalkedLinkInLinkedConfigFolder_NamedWithRealFolder`, `trash_WalkedLinkRefused_NothingMoves`,
           `trash_WalkedLink_TrashedAfterTarget` · `docs-state.test.ts`: `trashQuestion_ThreeTargets_NamesLinks`
           (the line above, verbatim), `trashQuestion_TwoTargets_NamesLink` (today's two-target wording, verbatim)
Done when: `npm run typecheck`, `npm run lint` and the tests above pass
Commit:    one commit for the group

## Proof
