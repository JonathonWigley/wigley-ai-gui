# 02 — Per-source alert descriptions

Status: in progress
Type: Task
Wave: 2 · Depends on: 01 (shared `master-plan.md` and `followups.md`)
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/alerts.ts`
- modify `src/main/alerts/open-counts.ts` · test `src/main/alerts/open-counts.test.ts`
- modify `src/main/alerts/mac-alerts.ts` · test `src/main/alerts/mac-alerts.test.ts`
- modify `src/main/alerts/windows-alerts.ts` · test `src/main/alerts/windows-alerts.test.ts`
- `src/main/alerts/silent-alerts.ts` needs no edit (`setOpenCount: () => {}` still fits the contract); read it to confirm
- modify `src/shared/plugin-service-views.ts` (`trackedAlerts`) · test `src/main/plugins/main-api.test.ts` (it owns
  `trackedAlerts`' tests through `createMainApi`; there is no `plugin-service-views.test.ts`)
- modify `src/shared/agent-forms/channel-presenter.ts` · test `src/shared/agent-forms/channel-presenter.test.ts`
- modify `src/plugins/forms/main/start.ts` (the `createAgentFormChannelPresenter` call in `createForms`)
- modify `src/plugins/primer/main/start.ts` (the `createAgentFormChannelPresenter` call in `start`)
- modify `src/plugins/audio-picker/main/start.ts` (the `createAgentFormChannelPresenter` call in `start`, line 114 on
  2026-11-16; the audio picker is the third agent-form type, round of 2026-11-16)
- modify `docs/features/primer/design.md` (line 160, § Alerts) · `docs/features/intent-alignment/master-plan.md` ·
  `docs/features/followups.md`

Consumes: none.

Produces:
- `src/contracts/alerts.ts`:
  ```ts
  // What one source counts, as the Windows overlay names it: `singular` after a
  // count of 1 (`1 open agent form`), `plural` after any other count.
  export interface AlertNoun {
    readonly singular: string;
    readonly plural: string;
  }
  export interface Alerts {
    // `source` names the caller (a plugin id) and `noun` what it counts; the badge
    // shows the sum of every source's count.
    setOpenCount(source: string, count: number, noun: AlertNoun): void;
  }
  ```
- `src/main/alerts/open-counts.ts`:
  ```ts
  export interface OpenCountPart { readonly count: number; readonly noun: AlertNoun; }
  export interface OpenCounts { readonly total: number; readonly parts: readonly OpenCountPart[]; }
  export function createOpenCounts(): { set(source: string, count: number, noun: AlertNoun): OpenCounts };
  // The overlay text: each part as `<count> <singular|plural>`, joined with `, `; '' for no parts.
  export function describeOpenCounts(parts: readonly OpenCountPart[]): string;
  ```
- `src/shared/agent-forms/channel-presenter.ts`: `createAgentFormChannelPresenter` deps gain
  `alertNoun: AlertNoun` (beside `source`). Its return type does not change.
- `trackedAlerts(alerts: Alerts, registrations: Registrations): Alerts` keeps its signature.

Every caller and implementer of `Alerts.setOpenCount` (checked with grep at plan time; the list is complete):

| Place | Kind | Change |
|---|---|---|
| `src/main/alerts/mac-alerts.ts` | implementer | passes `noun` to `openCounts.set`, badges `.total` |
| `src/main/alerts/windows-alerts.ts` | implementer | text from `describeOpenCounts(parts)` |
| `src/main/alerts/silent-alerts.ts` | implementer | none |
| `src/shared/plugin-service-views.ts` `trackedAlerts` | wrapper | keeps each source's last noun; the zeroing call passes it |
| `src/shared/agent-forms/channel-presenter.ts` | the only production caller | passes `deps.alertNoun` |
| `createAgentFormChannelPresenter` calls in `src/plugins/forms/main/start.ts`, `src/plugins/primer/main/start.ts`, `src/plugins/audio-picker/main/start.ts` | the presenter's callers | pass `alertNoun` (Decision 8) |
| `src/main/plugins/main-api.test.ts` `fakeAlerts` (line 159) and calls at lines 337, 620, 621 | fake and calls | record and pass the noun |
| `src/shared/agent-forms/channel-presenter.test.ts` `fakeAlerts` (line 54) | fake | records the noun |
| `src/plugins/forms/main/start.test.ts` lines 182, 223, 251, 284 `src/plugins/primer/main/start.test.ts` lines 117, 148, 181 and `src/plugins/audio-picker/main/start.test.ts` line 71 | `{ setOpenCount() {} }` | none (fewer parameters still fit) |
| `src/shared/plugin-part-harness.test-support.ts` line 1041 | `trackedAlerts(replaced.alerts ?? notFaked<Alerts>('alerts'), …)` | none |
| `src/main/main.ts` `alertsFor` (line 306) and the offscreen `alerts: silentAlerts` (line 391) | composition | none |

Decisions:

1. **Contract** (plan.md Decisions, "Alerts"): `setOpenCount(source, count, noun)` with `noun: { singular, plural }`.
   The noun is the whole phrase after the number, the word `open` included.
2. **Join rule** (plan.md Decided by the agent, the Windows overlay text): `describeOpenCounts` writes each part as
   `${count} ${count === 1 ? noun.singular : noun.plural}` and joins the parts with `, `. No parts gives `''`.
3. **Part order**: `parts` lists only the sources whose latest count is above 0, in the order each source first set
   a count above 0. A source keeps that place when it falls to 0 and rises again. A source that only ever set 0 has
   no place yet. Each part carries the source's latest count and the noun of its latest call. `total` is the sum of
   every source's latest count (as today).
4. **Pure text builder**: the text is built only in `describeOpenCounts`, so its rules are tested without Electron.
   `windows-alerts.ts` calls it and writes no text of its own: the two inline strings `'1 open agent form'` and
   `` `${total} open agent forms` `` go.
5. **Windows overlay**: `window.setOverlayIcon(total > 0 ? dot : null, describeOpenCounts(parts))`. The
   destroyed-window guard stays before the call, as today.
6. **macOS badge**: `app.setBadgeCount(openCounts.set(source, count, noun).total)`. Linux keeps `silentAlerts`.
7. **Stopped plugin**: `trackedAlerts` keeps each source's last count and last noun
   (`Map<string, { count: number; noun: AlertNoun }>`). At dispose it calls `alerts.setOpenCount(source, 0, noun)`
   for each source whose last count is not 0, with that source's last noun. A call after dispose stays dropped.
8. **Nouns** (pinned; the brief's example `2 open agent forms, 1 open feature primer`):
   - forms: `alertNoun: { singular: 'open agent form', plural: 'open agent forms' }` — today's overlay words.
   - primer: `alertNoun: { singular: 'open feature primer', plural: 'open feature primers' }`.
   - audio picker: `alertNoun: { singular: 'open audio picker', plural: 'open audio pickers' }` (round of
     2026-11-16: the audio picker joins this task).
   - The presenter's existing `noun` dep stays as it is: forms passes `roundType.noun` (`'round'`,
     `src/plugins/forms/main/round-type.ts:84`), the primer passes `primerType.noun` (`'primer'`,
     `src/plugins/primer/main/primer-type.ts:25`) and the audio picker passes `type.noun` (`'audio picker'`,
     `src/plugins/audio-picker/main/picker-type.ts:36`). That `noun` names one form in the close refusal
     (`Finish or cancel <label>'s primer first`) and never reaches the alert. The presenter's comment changes:
     `source` names the alert open count and `alertNoun` what it counts.
