# 05 — Final verification

Status: done
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Run the app through its own tooling: `npm run selftest`, then the `drive` skill (`.agents/skills/drive/SKILL.md`) for
the checks below, capturing a screenshot for each visual one. Only checks a test cannot pin are here.

Files:     none (captures go in the session scratchpad)
Consumes:  everything landed
Produces:  a pass / fail per check, with its capture path

| # | Check | Expected | Kind |
|---|---|---|---|
| V1 | `npm run selftest` | `[selftest] all passed`, the moved docs focus steps and new Ctrl+j/k steps among them | expected |
| V2 | On the page press `Space` | which-key lists `k` as `+windows` and `z` as `+debug`; `Space k` lists `s`, `d`, `n` | expected |
| V3 | In a forms text box press `Space` (the leader) | which-key lists `a` as `+answer`; on the page `Space` shows no `a` group | low-confidence: box-only routes marked `where: 'box'` by hand in the migration |
| V4 | Docs mode with a long doc: `Alt+l`, then `Ctrl+j` twice, `Ctrl+k` once, `Alt+h` | focus moves to the doc; the doc scrolls down half a page twice and back once; focus returns to the tree | expected |
| V5 | A Chat tab with a transcript taller than the sheet: `Ctrl+k`, `Ctrl+j`; then `i` into the composer and `Ctrl+k` | the transcript scrolls half a page up, then down; the focused entry stays marked; from the composer `Ctrl+k` scrolls the transcript and types nothing | low-confidence: new scroll path, no test over it |
| V6 | Gallery mode (`Space z g`): `Ctrl+j`, `Ctrl+k` | the sheet pages down, then up | expected |
| V7 | Write a new-format `keymap.json` in the drive run's config folder binding `docs.focusTree` to `<A-u>` in `docs.doc` and unbinding `{ "keys": "<A-h>", "scope": "docs.doc" }` | the doc pane's empty-state hint shows `⌥U` without a restart (live-checks D13) | low-confidence: reader rewritten |
| V8 | Write an old-format `keymap.json` (a top-level `page` section) | the status bar shows the "old keymap section" problem and the last good keys keep working | low-confidence: new error path |

Done when: every check passes, or each failure is reported with its capture and a one-line cause.

## Proof
V1–V8 passed in drive run keymap-v (report: session scratchpad live-checks-report.md); V4b/V5b (editor half-page, chat follow) added and passed. Final `npm run selftest` at 408a05a: `[selftest] all passed`. keymap-v2: help prints ↩ ⎋ ⌘↩ ⌃J.
