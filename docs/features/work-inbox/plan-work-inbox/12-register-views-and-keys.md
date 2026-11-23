# 12 — Register the views and keys

Status: not started
Type: Batch
Rung: standard · follows Backlog's registration and its binds in `src/plugins/keymap.ts` (`<Leader>kb` and the
`backlog.table` block), and every key is pinned below
Wave: 3 · Depends on: 10, 11
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`.

Files:
- modify `src/plugins/manifests.ts`
- modify `src/plugins/page.ts`
- modify `src/plugins/main.ts`
- modify `src/plugins/keymap.ts`
- test `src/plugins/manifests.test.ts`

Consumes:
- `workInboxManifest`, `workInboxMainPart` and `workInboxPagePart`, with the `work-inbox` commands and scopes ← 10
- `workBoardManifest`, `workBoardMainPart` and `workBoardPagePart`, with the `work-board` commands and scope ← 11
- `work.sweep` and `work.openJobRow` in `workManifest` ← 04
- `chat.startNewSession`, already in the tree

Produces:
- `workInboxManifest` and `workBoardManifest` in `builtInManifests`, in `src/plugins/manifests.ts`. They go after
  `backlogManifest`, and after 04's `workManifest`, which they depend on.
- `workInboxPagePart` and `workBoardPagePart` in `pageParts`, in `src/plugins/page.ts`, after `backlogPagePart`.
- `workInboxMainPart` and `workBoardMainPart` in `mainParts`, in `src/plugins/main.ts`, after `backlogMainPart`.
- the binds below, in `defaultKeymap.binds` in `src/plugins/keymap.ts`

## Decisions

- **`main.ts` is in this task**, though plan.md's File Structure names only `page.ts`, `manifests.ts` and
  `keymap.ts`. Each view has a main part that registers its layout contract (10, 11), and `check-layers.mts` fails
  while a plugin folder's part is missing from `main.ts`.
- **Mode keys.** `<Leader>ki` runs `work-inbox.showMode` and `<Leader>kj` runs `work-board.showMode`, both in scope
  `any`, beside `<Leader>kb`. The `<Leader>k` group already exists, so `groups` is unchanged. Both keys are free:
  the k group today holds `ks`, `kd`, `k,`, `kb`, `kp`, `kt` and `kc`. The reserved `i` and `j` in
  `docs/keymap.md` are top-level leader groups, not letters under `k`.
- **Ctrl+n.** Add `'work-inbox.sections'`, `'work-inbox.list'`, `'work-inbox.box'` and `'work-board.board'` to the
  per-main-view scope list that maps to `chat.startNewSession`, after the `backlog.*` entries.
- **`W`** runs `work.sweep` in `work-inbox.sections`, `work-inbox.list` and `work-board.board`. It is not bound in
  `work-inbox.box`, where it types. It matches `backlog.table`'s `W`.
- **In-view binds** go in a new `// ── Inbox and Board ──` banner section after Backlog's. Write each scope's shared
  `W`, `gs` and `<C-n>` through the existing patterns: a `flatMap` over the scopes, as the `backlog.table` and
  `backlog.strip` pair does, and the Ctrl+n list.
- **Overlap check, done at plan time.** No `any` bind is a raw key (`any` holds only leader sequences and Alt, Cmd or
  Ctrl+Alt chords), so the only overlaps are within each new scope. None of the tables below binds one key twice in
  a scope. No bind's keys begin a longer bind's keys in the same scope (`g`-prefixed: `gg` and `gs` only). Every
  in-view bind is a page bind, except `<Esc>` with `where: 'box'` and the `<D-Enter>` chord, so the editor-wide vim
  mapping rule (`AGENTS.md` § Architecture, A key) meets no new box sequence. The worker re-runs the check through
  `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` (`src/plugins/keymap.test.ts`), which checks the merged
  keymap.
- **Self-test steps are not in this task.** The repo's key steps live in a plugin's `main/selftest-script.ts`, handed
  by its main part. The views' steps need 09's fixture, which is in this same wave. Task 13 depends on both 09 and 12,
  and adds them as groups in 09's `src/plugins/work/main/selftest-script.ts`, so the waves stay as plan.md has them. The end-of-run placement check is met through 10's and 11's
  demo beats, which draw every anchor.

