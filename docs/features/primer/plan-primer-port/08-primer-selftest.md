# 08 — Primer self-test and drive actions

Status: not started
Type: Task
Wave: 6 · Depends on: 07
Plan: [plan.md](plan.md)

Rules: every rule in [plan.md § Rules for every task](plan.md#rules-for-every-task) applies.

The primer's self-test script and its drive actions, both in primer main. The script opens one primer in a session of
its own, drives the Primer tab with the keys in `design.md` § Keys (rail need keys, the card, an include toggle, an
added item, the review, submit), and checks the payload the agent gets back. The drive actions let a drive run open a
primer and read its answers, as forms' `openRound` and `answers` do.

Files:     create `src/plugins/primer/main/selftest-script.ts` ·
           modify `src/plugins/primer/main/start.ts` ·
           test (create) `src/plugins/primer/main/start.test.ts`

Consumes:  from 05: `primerMainPart`, `SAMPLE_PRIMER_ARGS`, `connectFixtureSession`, `openFixturePrimer`,
           `PrimerPayload` ·
           from 07 (the page, through the self-test driver; each a line the page logs or a command a key runs):
           - the Primer tab takes over its session's view when a primer shows for the active session, its rail on the
             Feature row, in scope `primer.rail`
           - `j` in `primer.rail` runs `primer.nextRow`, `k` runs `primer.prevRow`, and `j` from the Feature row
             selects the first task row (`'1'`), passing the SectionHeaders
           - `y`, `n`, `u` in `primer.rail` run `primer.needYes`, `primer.needNo`, `primer.needUnclear`
           - `<A-l>` runs `primer.focusCard`, putting the card cursor on the first item; `<A-h>` runs
             `primer.focusRail`
           - `j` in `primer.card` runs `primer.nextItem`; `x` runs `primer.toggleInclude`
           - `a` in `primer.card` runs `primer.addItem`, which focuses the add-item box in insert mode; leaving the box adds the item
           - `[primer] left the box` when the user leaves a box (the second `Escape`)
           - `[primer] review opened` when `<Leader><Leader>` opens the review
           - `[primer] submitted` when `<D-Enter>` submits from the review
           (task 06 names the command ids; task 07 the log lines) ·
           from the tree: `SelfTestScript`, `SelfTestStep`, `DriveHost` in `src/contracts/plugin.ts`;
           `argsObject`, `nullableStringOr`, `optionalOneOf`, `optionalString`, `requiredString` in
           `src/shared/drive-args.ts`; `DRIVE_SESSION_DEFAULTS`, `HARNESSES`, `SessionsMainEvents` in
           `src/plugins/sessions/contract.ts`; `fakeDriveHost` in `src/shared/fake-drive-host.ts` (test); the key
           engine's line `` `[page] ${keys} ran ${command}` `` (`src/renderer/page-keys.ts` line 187) and the
           sessions page's `` `[sessions] activated ${label}` `` (`src/plugins/sessions/page/start.ts` line 196),
           lines measured at plan time, re-verify

Produces:

`src/plugins/primer/main/selftest-script.ts`:

```ts
export function primerSelfTestScript(sessions: Pick<SessionsMainExports, 'connect' | 'activate'>): SelfTestScript;
```

`src/plugins/primer/main/start.ts`:

```ts
// Opens primers in a drive run's sessions and reads their answers; ids are `drive-primer-<n>` unless named.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect'>,
  onSessionEnded: (listener: (rowId: string) => void) => void,
): Disposable;
```

Drive actions on the host: `primer.openPrimer` and `primer.answers` (the host qualifies the names with the plugin id,
as `forms.openRound`).

Decisions:

- **The drive actions copy forms'** `addDriveActions` (`src/plugins/forms/main/start.ts` lines 137–245, measured at
  plan time, re-verify) with these words changed: action `openRound` → `openPrimer`, its arg `round` → `primer`
  (default `SAMPLE_PRIMER_ARGS`), `askFixtureRound` → `openFixturePrimer`, default ids `drive-forms-<n>` →
  `drive-primer-<n>`, the type `DriveFormsSession` → `DrivePrimerSession`. The texts:
  - `openPrimer` description: `'Opens a primer in the live session primer opened before under sessionId, or in a new one, without waiting for its answers; the default primer is the four-entry sample.'`
  - `openPrimer` args: `'{ sessionId?: string, projectDir?: string | null, harness?: "claude" | "codex", primer?: object }'`
  - `answers` description: `"The latest primer's tool result once submit or cancel resolved it, else { pending: true }."`
  - `answers` args: `'{ sessionId: string }'`
  - unknown session: `` `no session ${sessionId} from primer.openPrimer` ``
  A plugin imports no other plugin, and `src/shared` may not import the sessions contract, so the copy stays in
  primer. Report the duplication as a follow-up candidate (a shared drive helper over a structural session type).
- **Wiring in `primerMainPart.start`**, after the tool contribution, as forms does:
  `api.services.selfTest?.run(primerSelfTestScript(sessions))`, and when `api.drive !== null`,
  `addDriveActions(api.drive, sessions, (listener) => api.events.on('sessions.ended', ({ sessionId }) => listener(sessionId)))`.
  `dispose` disposes the drive actions.
