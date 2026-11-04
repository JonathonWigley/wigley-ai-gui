# 09 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     none, unless a check fails
Consumes:  the landed code of 01–07
Produces:  screenshots and a report of each check
Decisions:
- Run `npm run lint`, `npm run typecheck` and `npm test`.
- Run the filtered self-test: `npm run selftest -- --plugin chat,agent-strip,usage,workflow,agent-lines,agent-skills`. Do not run the whole self-test: the user asks for that run. A failure here is a defect to fix.
- Drive the app with `npm run drive` (`.agents/skills/drive/SKILL.md`) with a fake session, for the checks below. Compare each screenshot with `DESIGN.md`. Report each check with its screenshot path.

Live checks:

| # | Kind | Check | Why a test does not settle it |
|---|---|---|---|
| 1 | expected | A running turn, Chat tab at 1000 px or wider: the hub shows Main agent with its time and tools, and the composer shows no activity line | Wiring and layout |
| 2 | low-confidence | The same turn with the Chat tab under 640 px (split the pane): the hub is gone, and the composer shows `m:ss Working…` | A CSS container rule, no test sees it |
| 3 | expected | `Space v s` at full width: the hub goes, the one line shows, the transcript takes the width. Press again: all return. Relaunch with the hub hidden: it stays hidden | Layout and persistence through the real `uiState` |
| 4 | low-confidence | A short window with a long plan and many skills: each section shrinks and scrolls inside itself, the column does not overflow, and the plan's actions row stays in view | Flex and scroll in the real engine |
| 5 | expected | Collapse Plan by a click: it stays collapsed in another pane's tab, and focus stays where it was | Focus and layout |
| 6 | expected | The fake turn's two subagents and two tasks: two cards, then two rows under them. `h` and `l` move through cards, then rows. Enter on a row wraps its whole command over its owner and description | Row look and selection ring |
| 7 | low-confidence | Five tasks: four rows show, the fifth scrolls in, and selecting it scrolls it into view | The `calc` height, no test sees it |
| 8 | low-confidence | Tasks and no agents: no scroller arrows, no empty card height | Height left over from the old `min-height` |
| 9 | expected | The context line sits above the box, its bar fills the width, and spend alone stays in the status line. During a compaction the chip and pulse show | Layout and animation |
| 10 | low-confidence | The chat layout preview (`Space z l c`) shows Main agent and Session, with nothing overlapping. The agents preview (`Space z l a`) also shows Skills with both rows | Preview wiring |
| 11 | low-confidence | Hot reload: edit a line in `chat/layouts/default/layout.css` while a turn runs, then revert it: the dock and frames redraw and the dock slot stays in the Main agent section | The moved slot across a rebuild |
| 12 | expected | A dialog or picker opened with the hub showing still centres on the window, not on the Chat tab | `container-type` on `.chat-tab` |
| 13 | expected | Type `/selftest-skill` in a fake session: Skills shows one row tagged `main`, and its head reads `1`. `npm run drive -- restart`: the row is back after the re-attach. Session reads project, branch, folder with `~`, harness, model · effort | The re-attach is live wiring |
| 14 | low-confidence | Resize the Chat tab to 639 px and to 640 px: exactly one of the dock and the one line shows at each | Two CSS rules hold one threshold |

Done when: lint, typecheck, tests and the filtered self-test pass; each live check has a result and a screenshot; every failure is fixed or reported with its output
Commit:    one commit when a check forced a fix; none otherwise

## Proof