## Pinned values

Mode keys:

```ts
{ keys: '<Leader>ki', scope: 'any', command: 'work-inbox.showMode' },
{ keys: '<Leader>kj', scope: 'any', command: 'work-board.showMode' },
```

In-view binds, copied from 10's and 11's Pinned values:

| Scope | Keys → command |
| --- | --- |
| `work-inbox.sections` | `j` `work-inbox.sectionDown` · `k` `work-inbox.sectionUp` · `gg` `work-inbox.sectionTop` · `G` `work-inbox.sectionBottom` · `<CR>` `work-inbox.openSection` · `l` `work-inbox.peekSection` · `W` `work.sweep` · `<C-n>` `chat.startNewSession` |
| `work-inbox.list` | `j` `work-inbox.listDown` · `k` `work-inbox.listUp` · `gg` `work-inbox.listTop` · `G` `work-inbox.listBottom` · `<CR>` `work-inbox.openSlack` · `i` `work-inbox.editDraft` · `<D-Enter>` `work-inbox.send` · `d` `work-inbox.dismiss` · `z` `work-inbox.snooze` · `u` `work-inbox.restore` · `b` `work-inbox.addToBoard` · `s` `work-inbox.startSession` · `t` `work-inbox.ticketOnBoard` · `<Esc>` `work-inbox.clearFilter` · `W` `work.sweep` · `gs` `work.openJobRow` · `<C-n>` `chat.startNewSession` |
| `work-inbox.box` | `<D-Enter>` `work-inbox.send` · `<Esc>` `work-inbox.leaveBox` (`where: 'box'`) · `<C-n>` `chat.startNewSession` |
| `work-board.board` | `j` `work-board.cardDown` · `k` `work-board.cardUp` · `gg` `work-board.cardTop` · `G` `work-board.cardBottom` · `h` `work-board.columnLeft` · `l` `work-board.columnRight` · `H` `work-board.moveLeft` · `L` `work-board.moveRight` · `<CR>` `work-board.openCard` · `y` `work-board.accept` · `n` `work-board.notYet` · `t` `work-board.threads` · `s` `work-board.startSession` · `d` `work-board.deleteTask` · `W` `work.sweep` · `gs` `work.openJobRow` · `<C-n>` `chat.startNewSession` |

Should 10 or 11 have landed a command id that differs from these, the landed manifest is the truth, and the worker
reports the difference. The keymap's types fail the build on a name no manifest declares.

## GIVEN / WHEN / THEN

- GIVEN the merged keymap WHEN its checks run THEN no key is bound twice in a scope, and every command named is
  registered.
- GIVEN the built-in manifests WHEN `work-inbox` runs `work-board.showTicket` and `work-board` runs
  `work-inbox.filterTicket` THEN each names a declared page command with a `'string'` arg.

## Tests

- Add a row to `src/plugins/manifests.test.ts`: `manifests_WorkViews_DeclareTheCommandsEachOtherRuns`. It reads
  `builtInManifests` and asserts that `work-board.showTicket` and `work-inbox.filterTicket` are declared,
  `runsIn: 'page'`, with `arg: 'string'`. This pins the seam 10 and 11 cross by id alone. The existing manifests
  tests cover their labels, descriptions and setting info.
- `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` covers the binds. No new keymap test is needed.
- `pageParts_DependencyOrder_KeysStartsFirst` (`src/plugins/page.test.ts`) and `src/plugins/main.test.ts` cover
  the order and the composition.

The keys pressed live, Ctrl+n's prompt from each view, and `W` queueing a sweep land in 13's self-test steps and
task 14 (Final verification).

## Done when

- `npm run typecheck` passes.
- `npm run lint` passes, with the composition check closed for both folders.
- `npm test -- src/plugins/keymap.test.ts src/plugins/manifests.test.ts src/plugins/page.test.ts src/plugins/main.test.ts` passes.

## Commit

One commit for the group: `work-inbox, work-board: register both views and bind <Leader>ki, <Leader>kj, W, Ctrl+n and the in-view keys`.

## Proof

