# 10 — Final verification

Status: not started
Type: Task
Wave: 6 · Depends on: 01–09
Plan: [plan.md](plan.md)

Run by `wigley:make` once, after its test gate, in a drive run of the app (`wigley-ai-gui/.agents/skills/drive/SKILL.md`)
over the backlog fixture's homes and the practice fixture (`practice.writeFixture`), with the fake agent harness. Each
check's captures (screenshots, the page log lines) are read before the check is marked. Risk tier: High — a new
plugin, a moved session lifecycle that Practice already depends on, and a rewritten screen
(`~/wigley-agents/decisions.md` § Risk).

Self-test runs, filtered: `npm run selftest -- --plugin practice --plugin backlog` (scoped-agents has no self-test script; each host's
script drives its own pane).

Live checks:

1. **Backlog table** (expected): the mode opens with no side bar; rows from every fixture repo show repo, title and
   one line, ready, staleness and chunk; the repo picker (`Space v r`), `Space v a`, `Space v c`, `Space v s`,
   `Space v d` and `/` each change the rows. Screenshot the table against `DESIGN.md` § Surfaces (density, row
   heights, the focus ring on the cursor row).
2. **Review pane** (expected): it follows the cursor; the staleness note reads per level (`fresh`, `moved`, `stale`,
   `unknown` — the fixture holds one of each, or the check says which it lacks); `gl` shows and hides the commit
   list.
3. **Chunks** (low-confidence: new focus pane and a store with a writer on each side): `x` marks two rows, `c` makes
   a chunk named after the first title, `r` renames it, `u` takes one row out, `c` on another repo's row is refused
   with its toast; `Alt+j` reaches the strip and `h`/`l` move in it; a page reload keeps the chunks and the marks.
4. **Chunk start** (expected): `s` starts the chunk through the fake harness; the new session's first message holds
   the brief and each item's title, one line, body and file location; the chunk's rows dim and link to the session,
   and `Enter` on the link activates its row; closing that session from Sessions retires the chunk and the rows
   come back unchunked. `S` with two unstarted chunks starts two sessions. A repo with no folder is refused with the
   toast naming `repoFolders`.
5. **Assistant** (low-confidence: the pane moved out of Practice): `Space v b` opens the right pane with the ask box;
   a first message launches the assistant and mounts its chat; `Alt+h` / `Alt+l` move between it and the table;
   `W` sends the sweep text for the filtered repo into the same session; a page reload brings the same session back.
   The fake harness calling `read_backlog_state` from the assistant returns the screen; from any other session it
   gets the refusal.
6. **Practice unchanged** (low-confidence: the interviewer's code moved): open a fixture problem, `Space v i` shows
   the ask box with the problem's title, a first message mounts the interviewer, reopening the problem brings it
   back, a new attempt starts a fresh one; `Cmd+'` and `Cmd+Enter` in the interviewer's ask box still run and
   submit, and do nothing from Backlog's ask box; `read_practice_state` still answers only the interviewer.
7. **Notes still files follow-ups** (low-confidence: backlog main lost its page write paths): file a note to a
   follow-up in a fixture home; it lands in the file and shows as a new row.

Checks only the user's hands settle (listed in the wrap-up, not run here): none beyond a look at the table in the
user's own theme in the stable app after install.

## Proof
