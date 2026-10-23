# 08 — Final verification

Status: done
Type: Task
Wave: 7 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     none (captures under the drive run's folder)
Consumes:  the landed app
Produces:  a drive run report: each check below passed or failed, with its screenshot path
Decisions: live checks only where no test or self-test step sees the claim (`wigley:writing-tests` § What earns a
           live run instead)
Done when: every check below ran in a drive run and its result is reported
Commit:    none

## Setup

Load the `drive` skill (`.agents/skills/drive/SKILL.md`) and start a drive run (no `--user-config`: the run writes
only its own temp home's config). Show Settings with `key` `Space k ,`.

## Checks

1. **Surfaces against DESIGN.md** — low-confidence: new layout, no test sees it. Screenshot Core, Chat (the
   `profiles` JSON row), and Keymap, in `transparency` `full` and `reduced` (the `setting` command). Read each against
   DESIGN.md: side bar on L1 dense glass, rows `row-list` height, one accent (the cursor ring only), `Set` Tag
   neutral, defaults and unset values `fg-tertiary`, Kbd in `font-mono`, sentence case. `query` a row's height
   against `--wg-row-list`.
2. **Hot reload both ways** — expected path. Commit `theme` from the picker to a second built-in theme if one exists
   (else `transparency` `reduced`): the window restyles without a reload; screenshot. Then `setting` the value back
   from the drive CLI (a hand edit): the row redraws to it.
3. **JSON row** — low-confidence: the document editor inside a row. Open `chat.profiles`, add a profile in the
   editor, `:w`: the row shows the new array and the chat start prompt's profile step lists it. Then `:w` a profile
   missing `configDir`: the box stays open with the check's message under it.
4. **Narrow window** — low-confidence: layout. `resize` to 600 px wide: the side bar lies over the sheet (`Space k ,`
   toggles it), rows wrap without horizontal scroll; screenshot.
5. **Leader change** — expected path, high impact. Set the leader to `,` in the Keymap section: which-key opens on
   `,` and `Space k ,` no longer does; `,k,` shows Settings. Reset the leader row: `Space` works again.

Report each check's result and screenshot path. A failed check is reported with what showed, not fixed in this task.

## For the user (wrap-up only)

Synthetic keys never reach the app menu, so `Cmd+,` itself is the user's check in a visible `npm start`: press
`Cmd+,` from another mode and Settings shows; on Windows, `Ctrl+,`.

## Proof

Drive run `settings-verify` (screenshots under `.drive/settings-verify/screenshots/`): 1 surfaces PASS, 2 hot reload PASS (second theme seeded as a user theme in the temp home; one built-in exists), 3 JSON row PASS, 4 narrow window PASS, 5 leader change PASS · defects for the review: the side bar's open section keeps an accent ring while focus is in the rows; an open JSON box draws three nested accent rings; command labels are lower case (the app-wide command label convention) · note: two Forms commands share a label.
