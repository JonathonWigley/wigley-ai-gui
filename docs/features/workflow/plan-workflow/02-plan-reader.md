# 02 — Plan reader: progress from a plan.md

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/workflow/plan-reader.ts` · test `src/plugins/workflow/plan-reader.test.ts`
Consumes:  none. The plan.md format is `plan-folder.md` § plan.md in wigley-ai-marketplace
           (`plugins/wigley/skills/feature/plan-folder.md`); the fence and box rules copy
           `checkbox_counts` and `_lines_outside_fences` in `plugins/wigley/scripts/docs-index/markdown.py`.
Produces:  in `src/plugins/workflow/plan-reader.ts`, as plan.md § File Structure writes them plus the `tasks` member
           (task 09's Flow tab draws the checklist from it):
           `export interface PlanTaskLine { wave: number | null; text: string; done: boolean }`
           `export interface PlanProgress { checked: number; total: number; wave: number | null; reviewRounds: number; title: string; tasks: readonly PlanTaskLine[] }`
           `export function readPlanProgress(text: string): PlanProgress;`
Decisions:
- **`tasks`**: one `PlanTaskLine` per counted box under `## Tasks`, in file order. Main sends the checklist inside
  `progress`, so the page never reads plan.md. `wave` is the number of the `### Wave N` the box sits under, `null`
  before any wave heading. `done` is true for a checked box (struck ones included). `text` is the line after its box
  (`^\s*[-*] \[( |x|X)\]` removed), trimmed, with markdown links reduced to their text (`[a](b)` → `a`) and `~~`
  removed: `- [x] ~~[Expiry clock](02-expiry-clock.md)~~ — dropped: why` → `Expiry clock — dropped: why`;
  `- [ ] [Claim grants](03-claim-grants.md) — after 01, 02` → `Claim grants — after 01, 02`. `checked` and `total`
  equal the count of `done` lines and of `tasks`.
- **Pure.** No I/O, no clock, no DOM (plan.md boundary rules). The module imports nothing.
- **Lines.** Split `text` on `\n` and remove one trailing `\r` from each line, so a CRLF file reads the same.
- **Fenced code does not count**, for every rule below (title, headings, boxes, list lines). Use the rule of
  `_lines_outside_fences` in `markdown.py`:
  - Match each line, its leading whitespace removed, against `` ^(`{3,}|~{3,})(.*) ``.
  - Outside a fence, a match opens a fence, except a backtick run whose rest (group 2) holds a backtick: that is
    inline code, and the line stays outside.
  - Inside a fence, a match closes the fence only when its run is the same character as the opener, at least as
    long, and its rest is only whitespace.
  - The fence lines themselves are left out. A file that ends inside an open fence leaves the rest out.
- **A box** is a line outside fences that matches `^\s*[-*] \[( |x|X)\]` (the `CHECKBOX` pattern of
  `markdown.py`). `x` or `X` is checked; a space is open. A struck line, `- [x] ~~[Expiry clock](02-expiry-clock.md)~~ — dropped: <reason>`
  (`plan-folder.md` § Status and ticks), is a checked box by the same pattern, with no rule of its own.
- **Only boxes under `## Tasks` count.** This is narrower than `checkbox_counts`, which counts the whole file:
  plan.md § File Structure says "under ## Tasks", and a plan's Preconditions or Run log may hold list lines that
  look like boxes. The `## Tasks` section runs from the line that is exactly `## Tasks` (trailing whitespace
  ignored) to the next line outside fences that starts `# ` or `## `, or the end.
- **Headings** are lines outside fences. A heading's level is its count of leading `#` followed by a space.
- **`wave`**: inside `## Tasks`, each line matching `^### Wave (\d+)\b` starts a wave that runs to the next line of
  level 1 to 3. `wave` is the number of the first wave, in file order, that holds an open box. A box under `## Tasks`
  before any wave heading counts toward `checked` and `total` and belongs to no wave. `null` when no wave holds an
  open box.
- **`reviewRounds`**: the `### Review rounds` section inside `## Run log`. `## Run log` runs from the line that is
  exactly `## Run log` to the next line of level 1 or 2. `### Review rounds` runs from that exact line to the next
  line of level 1 to 3. Count its lines outside fences that start `- ` (column 0). `0` when either section is missing.
  `wigley:make` writes each round there as `- <round> · <pinned head> · <verdict>`.
- **`title`**: the text of the first line outside fences that starts `# `, the `# ` removed and trimmed, with a
  trailing ` — plan` (space, em dash U+2014, space, `plan`) removed. `''` when the file has no such line.
- **No throw.** Every text, empty included, gives a `PlanProgress`: empty text reads
  `{ checked: 0, total: 0, wave: null, reviewRounds: 0, title: '', tasks: [] }`.

GIVEN a plan.md with Wave 1 ticked, Wave 2 holding one ticked and one open box, and Wave 3 open WHEN
`readPlanProgress` runs THEN it returns `checked` 3, `total` 5, `wave` 2
GIVEN a struck box under `## Tasks` WHEN it runs THEN the box counts as checked
GIVEN a box inside a fenced block under `## Tasks` WHEN it runs THEN the box does not count
GIVEN `### Review rounds` holding two `- ` lines WHEN it runs THEN `reviewRounds` is 2

Tests:     `plan-reader.test.ts`: `describe('readPlanProgress')`, one `it.each` table
           `'$name'`, each row `{ name, text, expected }` with `expected` a whole `PlanProgress` literal compared with
           `toEqual`. The texts are inline plan.md strings, built from one helper `plan(tasks: string, runLog = '')`
           that wraps the `## Tasks` body and the `## Run log` body in the `plan-folder.md` skeleton under
           `# Claim grants — plan`, so each row writes only what makes it differ. Rows:
           · every box open in three waves → `checked 0`, `total 5`, `wave 1`
           · Wave 1 ticked, Wave 2 one `[x]` and one `[ ]`, Wave 3 open → `3`, `5`, `wave 2`
           · every box ticked, one with `[X]` → `5`, `5`, `wave null`
           · a struck dropped box in Wave 1, rest of Wave 1 ticked, Wave 2 open → struck counts as checked, `wave 2`
           · a fenced block (```` ``` ````) under `## Tasks` holding `- [ ] fake` → not counted
           · a `~~~` fence holding a ```` ``` ```` line and a box: the inner backtick line does not close it → box not counted
           · a box line under `## Preconditions` → not counted
           · a box under `## Tasks` before any `### Wave` heading, open, with Wave 1 ticked → counted in `total`, `wave null`
           · `* [ ]` and an indented `  - [ ]` → both counted
           · `### Review rounds` with two `- ` lines and a `### Test gate` line after it holding `- x` → `reviewRounds 2`
           · no `## Run log` → `reviewRounds 0`
           · title `# Claim grants — plan` → `'Claim grants'`; title `# Claim grants` → `'Claim grants'`; a
             `# Not the title` line inside a fence before the real title → the real title
           · `tasks`: the two-wave row asserts the whole `tasks` array — a linked line with ` — after 01` text, a
             struck dropped line (`done: true`, `~~` and link removed), and a box before any wave (`wave: null`)
           · CRLF line ends → same result as the LF row it copies
           · `''` → the empty progress above
Done when: compiles; `npm run lint` passes; the test gate runs the test above.
Commit:    one commit for the group

## Proof

Commit ed6174a · proof: diff read: PlanProgress, PlanTaskLine, readPlanProgress word for word; typecheck clean for the file; plan-reader tests pass · concerns: none (lint could not reach the file past 06's in-flight layer error; oxlint/oxfmt run directly passed)