9. **No doc line changes**: `AGENTS.md` § Architecture's `alerts/` line ("the badge sums the open counts each source
   sets") stays true, and no other `AGENTS.md` line names `setOpenCount`'s parameters (checked with grep).
   `docs/features/primer/design.md:160` writes `Alerts.setOpenCount(source, count)`: it becomes
   `Alerts.setOpenCount(source, count, noun)`, with the primer's noun named. Run
   `grep -rn "setOpenCount" docs` before committing and fix any other line it shows.

GIVEN forms sets 2 and then the primer sets 1 WHEN the Windows overlay updates THEN its text is
`2 open agent forms, 1 open feature primer` and its icon is the dot.
GIVEN the primer set 1 first and forms set 2 after WHEN the overlay updates THEN its text is
`1 open feature primer, 2 open agent forms`.
GIVEN forms set 2, the primer set 1, then forms set 0 WHEN the overlay updates THEN its text is `1 open feature primer`.
GIVEN every source is at 0 WHEN the overlay updates THEN the icon is `null` and the text is `''`.
GIVEN a plugin set 2 for source `p` with noun N WHEN its registrations are disposed THEN the service gets
`setOpenCount('p', 0, N)` once.

Tests (rows go into the test that owns each rule; `wigley:make` owns when they run). Each test builds its own nouns:
`F = { singular: 'open agent form', plural: 'open agent forms' }`, `P = { singular: 'open feature primer', plural:
'open feature primers' }`.
- `src/main/alerts/open-counts.test.ts`:
  - The three existing tests pass a noun to every `set` and assert `.total` with today's values (2 then 3; 5; 1
    then 0).
  - New `it.each` `'parts after $calls are $expected'` (break: parts in Map-insertion order instead of first
    non-zero order, a zero source listed, a returning source moved to the end). Rows of `[source, count, noun]`
    calls → expected `parts` as `[count, singular]` pairs:
    | Calls | Expected parts |
    |---|---|
    | `forms 2 F`, `primer 1 P` | `[[2, F], [1, P]]` |
    | `primer 1 P`, `forms 2 F` | `[[1, P], [2, F]]` |
    | `forms 2 F`, `primer 1 P`, `forms 0 F` | `[[1, P]]` |
    | `forms 2 F`, `primer 1 P`, `forms 0 F`, `forms 3 F` | `[[3, F], [1, P]]` |
    | `forms 0 F`, `primer 1 P`, `forms 2 F` | `[[1, P], [2, F]]` |
  - New `it.each` `'describes $parts as $text'` for `describeOpenCounts` (break: singular/plural flipped, a wrong
    separator, text for an empty list):
    | Parts | Text |
    |---|---|
    | `[]` | `''` |
    | `[{ count: 1, noun: F }]` | `'1 open agent form'` |
    | `[{ count: 2, noun: F }]` | `'2 open agent forms'` |
    | `[{ count: 2, noun: F }, { count: 1, noun: P }]` | `'2 open agent forms, 1 open feature primer'` |
    | `[{ count: 3, noun: P }, { count: 1, noun: F }]` | `'3 open feature primers, 1 open agent form'` |
