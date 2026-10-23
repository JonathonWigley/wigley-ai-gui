# 03 — `drag --hold` leaves the button down until `release`

Status: done
Type: Task
Wave: 4 · Depends on: 02, 07
Plan: [plan.md](plan.md)

Files:     modify `src/main/drive/page-driver.ts` · modify `src/main/drive/drive-commands.ts` ·
           modify `scripts/drive-args.mts` · test `src/main/drive/drive-commands.test.ts` ·
           test `scripts/drive-args.test.mts`
Consumes:  `LogMark`, `markLog`, `linesAfter` ← 02 (`page-driver.ts` is shared with 02 and 07, `drive-commands.ts` with
           02, hence the wave); `optionalBoolean` in `src/shared/drive-args.ts` ← 06; `drag`,
           `pressPointOf`, `HELD_BUTTONS`, `DRAG_MOVES`, `KEY_GAP_MS` (tree)
Produces:  `export async function dragAndHold(window: DrivenWindow, selector: string, dx: number, dy: number): Promise<{ x: number; y: number }>`
           in `src/main/drive/page-driver.ts` — presses and moves, returns the end point, sends no `mouseUp`
           `export function release(window: DrivenWindow, at: { x: number; y: number }): void` in
           `src/main/drive/page-driver.ts` — sends the left `mouseUp` at `at`
           `drag` args `{ selector: string, dx: number, dy: number, hold?: boolean }` and a `release` command
           (args `{}`) in `createDriveCommands`, `src/main/drive/drive-commands.ts`
           `drag <selector> <dx> <dy> [--hold]` and `release` forms in `scripts/drive-args.mts`
Decisions: the held drag is per-run state in the drive commands' closure, beside `consoleMessages`; the page driver
           stays stateless (round 1, design review: locality) · a second hold or a click while held rejects, naming
           the held drag (round 1) · the skill's wording is written ahead (6e65c67)

## Behaviour

- `drag` becomes `dragAndHold` then `release`, so the existing `drag` keeps its exact input sequence.
- `createDriveCommands` holds `held: { selector: string; at: { x: number; y: number } } | null`.
  - `drag` with `hold: true` (read with `optionalBoolean(args, 'hold') ?? false`): through `linesCausedBy`, runs `dragAndHold` and sets `held`.
  - `drag` without it: as today.
  - `release`: through `linesCausedBy`, sends `release` at `held.at`, then clears `held`. With nothing held it rejects
    with `No drag is held; drag --hold first`.
  - While `held` is set, `drag` and `click` reject before sending anything, with
    `A drag from <selector> is held; release it first`.
- The command descriptions say the same in one clause each; `help` prints them.
- `drive-args.mts`: `drag` accepts the `--hold` flag (add it to the command's accepted flags and to `Flags`), giving
  `hold: true` in the args; `release` takes no positionals. The help usage lines read `drag <selector> <dx> <dy>
  [--hold]` and `release`.

GIVEN `drag` with `hold: true` WHEN it returns THEN the inputs end on a `mouseMove` with the left button held and hold
no `mouseUp`
GIVEN a held drag WHEN `release` runs THEN one left `mouseUp` is sent at the drag's end point and the lines it caused
return
GIVEN a held drag WHEN `click` or another `drag` runs THEN it rejects naming the held drag's selector and sends nothing
GIVEN nothing held WHEN `release` runs THEN it rejects with `No drag is held; drag --hold first`
GIVEN argv `['drag', '.handle', '40', '0', '--hold']` WHEN parsed THEN args are `{ selector: '.handle', dx: 40, dy: 0, hold: true }`

Tests:     the four drive-command cases above in `drive-commands.test.ts`, over the fake window's recorded inputs,
           in sentence style (the file's existing `Name_Case_Result` names stay); the argv case in
           `drive-args.test.mts`, in its GIVEN/WHEN/THEN sentence names
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. The live check of a
           pressed style is task 12's.
Commit:    one commit for the group

## Proof

Commit d57e4fe · proof: diff read matches spec; dragAndHold, release, drag hold arg, release command, CLI forms present; typecheck and lint pass · concerns: a held drag is not released when the run disposes or quits
