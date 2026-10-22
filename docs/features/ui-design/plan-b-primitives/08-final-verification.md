# 08 — Final verification

Status: in progress
Type: Task
Wave: 5 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     none changed; a failure found here goes back to its task as a fix, recorded in the run log
Consumes:  the landed run (01–07)
Produces:  the verification report: each command's result, what the agent saw in each screenshot,
           and the live checks handed to the user
Decisions: the agent runs the commands and reads the screenshots; the visible `npm start` is the
           user's (AGENTS.md § Running and testing), so the live checks go to the user as steps ·
           `npm run selftest` is the agent's to run any time
Done when: the four commands pass; every screenshot below has been opened and judged against
           `DESIGN.md`, with what was seen written per screenshot; the live checks below are handed
           to the user, each with its steps and its tag
Commit:    none, unless a fix lands — then one commit per fix, in its own task's group

## Commands

Run in order, each from the repo root (prefix `source ~/.nvm/nvm.sh && nvm use &&` when the shell
is on another Node): `npm run typecheck`, `npm run lint`, `npm test`, `npm run selftest`. Each must
exit 0; `npm run selftest` prints `[selftest] all passed`.

## Screenshots

Open each PNG the self-test saved in `.selftest/screenshots/` (02) with the Read tool and write,
per screenshot, what was seen against each point:

| Screenshot | What it shows |
|---|---|
| `forms-gallery-<n>-full.png`, every page n from 1 to the last | the gallery, full transparency, page by page |
| `forms-gallery-<n>-reduced.png`, every page | the gallery, reduced, page by page |
| `forms-sessions-full.png`, `forms-sessions-reduced.png` | Sessions mode on the layout preview's round |
| `docs-docs-full.png`, `docs-docs-reduced.png` | Docs mode on the fixture's tree |
| `forms-shell-layout-test.png` | the gallery's test shell layout, checked against DESIGN.md's shell layout |
| `forms-shell-layout-restored.png` | the real shell after swapping back, checked against `forms-sessions-full.png` |

