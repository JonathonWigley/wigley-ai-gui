# 07 — Chat keys

Status: in progress
Type: Task
Wave: 4 · Depends on: 05 (it moved this script's forms submit step to `<D-Enter>`), 06
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/manifest.ts` · modify `src/plugins/chat/page/chat-commands.ts` ·
           test `src/plugins/chat/page/chat-commands.test.ts` · modify `src/plugins/chat/main/selftest-script.ts`
Consumes:  `ChatSession.entries: Pick<EntryList, 'move' | 'latest' | 'first' | 'toggleFocused'>` in `src/plugins/chat/page/chat-view.ts` ← 06 ·
           `EntryList.first(): ChatEntry | null` in `src/plugins/chat/page/entry-list.ts` ← 06 ·
           `export const CONTROL_IDS = { pickMode: 'mode', pickEffort: 'effort', pickModel: 'model' } as const` in `src/plugins/chat/page/control-commands.ts` ← 06
Produces:  chat command `firstEntry` (`chat.firstEntry`) in `src/plugins/chat/manifest.ts`, with its handler in `chatCommandHandlers`
           (`src/plugins/chat/page/chat-commands.ts`) · page binds `m` `e` `o` `c` `g g` in scope `chat`
Decisions: the session controls move to raw `m` `e` `o` `c` in scope `chat`, and the four `Space c …` page binds go (interview: "move") ·
           `<Leader>cm` `<Leader>ce` `<Leader>co` `<Leader>cc` editor binds stay, for the box (interview) ·
           `gg` focuses the first entry, the top of the transcript, as `G` follows the latest (interview; design.md § Keys) ·
           `allowPermission`'s label becomes `allow the tool once`, matching the button (drafter, from 06's pinned copy) ·
           `chat-commands.ts` drops its own `CONTROL_IDS` and imports 06's, so one table pairs commands and controls (drafter)
GIVEN the visible session has entries WHEN `firstEntry` runs THEN its list focuses the first entry and logs `focused the first entry`
GIVEN the visible session has no entries WHEN `firstEntry` runs THEN it logs `no entries in <name>`
Tests:     see **Tests** below
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass, the tests below among them;
           `npm run selftest` passes with the steps below (the page's startup keymap checks pass with the
           new binds); no `[' ', 'c', …]` page bind remains in the chat manifest; the key-bar and help checks
           are in 12's live list
Commit:    one commit for the group

## Keys

Measured at plan time from `src/plugins/chat/manifest.ts`, re-verify.

| Keys | Scope | Command | Now | After |
|---|---|---|---|---|
| `m` | chat (page) | `pickMode` | `Space c m` | `m` |
| `e` | chat (page) | `pickEffort` | `Space c e` | `e` |
| `o` | chat (page) | `pickModel` | `Space c o` | `o` |
| `c` | chat (page) | `pickControl` | `Space c c` | `c` |
| `g g` (`keys: ['g', 'g']`) | chat (page) | `firstEntry` (new) | — | added |
| `<Leader>cm` `ce` `co` `cc` | chat (editor) | the four above | kept | kept |

New command: `firstEntry: { label: 'first entry', group: 'entries', runsIn: 'page' }`, declared after
`latestEntry`; the `gg` bind sits after the `G` bind.

**Collision check** (keymap report and the tree): chat-scope page binds after the change are
`i a j k Enter G y n <C-c> <D-Enter> m e o c g g` — no raw `g` alone (which would break `gg`), and
`G` is a separate key. Every `any`-scope page bind is a leader sequence or a chord (`<A-o>`, `<A-i>`,
`<A-S-o>`, `<A-S-i>`, `<D-w>`, `Space k …`, `Space z …`), so none clashes with a raw key in `chat`.
Docs' raw `c` and `o` and forms' review `o` sit in other scopes. Inside the box raw keys belong to
vim, so `<Leader>c…` stays the box route and vim's own `gg` is untouched (page binds do not fire in
an editor). Re-check against plans A and B's binds and 01's and 05's before landing.

## Handler

`firstEntry: inSession((session) => …)` calls `session.entries.first()`; a null result logs
`` `no entries in ${session.name}` ``, any other `focused the first entry`. Source `chat`, as every
handler logs.

## Tests

`src/plugins/chat/page/chat-commands.test.ts` — `session()` gains an `entries` fake whose `first()`
returns what the test hands it:

- `firstEntry_withEntries_focusesTheFirst` — `first` returns a `user` entry; `run.logs` equals
  `['[chat] focused the first entry']` and `first` was called once
- `firstEntry_noEntries_logsNoEntries` — `first` returns null; `run.logs` equals
  `['[chat] no entries in app']`
- the existing `pickMode_*` tests keep passing over the imported `CONTROL_IDS`

The binds themselves are config the page's startup checks and the self-test cover; no test restates
them.

## Self-test steps

In `STEPS` of `src/plugins/chat/main/selftest-script.ts`, measured at plan time, re-verify:

| At (today) | Step now | After |
|---|---|---|
| line 86 | `{ keys: [' ', 'c', 'e'], expect: '[chat] picker shown: Effort' }` | `{ keys: ['e'], expect: '[chat] picker shown: Effort' }` |
| before line 135 (`G`) | — | `{ keys: ['g', 'g'], expect: '[chat] focused the first entry' }` |
| line 136 | `{ keys: [' ', 'c', 'e'], expect: '[chat] picker shown: Effort', checksFit: true }` | `keys: ['e']` |
| line 142 | `{ keys: [' ', 'c', 'e'], expect: '[chat] picker shown: Effort' }` | `{ keys: ['i', 'Escape', ' ', 'c', 'e'], expect: '[chat] picker shown: Effort' }` — the box route: Esc leaves insert for normal mode, where `<Leader>ce` opens Effort |
| after the step expecting `[chat] Effort is Low in chat-selftest` | — | `{ keys: ['m'], expect: '[chat] picker shown: Mode' }`, `{ keys: ['Escape'], expect: '[chat] picker closed: Mode' }`, `{ keys: ['o'], expect: '[chat] chat-selftest has no model control' }`, `{ keys: ['c'], expect: '[chat] picker shown: Controls' }`, `{ keys: ['Escape'], expect: '[chat] picker closed: Controls' }` |

The fake harness declares `mode` (label `Mode`) and `effort` (label `Effort`) and no `model`
(`src/shared/fake-agent-harness.ts`), so `o` logs the missing control. `EXPECTED_CALLS` is
unchanged: the new steps set nothing. The forms submit step (line 121) already reads `['<D-Enter>']`
(05). The comment above `STEPS` is rewritten to name `e`, `gg`, the box's `Space c e`, `m`, `o` and
`c` in place of `Space c e`; its Cmd+Enter sentence (05) stays.

`SCROLLS_ITSELF` drops `.session-row-label` and `.session-tab-label` (task 03's rows and tabs draw
the primitives' ellipsis parts, which plan B task 02's fit check lets clip); `.chat-json`,
`.chat-tool-result`, `.md pre`, `.md table` and `.session-row-status` stay.

## Live checks

Merged into [12 — Final verification](12-final-verification.md) § Chat.

## Proof