- **The script's session.** `open(run)` ends the session an earlier run connected, then connects
  `primer-selftest-${run}` with `projectDir: 'primer-selftest'`, `harness: 'claude'`, `deadlineSeconds: 120`, calls
  `sessions.activate(<its row id>)` (as chat's script does, `src/plugins/chat/main/selftest-script.ts` line 678), and
  opens the primer with `openFixturePrimer`. Activating in `open` keeps the steps free of which session
  `<A-S-o>` reaches after forms' and chat's scripts. `shownLine` is
  `'[primer] form shown: primer-selftest · Self-test primer'` (the shared presenter's line, task 02).
- **The script's primer** is `SAMPLE_PRIMER_ARGS` with feature `name` `'Self-test primer'` and `summary`
  `` `Self-test run ${run}.` ``. The run number in the summary changes the fingerprint each run, so a later run in
  the same temp home does not pre-fill from the earlier run's save.
- **`pageBinds: []`, `settings: {}`, `scrollsItself: []`.** If task 07 lists a primer element that scrolls in its own
  box (the rail or the card), put its selector in `scrollsItself`.
- **The steps**, one group `primer` (`why`: `'The Primer tab sets needs from the rail, toggles and adds items on the card, and submits from the review; the agent gets every change back.'`):

| Keys | Expect | Screenshot |
| --- | --- | --- |
| `j` | `[page] j ran primer.nextRow` | `rail` (`checksFit: true`) |
| `n` | `[page] n ran primer.needNo` | |
| `j` | `[page] j ran primer.nextRow` | |
| `y` | `[page] y ran primer.needYes` | |
| `j` | `[page] j ran primer.nextRow` | |
| `u` | `[page] u ran primer.needUnclear` | |
| `k` | `[page] k ran primer.prevRow` | |
| `<A-l>` | `[page] <A-l> ran primer.focusCard` | `card` (`checksFit: true`) |
| `j` | `[page] j ran primer.nextItem` | |
| `x` | `[page] x ran primer.toggleInclude` | |
| `a`, `P`, `o`, `l`, `i`, `s`, `h`, `Escape`, `Escape` | `[primer] left the box` | |
| `<A-h>` | `[page] <A-h> ran primer.focusRail` | |
| ` `, ` ` | `[primer] review opened` | `review` (`checksFit: true`) |
| `<D-Enter>` | `[primer] submitted` | |

  After these steps entry `1` needs no, entry `2` needs yes, entry `3` needs unclear; the card was on entry `2`
  (Screen), its second item `Wire its buttons` excluded and an item `Polish` added.
- **`problems(result)`** reads the `ToolResult`'s `structuredContent` as a `PrimerPayload` and lists one line per
  mismatch, empty when all hold:
  - `outcome` is `'submitted'`
  - `summary` is `'4 entries: 2 yes, 1 unclear, 1 no; 0 comments.'`
  - the entries' needs, in order, are `['no', 'yes', 'unclear', 'yes']`
  - entry `2`'s items are `[{ text: 'Draw the screen', include: true, comment: '', added: false }, { text: 'Wire its buttons', include: false, comment: '', added: false }, { text: 'Polish', include: true, comment: '', added: true }]`
  - `feature.summary` is `` `Self-test run ${run}.` `` for the run that opened it
  A result that is an `isError` tool result lists its text as the one problem.
- **Order among scripts.** The driver runs scripts in the order the parts start (`src/plugins/main.ts`): sessions,
  forms, primer, chat. Primer's steps start with its own session active and leave the Primer tab on the selected
  session; chat's first step activates its own session with `<A-S-i>`/`<A-S-o>` keys whose target can shift once a
  primer session sits in the session list. This task's gate runs the whole self-test (`npm run selftest`); when a chat or forms step names a
  different session, fix that step's expectation in this task's commit and name it in Proof.

GIVEN a drive run WHEN `primer.openPrimer` runs with no args THEN it connects `drive-primer-1` with the drive defaults
and opens `SAMPLE_PRIMER_ARGS`, returning `{ sessionId: 'drive-primer-1', rowId }`
GIVEN a primer the user has not finished WHEN `primer.answers` runs THEN it returns `{ pending: true }`, and the tool
result once the user submits
GIVEN the self-test steps ran WHEN the primer resolves THEN `problems` returns `[]`

Tests:     `src/plugins/primer/main/start.test.ts` (new), mirroring the six tests of
           `src/plugins/forms/main/start.test.ts` with `fakeDriveHost`:
           - `openPrimer connects a session with the fixture defaults`
           - `openPrimer keeps an explicit null projectDir`
           - `openPrimer reuses a live session and connects a fresh one once it ended`
           - `openPrimer rejects a field of the wrong type`
           - `answers is pending until the primer resolves, then its result`
           - `dispose removes the actions and ends each session primer opened`
           The script's steps are checked by the self-test run in task 14 (Final verification), not by a unit test.

Done when: `npm run typecheck` and `npm run lint` pass; the gate runs `npm test -- src/plugins/primer/main` and
           `npm run selftest`, every group passing (primer, forms, chat and the rest).
Commit:    one commit for the group in wigley-ai-gui

## Proof