The folder holds exactly these (the gallery's page count as 06 landed it, twice, plus six), plus any
screenshot another task's step takes; a missing one is a failed step in 06.

Judgement is scoped: the gallery shots are judged on every point below. The Sessions and Docs shots
are judged only on the transparency difference (the washes, opacity) and on nothing broken after
task 03's token swap (places, sizes, no clipped or overlapping text): plan C rebuilds those surfaces,
so density, accent, sentence case and the rest are its to judge.

Points, from `DESIGN.md` § Checks and § Layers:

- **Density**: rows at `row-list` / `row-tree`, tabs at `tab-height`, no loose whitespace between
  sections.
- **One accent**: mauve only on the primary button, selected rows, the active tab's top mark, the
  focus ring, the recommended choice; every other colour at rest is a status.
- **Layers and materials**: chrome (title bar, activity bar, side bar, tab strip, status bar) translucent
  `material-chrome-bg` with the washes showing through (blur on the chrome arrives with plan C, whose
  task 01 puts `.material-chrome` on the shell areas, so judge no blur there); sheets solid with a gutter and `radius-lg`; floating panels and the dialog on the
  floating material with a shadow; nothing in a sheet shows through.
- **Both transparency settings**: in the `-full` shots the backdrop's washes show faintly through
  the chrome; in the `-reduced` shots the chrome and floating panels are opaque and the washes are
  gone, and every screen still reads as intended.
- **Sentence case** in every label, header, button and tab; no capitals for emphasis.
- **Kbd**: chords print with the platform's glyphs (⌘ ⌥ on macOS), in JetBrains Mono.
- **Gallery coverage**: every section of 06's table is in one of the pages, the last page reaching the sheet's end, each state cell
  distinct from its neighbours (hover differs from live, selected from cursor).

The screenshots exist only because the self-test renders offscreen; a PNG that is blank, black or
the wrong size is a 02 defect (low-confidence: offscreen capture with `backdrop-filter`).

## Live checks for the user

Handed to the user as steps in a visible `npm start`, each tagged.

| # | Steps | Expect | Tag |
|---|---|---|---|
| 1 | `Space z g` | the Gallery mode shows, its activity-bar icon marked, the title bar's context reads `Gallery`, then `Every primitive in every state` in `fg-secondary` (two spans, no `·`) | expected |
| 2 | Hover each live sample in the gallery | each live button, icon button, chip, row, tab and collapsible head fills on hover within `duration-fast`, matching its forced `hover` cell | low-confidence: hover rules and their `.is-hover` mirrors are written twice with no test |
| 3 | Press and hold a live button | it takes its `pressed` look | expected |
| 4 | `t`, then `t` again | the chrome, the side bar and the floating samples turn opaque and the backdrop's washes vanish, then return; `settings.json` is unchanged (check its modified time) | low-confidence: the override runs through plan A's theme application with no test |
| 5 | After `t` to reduced, `Space k s`, then `Space k d` | Sessions and Docs modes stay reduced; `Cmd+R` reload returns to the setting | low-confidence: wiring between the override and config pushes |
| 6 | Drag the gallery Split's line left past its minimum and right past its maximum | the start pane stops at 160px and 400px; the line turns accent while dragging | expected |
| 7 | Set the Split to a new width, quit, `npm start` again, `Space z g` | the Split opens at the width left | low-confidence: the write on release and the read at start cross the Bridge to main's ui-state file |
| 8 | Narrow the window below 640px wide on the gallery | the Split stacks, start pane above, the handle gone | expected |
| 9 | Look at any Kbd and any code in the gallery and Docs mode, then at text a view sets in weights 500 and 600 (a primary button's label, a section header) | JetBrains Mono renders (a slashed zero, the `l` with a tail), not the system mono; weights 500 and 600 differ visibly from 400 | expected (01: the three weight files are imported in `renderer.ts`) |
| 10 | Look at the activity bar, the collapsible card chevrons and the icon buttons | Codicons draw, none as an empty box | expected |
| 11 | macOS System Settings → Accessibility → Display → Reduce motion on, then open which-key (`Space`), hover a live gallery sample, and in devtools run `getComputedStyle(document.documentElement).getPropertyValue('--wg-duration-fast')` | panels appear at once, no fade; hover fills are instant; the property reads `1ms`; turn it off and the fade returns | low-confidence: the `!important` override of tokens `ThemeApplier.apply` writes as inline style is a cascade no test covers (01) |
| 12 | macOS Reduce transparency on, with `transparency` at its default `system` | every glass surface turns opaque without a restart | low-confidence: the OS preference path under `system` |
| 13 | Look at the title bar, side bar and status bar against the backdrop, then `t` in the gallery to reduced | the chrome is translucent `material-chrome-bg` with the backdrop's mauve and blue washes showing through; no blur on it yet (plan C's task 01 puts `.material-chrome` on the shell areas, and blur arrives then); under reduced the washes are gone and the chrome is opaque | expected (01) |
| 14 | In the gallery, scroll so content passes behind the Materials section's `material-floating` panel and the FloatingPanel frame, then `t` to reduced | the panel blurs what is behind it, with a 1px edge, a top highlight and a soft shadow; under reduced it is opaque `base` with no blur | expected (01) |
| 15 | Look at the window corners with no sheet over them | the L0 backdrop is crust with two faint washes, top left and bottom right | expected |
| 16 | `npm run package`, start the packaged app, open devtools' console, look at any mono text | no CSP violation for a font; mono text is still JetBrains Mono | low-confidence: Vite inlines small assets only in a build, which no test runs (01) |
| 17 | Use the app for a minute: status bar, side bar, and a toast (save a broken `settings.json` to raise one, then fix it) | each keeps its place and size after 03's token swap in `shell.css` | expected (03) |

The agent checks two more itself, from the self-test's output, before handing over:

- `.selftest/screenshots/forms-round.png` (02's own step) shows the round after its step's keys,
  at the window's size — expected (02)
- `.selftest/screenshots/forms-round.png`, and every other PNG, is not blank or black; if one is,
  02's fallback (the frame the offscreen window's `paint` event hands over) is the fix —
  low-confidence: Electron does not confirm `capturePage` for an offscreen window (02)

## Next plan

When this task's checks pass, the agent ends its report by prompting the user to start plan C (surfaces): run `/clear`, then `wigley:make` on `docs/features/ui-design/plan-c-surfaces/`.

## Proof

