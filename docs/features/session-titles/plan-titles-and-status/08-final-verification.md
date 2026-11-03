# 08 — Final verification

Status: in progress
Type: Task
Wave: 5 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     none
Consumes:  every landed task
Produces:  a drive-run report with captures
Decisions:
- Run through the drive loop (`.agents/skills/drive/SKILL.md`) on its own temp home; read every capture against `DESIGN.md`. Each check is tagged with why it earns a live run:
  1. **expected** — a row with an agent title shows the title, then the folder label dimmed, then the activity dot and word on the same line, at the default side-bar width and at its least width (text ellipsis, the dot and word kept).
  2. **expected** — the working dot pulses; needs you, done and error use the peach, green and red dots; no separate attention dot shows beside an activity.
  3. **low-confidence** — `<Leader>rr` opens the dialog over the focused pane's session, prefilled; over the limit shows the problem; Enter renames; empty hands back (focus and pushed-scope wiring no unit test sees).
  4. **low-confidence** — a live Claude Chat-tab session in the drive run, asked one short task, calls `set_session_title` at the end of its first turn, and its row shows the title (the instruction's wording is the only thing driving this).
  5. **low-confidence** — relaunching the drive app restores an owned row's agent and user titles.
  6. **expected** — a turn ending in an unfocused session shows done; focusing it clears it.
- Report each check as pass or fail with its capture path. A failure goes back to the task that owns it.
Done when: every check above passes, with its captures read
Commit:    none (no code); the Run log records the result

## Proof
