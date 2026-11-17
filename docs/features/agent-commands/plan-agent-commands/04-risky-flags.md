# 04 — Risky and target flags

Status: done
Type: Batch
Rung: standard · adds one declared field per command, as each declaration's `arg` field sits (`allowEntry` in `src/plugins/chat/manifest.ts`)
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/plugins/app-update/manifest.ts`
- modify `src/plugins/sessions/manifest.ts`
- modify `src/plugins/session-stash/manifest.ts`
- modify `src/plugins/docs/manifest.ts`
- modify `src/plugins/notes/manifest.ts`
- modify `src/plugins/settings/manifest.ts`
- modify `src/plugins/workflow/manifest.ts`
- modify `src/plugins/workflow-large/stages/index.ts`
- modify `src/plugins/forms/manifest.ts`
- modify `src/plugins/primer/manifest.ts`
- modify `src/plugins/audio-picker/manifest.ts`
- modify `src/plugins/unity-pool/manifest.ts`
- modify `src/plugins/live-view/manifest.ts`
- modify `src/config/keymap.ts`

Consumes:  `CommandDecl.risky?: true` and `CommandDecl.targets?: true` ← 01
Produces:  `risky: true` and `targets: true` on each declaration listed below

Decisions:
- **The risky rule** (lead ruling 7; design.md § Risky commands states it): a command is risky when it does any of
  these:
  - destroys or discards user state the app cannot give back (a file, a draft, an attached image, a key binding, an
    answer the user gave)
  - closes or stops a session
  - installs or restarts
  - opens something outside the app
  - approves or answers on the user's behalf

  Every route to such an action is flagged, including a generic command that reaches it (`workflow.stageAction`).
- **The target rule** (lead ruling 1): a command is target-capable when it acts on a given session without that
  session's UI shown or focused. A command that opens a UI over the user's view, moves focus, or acts on a cursor,
  pane or list is not.
- Add `risky: true` to exactly these declarations:
  - `src/plugins/app-update/manifest.ts`: `install`
  - `src/plugins/sessions/manifest.ts`: `closeSession`, `listClose`, `closePane`
  - `src/plugins/session-stash/manifest.ts`: `noteAccept`. The stash dialog's accept closes the session. `stash` only
    opens the dialog, so it is not flagged.
  - `src/plugins/docs/manifest.ts`: `trash`, `conflictReload` (discards unsaved edits)
  - `src/plugins/notes/manifest.ts`: `remove`, `removeSession`, `discard`, `confirmYes` (yes, discard the draft)
  - `src/plugins/settings/manifest.ts`: `reset`, `removeBind`
  - `src/plugins/workflow/manifest.ts`: `mainAction`, `stageAction`. Each reaches `clearAndMake` and `resumeMake`.
    Every stage action now asks, the harmless ones too (lead ruling 7).
  - `src/plugins/workflow-large/stages/index.ts`, in `LARGE_COMMANDS`: `clearAndMake`, `resumeMake`
  - `src/plugins/forms/manifest.ts`, `src/plugins/primer/manifest.ts` and `src/plugins/audio-picker/manifest.ts`:
    `submit` and `confirmCancel` in each (they send or throw away the user's answers)
  - `src/plugins/unity-pool/manifest.ts`: `open` (opens Unity)
  - `src/plugins/live-view/manifest.ts`: `openScreenSettings` (opens System Settings)
  - `src/config/keymap.ts`: the `CORE_OPEN_LINK.id` and `CORE_RELOAD_PLUGIN.id` entries of `coreCommands`
- Add `targets: true` to exactly these declarations:
  - `src/plugins/sessions/manifest.ts`: `closeSession`, `renameSession`
  - `src/plugins/workflow/manifest.ts`: `mainAction`, `toggleHeadless`
  - `src/plugins/workflow-large/stages/index.ts`: `clearAndMake`, `cancelCountdown`, `makeInNewSession`, `resumeMake`,
    `retro`, `dismiss`. `openPlan` opens Docs mode, so it is not flagged.
- Chat's flags are set by 06, which owns `src/plugins/chat/manifest.ts`.
- `workflow-large.autoClearAndMake` is a setting, not a command (Decided at plan time).
- These stay unflagged, for the reasons shown:
  - `chat.interrupt` stops a turn, not the session.
  - forms' choice-clearing commands can be undone by picking the choice again.
  - `practice.submit` judges the user's own solution.
- Each declaration keeps its label, group, `runsIn` and `arg` as they are.

GIVEN the served config WHEN a command of the lists above is read through `commands.list()` THEN its info carries the flag, and `chat.send` carries no `risky`

Tests: none. The sets are design values (`wigley:writing-tests` § What earns neither). The confirm on one risky command
and a targeted run are checked live by 10 (Final verification).

Done when: `npm run typecheck` passes, and `grep -c 'risky: true'` per file prints these counts:

| File | Count |
|---|---|
| app-update | 1 |
| sessions | 3 |
| session-stash | 1 |
| docs | 2 |
| notes | 4 |
| settings | 2 |
| workflow | 2 |
| workflow-large stages | 2 |
| forms | 2 |
| primer | 2 |
| audio-picker | 2 |
| unity-pool | 1 |
| live-view | 1 |
| keymap | 2 |

`grep -c 'targets: true'` prints sessions 2, workflow 2 and workflow-large stages 6. `grep -B6 'risky: true\|targets:
true'` shows each flag inside the declaration named above.

Commit:    one commit for the group

## Proof

Commit f1c02b55b · proof: diff read: every risky/targets flag in the task's table, counts checked against it; wave-2 typecheck passes · concerns: single-line declarations expanded to multi-line for the flag