- `src/main/alerts/windows-alerts.test.ts`: the fake window's `setOverlayIcon(icon, description)` records both.
  `liveWindow_UsesTheWindow` sets `('forms', 2, F)`, `('primer', 1, P)`, `('forms', 0, F)`, `('primer', 0, P)` and
  expects `[['setOverlayIcon', DOT, '2 open agent forms'], ['setOverlayIcon', DOT, '2 open agent forms, 1 open
  feature primer'], ['setOverlayIcon', DOT, '1 open feature primer'], ['setOverlayIcon', null, '']]` (break: the
  window gets a text other than `describeOpenCounts`'). `destroyedWindow_AnswersWithoutThrowing` passes `F`.
- `src/main/alerts/mac-alerts.test.ts`: `setOpenCount_TwoSources_BadgesTheSum` passes `F` and `P`; still expects
  `5`.
- `src/main/plugins/main-api.test.ts`: `fakeAlerts` records `[source, count, noun]`. The test `'zeroes the open counts
  the plugin set when its registrations are disposed'` sets `('p', 2, F)` and `('p.other', 0, P)` and expects
  `[['p', 0, F]]` (break: the zeroing call drops or swaps the noun). The `alert count` row of the after-dispose table
  calls `setOpenCount('p', 2, F)` and still expects `[]`.
- `src/shared/agent-forms/channel-presenter.test.ts`: `setUp` passes `alertNoun: F`; `fakeAlerts` records
  `[source, count, noun]`; each existing `attention.counts` expectation (lines 154, 182, 363, 388, 421) gains `F` as
  the third value (break: the presenter does not pass its `alertNoun`).

Done when: `npm run typecheck` and `npm run lint` pass; the tests above pass in the test gate;
`grep -n "open agent form" src/main/alerts/windows-alerts.ts` finds nothing;
`grep -n "alertNoun" src/plugins/forms/main/start.ts src/plugins/primer/main/start.ts
src/plugins/audio-picker/main/start.ts` finds one line each; in
`docs/features/intent-alignment/master-plan.md` § Lane P the line reads `- [x] Per-source alert descriptions [ready]`;
the `**Per-source alert descriptions**` entry (three lines) is gone from `docs/features/followups.md` § Platform and
packaging; live checks: 07 — Final verification.

Commit: one commit for the task, holding the code, the tests, the master plan tick and the follow-up removal.

## Proof

