# 04 — Risky flags on the risky set

Status: not started
Type: Batch
Rung: standard · adds one declared field per command, as each declaration's `arg` field sits (`allowEntry` in `src/plugins/chat/manifest.ts`)
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/plugins/app-update/manifest.ts`
- modify `src/plugins/sessions/manifest.ts`
- modify `src/plugins/docs/manifest.ts`
- modify `src/plugins/notes/manifest.ts`
- modify `src/plugins/settings/manifest.ts`
- modify `src/plugins/workflow-large/stages/index.ts`
- modify `src/config/keymap.ts`

Consumes:  `CommandDecl.risky?: true` ← 01
Produces:  `risky: true` on each declaration listed below

Decisions:
- Add `risky: true` to exactly these declarations (round 2; the set is the design doc's § Risky commands):
  - `install` in `src/plugins/app-update/manifest.ts`
  - `closeSession`, `listClose`, `closePane` in `src/plugins/sessions/manifest.ts`
  - `trash` in `src/plugins/docs/manifest.ts`
  - `remove`, `removeSession` in `src/plugins/notes/manifest.ts`
  - `reset` in `src/plugins/settings/manifest.ts`
  - `clearAndMake`, `resumeMake` in `LARGE_COMMANDS`, `src/plugins/workflow-large/stages/index.ts`
  - the `CORE_OPEN_LINK.id` and `CORE_RELOAD_PLUGIN.id` entries of `coreCommands` in `src/config/keymap.ts`
- Chat's risky commands (`stopAll`, `allowOrCopy`, `allowEntry`) are flagged by 06, which owns
  `src/plugins/chat/manifest.ts`.
- `workflow-large.autoClearAndMake` is a setting, not a command, so it is not in the set; `clearAndMake` and
  `resumeMake` take its place, since each clears a session (Decided at plan time).
- Each declaration keeps its label, group, `runsIn` and `arg` as they are.

GIVEN the served config WHEN a command of the list above is read through `commands.list()` THEN its info carries `risky: true`, and `chat.send` carries none

Tests: none. The set is a design value (`wigley:writing-tests` § What earns neither). The confirm on one risky command
is checked live by 10 (Final verification).

Done when: `npm run typecheck` passes; `grep -c 'risky: true'` over the seven files counts 12 in all.
Commit:    one commit for the group
