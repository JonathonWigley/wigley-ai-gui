# 03 — Final verification

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     none
Consumes:  01, 02
Produces:  the self-test result and the drive captures
Decisions: live checks only where a test cannot see the result (`wigley:writing-tests` § What earns
           a live run instead)

1. `npm run selftest` passes, the forms group included. (expected path)
2. Drive run (`.agents/skills/drive/SKILL.md`), on the layout preview round (`Space z l o`), whose
   cards run taller than the window:
   - On the form page, `Ctrl+j` twice then `Ctrl+k`: the captures show the main column moving down
     and back up, and the rail and status bar staying where they are. (low-confidence: whether
     `split.end` is the element that overflows is wiring no unit test sees)
   - `a`, then `Ctrl+j` in INSERT: the form scrolls, the notes box keeps focus and its INSERT mode,
     and the next typed letter lands in the box. (low-confidence: the chord's path through the
     editor host)
   - In the review (`Space Space`), with the window narrowed until the review's rows run past its
     bottom, `Ctrl+j`: the log reads `scrolled the form down half a page` (with or without
     `to the bottom`) and the capture shows the rows moved. (low-confidence: the review's scroll
     element)
   - Key help (`Space ?`) in the form lists `next box` / `previous box` under `Ctrl+n` / `Ctrl+p`
     (`⌃n` / `⌃p` on macOS) and the half-page scroll commands under `Ctrl+j` / `Ctrl+k`. (expected
     path)

Done when: the self-test passes and every capture above shows its result
Commit:    none

## Proof

