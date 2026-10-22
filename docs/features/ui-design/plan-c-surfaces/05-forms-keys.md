# 05 — Forms keys

Status: done
Type: Batch
Wave: 3 · Depends on: 04 (03 and 08 too, whose classes leave `SCROLLS_ITSELF`)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/manifest.ts` · test `src/plugins/forms/manifest.test.ts` ·
           modify `src/plugins/forms/ids.ts` · modify `src/plugins/forms/page/forms-commands.ts` ·
           test `src/plugins/forms/page/forms-commands.test.ts` · modify `src/plugins/forms/main/selftest-script.ts` ·
           modify `src/plugins/chat/main/selftest-script.ts` (its forms submit step and that step's comment only; 07
           owns the rest of the file in wave 4)
Consumes:  `formsManifest`, `formsCommandHandlers(deps: FormsCommandDeps)`, `numberedCommand`, the forms commands
           `clearChoice`, `actFixNow`, `actFollowUp`, `actLeaveIt`, `nextUnanswered`, `prevUnanswered`, `submit` ← tree ·
           `RailEntry` (round-view.ts) becomes { element: HTMLElement; dot: HTMLElement } — the rail draws no key hint ← 04 ·
           chords match the physical key (`event.code`) with the exact modifiers, in a capture-phase handler that
           prevents the default, ahead of any editor (`createChordMatcher` in `src/renderer/key-sequences.ts`,
           `installPageKeys` in `src/renderer/page-keys.ts`) ← tree
Produces:  `export function numberedCommand(prefix: 'choose', n: number): CommandId | null;` in `src/plugins/forms/ids.ts`
           (the `'jumpTo'` prefix goes); `formsManifest` without `jumpTo1`…`jumpTo9`; `formsCommandHandlers` without
           `jumpTo1`…`jumpTo9` · forms' submit on `<D-Enter>` in scope `review` (`{ keys: ['<D-Enter>'], scope: 'review',
           command: 'submit' }` in `formsManifest`)
Decisions: see **Decisions** below
GIVEN the forms view WHEN `c` / `f` / `u` / `s` is pressed THEN clear the choice / fix now / follow-up / leave it runs
GIVEN a forms text box in any vim mode WHEN `<A-n>` is pressed THEN the next unanswered item is focused and its notes box takes focus
GIVEN the review WHEN `<D-Enter>` is pressed, on the page or in the round note box THEN the round is sent
Tests:     see **Tests** below
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass, the tests below among them;
           `npm run selftest` passes with the steps below (chat's script included), the layout preview steps (`Space z l o` waiting on
           `[sessions] activated Layout preview`, then `<D-w>` and `n`) among them;
           `grep -rnE 'jumpTo[0-9]|jumpTo[$][{]|jumpTo[(]|.jumpTo.,' src/plugins/forms` (the numbered commands and the prefix;
           `jumpToItem`, `jumpToUnanswered` and `jumpToReviewRow` stay) and
           `grep -n "\[' ', 'e'\|\[' ', 'a'\|' ', 'Enter'\|<Leader>e" src/plugins/forms/manifest.ts` print nothing;
           the live checks are in 12's list (below)
Commit:    one commit for the group

## Decisions

The key rule (design.md § Keys; plan.md Decisions): raw keys act on the focused scope, chords navigate the visible
scope, the leader changes scope; inside a text box an action keeps a leader route.

Page binds in `manifest.ts`, by scope:

| Scope | Remove | Add |
|---|---|---|
| `forms` | `pageJumpBinds` (`Space 1`…`Space 9`) | `['c']` → `clearChoice` |
| `forms` | `[' ', 'e', 'n']`, `[' ', 'e', 'p']` | `['f']` → `actFixNow` |
| `forms` | `pageLeaderChoiceBinds` (`Space a 1`…`Space a 9`) | `['u']` → `actFollowUp` |
| `forms` | `[' ', 'a', 'c']`, `[' ', 'a', 'f']`, `[' ', 'a', 'u']`, `[' ', 'a', 's']` | `['s']` → `actLeaveIt` |
| `forms` | | `['<A-n>']` → `nextUnanswered`, `['<A-p>']` → `prevUnanswered` |
| `review` | `[' ', 'Enter']` → `submit` | `['<D-Enter>']` → `submit` |

The added `forms` binds sit after `{ keys: ['Enter'], … acceptRecommendation }` in the order of the table's Add
column; `['<D-Enter>']` takes `[' ', 'Enter']`'s place. Every other page bind stays, in its order.

Editor binds (`editorBinds`, both scopes `forms` and `review`): `editorJumpBinds` (`<Leader>1`…`<Leader>9`),
`<Leader>en` and `<Leader>ep` go. `<Leader>x`, `<Leader>a1`…`<Leader>a9`, `<Leader>ac`, `<Leader>af`, `<Leader>au`,
`<Leader>as`, `<Leader><Leader>` and `<Esc>` stay: vim owns raw keys in a box (digits are counts, `f` `u` `s` `c`
motions and edits), so the leader is the box's route to the actions (design.md § Keys).

Commands:

- `jumpTo1`…`jumpTo9` go from the manifest (`jumpCommands`, `JumpCommand`, `JUMP_LABEL`, `pageJumpBinds`,
  `editorJumpBinds`) and from `formsCommandHandlers` (`jumpTo`, its nine entries). `numberedCommand` takes only
  `'choose'`; its comment says it names the command picking choice `n`.
- `jumpToItem` stays as `jumpToUnanswered`'s step and loses its `already on <item>` branch: `jumpToUnanswered`
  returns before it when the target is the focused item, so the branch cannot run. It logs `jumped to <item>`.
- Group `questions` becomes `items` on `nextItem`, `prevItem`, `nextUnanswered` and `prevUnanswered` (drafter: they
  move over findings and notices too, and which-key prints a prefix's groups). `submit`'s label becomes `send
  answers`, matching task 04's button. Every other label and group stays.

Collision checks, each against every bind in force in the scope (measured at plan time, re-verify against the
merged keymap after tasks 01–03 and 06–08):

- `c` `f` `u` `s` in `forms`: the scope's raw binds are `j k x d a Enter 1`–`9` and `Space Space`; none starts
  with `c`, `f`, `u` or `s`, so no bind is a prefix of another. Docs' `c` (`pickContext`) is in scope `docs.tree`,
  which never overlaps `forms.forms`. No `any`-scope bind is a single raw letter.
- `<A-n>` / `<A-p>` in `forms`: no bind in any scope uses them (forms, chat, docs, keys, sessions, core, measured).
  The `any` chords are `<A-o>`, `<A-i>`, `<A-S-o>`, `<A-S-i>` and `<D-w>`. On macOS Option+n is a dead key and
  Option+p types `π`: the chord matcher reads `KeyN` / `KeyP` with `altKey`, and the capture-phase handler prevents
  the key's default ahead of the editor, as `<A-o>` (`ø`) already relies on. Whether a dead key's composition still
  starts in an INSERT box is a live check (below).
- `<D-Enter>` in `review`: chat binds it in `chat.chat` and `chat.reason`, scopes that never overlap
  `forms.review`; the app keymap is empty. As a chord it fires inside the round note box ahead of vim.
- In a box, a chord fires ahead of vim, so `<A-n>` / `<A-p>` replace `<Leader>en` / `<Leader>ep` in every vim mode,
  INSERT included, which the leader never reached.

## Self-test steps (`main/selftest-script.ts`)

Each changed step, in place, with its keys and expected line verbatim; every other step stays, `screenshot` fields
plan B added included. The comment above `STEPS` is rewritten to narrate the new keys sentence by sentence (`f`
clears the action and `s` sets Leave it; on finding 2 `u` is refused, `s` and `f`; on finding 3 `u`; `c` clears and
`2` picks again; `j` to question 2 and `<A-n>` finds no unanswered item; `Space` then `z` shows the `Space z` group;
`<A-n>` in question 2's notes box; `<A-p>` in the second session; `o` then `<D-Enter>` sends from the round note box).

| Today's keys → expect | New keys | New expect |
|---|---|---|
| `[' ', 'a', 'f']` → cleared the action on finding 1 | `['f']` | `[forms] cleared the action on finding 1` |
| `[' ', 'a', 's']` → chose Leave it on finding 1 | `['s']` | `[forms] chose Leave it on finding 1` |
| `[' ', 'a', 'u']` → finding 2 offers no follow-up | `['u']` | `[forms] finding 2 offers no follow-up` |
| `[' ', 'a', 's']` → chose Leave it on finding 2 | `['s']` | `[forms] chose Leave it on finding 2` |
| `[' ', 'a', 'f']` → chose Fix anyway on finding 2 | `['f']` | `[forms] chose Fix anyway on finding 2` |
| `[' ', 'a', 'u']` → chose Plan it on finding 3 | `['u']` | `[forms] chose Plan it on finding 3` |
| `[' ', 'a', '2']` → cleared the choice on question 1 | `['c']` | `[forms] cleared the choice on question 1` |
| `[' ', 'a', '2']` → chose 2 on question 1 | `['2']` | `[forms] chose 2 on question 1` |
| `[' ', '2']` → jumped to question 2 | `['j']` | `[page] j ran forms.nextItem` |
| `[' ', 'e', 'n']` → no unanswered item | `['<A-n>']` | `[forms] no unanswered item` |
| `['a']` → which-key shows Space a (after `[' ']`) | `['z']` | `[keys] which-key shows Space z` |
| `[' ', 'e', 'p']` → jumped to question 1 (second session) | `['<A-p>']` | `[forms] jumped to question 1` |
| `[' ', 'Enter']` → submitted (after `[' ', ' ']`) | `['o', '<D-Enter>']` | `[forms] submitted` |

One step is added, right after `{ keys: ['a'], expect: '[forms] focused notes on question 2' }` in the first
session (the box in INSERT): `{ keys: ['<A-n>'], expect: '[forms] no unanswered item' }`. The step after it,
`['Escape', ' ', 'k', 's']`, stays. The payload checks stay: question 2's notes `xb` also proves `<A-n>` typed
nothing into the box, and the note `note` that `o` then `<D-Enter>` added nothing.

`SCROLLS_ITSELF` drops `.rail-title` (04's rail rows), `.docs-row-title` (08's tree rows), `.session-row-label`
and `.session-tab-label` (03's rows and tabs): no element carries them now, and plan B task 02's fit check lets the
primitives' ellipsis parts clip. `.md pre`, `.md table`, `.docs-path`, `.docs-status` and `.session-row-status`
stay.

`Space a` is no page prefix in `forms` any more, so its which-key step moves to `Space z` (the debug group, in force
in every scope); `Space a` followed by `a` would now replay `a` as `editNotes`.

## Chat's self-test (`src/plugins/chat/main/selftest-script.ts`)

Chat's script submits a forms round, so it moves with forms' submit in this commit (otherwise the self-test fails
until 07 lands). Measured at plan time, re-verify:

| At (today) | Now | After |
|---|---|---|
| line 121 | `keys: [' ', 'Enter']` → `[chat] Chat tab shown in chat-selftest`, `checksFit: true` | `keys: ['<D-Enter>']`, expect and `checksFit` unchanged |
| line 69 (comment above `STEPS`) | `Space Space opens its review and Space Enter submits` | `Space Space opens its review and Cmd+Enter submits` |

No other line of chat's script changes here.

## Tests

`src/plugins/forms/manifest.test.ts` — `merges to the forms binds`: `editorBindsIn` drops the `<Leader>1`…`9`
entries, `<Leader>en` and `<Leader>ep`; `EXPECTED_PAGE` drops `[' ', digit]`, `[' ', 'e', 'n']`, `[' ', 'e', 'p']`,
`[' ', 'a', digit]` and `[' ', 'a', 'c' | 'f' | 'u' | 's']`, gains after `acceptRecommendation`
`{ keys: ['c'], scope: 'forms.forms', command: 'forms.clearChoice' }`, `['f']` → `forms.actFixNow`, `['u']` →
`forms.actFollowUp`, `['s']` → `forms.actLeaveIt`, `['<A-n>']` → `forms.nextUnanswered`, `['<A-p>']` →
`forms.prevUnanswered`, and has `{ keys: ['<D-Enter>'], scope: 'forms.review', command: 'forms.submit' }` in place of
`[' ', 'Enter']`.

`src/plugins/forms/page/forms-commands.test.ts` (default setup: notice at rail position 0, question 1 at 1, question
2 at 2; with `[finding('Leak')]`, the finding at 1 and the questions at 2 and 3). A test that moved with `jumpToN`
moves with `store.dispatch({ type: 'focusItem', item: <position> })`:

- remove `jumps to question N and logs it`, `does nothing for a question the round lacks` and `logs a jump to the
  focused question as no move` (their commands and branch go)
- replace `jumps from a box into question N's notes box` with `moves from the active box into the next unanswered
  item's notes box` — `setActive(notes1)`, `run('nextUnanswered', {})` (a chord fires with no editor, as `<A-n>` in
  a box does) → `focused.at(-1)` equals `notes2`, `focusedItem(round())` is `{ kind: 'question', index: 2 }`, logs
  `['jumped to question 2']`
- `stays on the focused item when it is the only unanswered one` — focus position 1, `choose1`, focus position 2,
  then as today: `no other unanswered item`, then after `choose1`, `no unanswered item`
- `jumps to the next unanswered item, wrapping` — `setup([finding('Leak')])`, focus position 3, `nextUnanswered` →
  finding 1, logs `['jumped to finding 1']`
- `jumps to the previous unanswered question` — focus position 2, `prevUnanswered` → question 1

## Live checks

Merged into [12 — Final verification](12-final-verification.md) § Form tab and forms keys and § Forms layouts.

## Proof

Commit `82e8635`. Diff read against the bind table, Commands and both self-test sections; typecheck, lint, tests (1904) and the self-test pass; both Done-when greps print nothing. Rulings: the forms self-test's user-keymap block now moves `toggleNotApplicable` to `<Leader>q` (its old `jumpTo2` target is gone), with one added `Space x` step keeping the payload. Concerns: `which-key.test.ts` builds made-up `jumpTo<digit>` commands (outside forms, harmless); Option+n as a dead key in an INSERT box is a live check.
