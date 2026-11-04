# 08 — Final verification

Status: done
Type: Task
Wave: 5 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     none (captures under the drive run's folder)
Consumes:  the landed feature
Produces:  the live checks below, each with its capture read

Gate before the drive run: `npm run typecheck`, `npm run lint`, the tests the plan's tasks name, and
`npm run selftest -- --plugin sessions`.

Checks the suite cannot see, through a drive run (`.agents/skills/drive/SKILL.md`). Show Sessions mode first.
Open three owned sessions with `sessions.open`, in this order:
`{"sessionId":"s-ngp2","projectDir":"/Users/jonathonwigley/Documents/dev/peoplefun/new-games-prototypes-2"}`,
`{"sessionId":"s-ngp3","projectDir":"/Users/jonathonwigley/Documents/dev/peoplefun/new-games-prototypes-3"}`,
`{"sessionId":"s-gui","projectDir":"/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui"}` — s-gui, opened last, is
selected. The project lookup writes no line when it lands: `query` `.session-group-name` until it reads both
`wigley-ai-gui` and `new-games-prototypes`, then capture.

1. **Clones group as one project** — expected. No section labels; groups `wigley-ai-gui` (1 row) over
   `new-games-prototypes` (2 rows: `new-games-prototypes-3` over `new-games-prototypes-2`, newest first). Each
   header: name and count, with the grip and star hidden until hover.
2. **Favorite by key** — expected. With s-gui focused, `Space p f`; capture: label `Favorites` with a rule over
   `wigley-ai-gui`, its star lit; label `Recent` over `new-games-prototypes`. `Space p f` again: the labels go.
3. **Needs you moves a group up** — low-confidence (the view test covers it on fakes; the live forms wiring has
   none). Open a forms round with `forms.openRound` and `"sessionId":"s-ngp2"`; capture: `new-games-prototypes`
   now over `wigley-ai-gui`, with `new-games-prototypes-2` first inside it.
4. **Step keys follow drawn order** — low-confidence. Press `⌥⇧O` once per row and read the log's
   `[sessions] activated <label>` lines: they run in the drawn order, top to bottom, wrapping.
5. **Gallery DragReorder entry** — expected. `Space z g`; capture the entry.
6. **Sessions layout preview** — expected. `Space z l s`; capture: the sample draws a `Favorites` section with
   `wigley-ai-gui` over a `Recent` section with `new-games-prototypes` and `wigley-agents`.

Each capture is read against `DESIGN.md` (tokens, spacing) and the header contents task 05 pins (grip, star,
name, count; a section label with a rule after it). A star or grip drawing an empty box means a wrong Codicon
name.

Checks only the user's hands settle (listed in the wrap-up, not run): dragging a group header with a real mouse
within Favorites (down one slot and up one), from Recent into an empty Favorites, and from Favorites into Recent;
dropping a file on the chat while the side bar shows — synthetic input does not drive HTML5 drag and drop
reliably.

Done when: every check above passed with its capture read, or its failure is reported
Commit:    none

## Proof

Commit none · proof: typecheck, lint, tests and sessions self-test green; drive run sg08: checks 1-6 pass with captures read; check 7 not settled, the offscreen drive starts a native drag but delivers no dragover or drop · concerns: real mouse drops stay the user's; is-reordering sometimes outlived release under the drive; name indent, tight top and a truncated row title are visual doubts for the review
