# 09 — Self-test

Status: not started
Type: Task
Wave: 6 · Depends on: 08
Plan: [plan.md](plan.md)

The docs key behaviours, proved offscreen by `npm run selftest`. Only one self-test script runs (`SelfTestHost.run`
throws on a second, `src/main/selftest.ts`), so the docs steps join forms' script, after its last step. The docs
main part already wrote its fixture into the temp home at start (06); these steps drive it through the page.

Files: modify `src/plugins/forms/main/selftest-script.ts`

Consumes:
- the fixture of 06 (`writeDocsFixture`: eight entries, the stand-in `docs_index.py` whose `build` lists new rules)
- the keys and log lines pinned in 07 and 08 (each `[docs] …` line below is `services.log('docs', …)`)
- plan A's script as it lands (plan A task 06): its last step submits the first session's round, leaving Sessions
  mode shown with session `selftest` selected, its Form tab idle; plan A's `Space k s` command `sessions.showMode`

Produces: no new member. `STEPS` gains the steps below after the last forms step; `SCROLLS_ITSELF` gains
`'.docs-row-title'`, `'.docs-path'`, `'.docs-status'`, `'.docs-frontmatter'`, `'.docs-completion'`,
`'.docs-editor'` (row titles, paths and the status line end in an ellipsis; the field table, the completion list —
class `docs-completion`, task 08 — and the editor's wrapper `div.docs-editor`, task 07, scroll in their own box).

Plan A's steps that plan B's Docs tabs change (every session now gets a Docs tab when it connects, selected as its
first tab until a round selects the Form tab; plan A task 05):
- `{ keys: ['<A-o>'], expect: '[sessions] no other tab in selftest 2' }` becomes
  `{ keys: ['<A-o>'], expect: '[sessions] showed Docs tab in selftest 2', checksFit: true }`, followed by a new step
  `{ keys: ['<A-o>'], expect: '[sessions] showed Form tab in selftest 2' }`, so the close-prompt steps after it run in
  the Form tab as before. These two prove a session's tab keys step over its Docs and Form tabs.
- `{ keys: ['<A-S-i>'], expect: '[sessions] nothing shown in Codex session', checksFit: true }` becomes
  `{ keys: ['<A-S-i>'], expect: '[docs] session index: No project folder is known for this session', checksFit: true }`:
  the third session (Codex, no folder) now shows its Docs tab, whose first show runs the session source, and 06's rule
  gives that message. It proves the no-folder path end to end. The next step (`<A-S-o>` → `activated selftest`) and
  the review steps stay: the Form tab's `shown()` sets `forms.forms` again.
- The comment above `STEPS` names both changes.

## Decisions

- The steps append after plan A's last step, in this order; each `expect` is verbatim. `checksFit: true` where
  marked. The header comment over `STEPS` gains one paragraph narrating them, in the existing comment's style.
- The tree at the first load (07: roots expanded, the first row selected), from 06's fixture — rows:
  `Global` ▾, `Instructions`, `Rules`, `Hooks`, `Plugins` ▾, `selftest-plugin@selftest-market`, `selftest-repo` ▾,
  `Instructions`, `Skills`, `Features` (the fixture's plugin entry is `source: plugin`, so it sits in the plugin's
  node, not under `Global`).
- File changes stay in `~/.claude/rules` of the temp home, the only folder the stand-in build lists new files in (06).
- Delete runs to the confirm and answers `y`: under the self-test `files.trash` deletes for good (task 01), so the
  user's Trash never collects the temp file. The macOS Trash itself is task 11's live check.
- `:` is pressed as its own key (`press(':')`): a `char` event types it and CodeMirror vim opens its command line.
  If Electron refuses `:` as a `keyCode`, the implementer stops and reports it to the lead rather than changing the
  driver: a driver change is core work outside this task.

| # | Keys | Expect | Fit |
|---|---|---|---|
| 1 | `' ', 'k', 'd'` | `[docs] index rebuilt: 8 entries` | yes |
| 2 | `'j', 'l'` | `[docs] expanded Instructions` | |
| 3 | `'j', 'l'` | `[docs] opened CLAUDE.md` | yes |
| 4 | `'<C-l>'` | `[docs] doc focused` | |
| 5 | `'Tab', 'Enter'` | `[docs] opened style.md` | |
| 6 | `'i'` | `[docs] editing style.md` | yes |
| 7 | `'o', ...'new line', 'Escape', ':', 'w', 'Enter'` | `[docs] wrote style.md` | |
| 8 | `':', 'q', 'Enter'` | `[docs] closed the editor on style.md` | |
| 9 | `'i'` | `[docs] editing style.md` | |
| 10 | `'x', ':', 'q', 'Enter'` | `[docs] refused :q with unsaved edits on style.md` | |
| 11 | `':', 'q', '!', 'Enter'` | `[docs] dropped edits on style.md` | |
| 12 | `'<C-h>'` | `[docs] tree focused` | |
| 13 | `'a'` | `[docs] create: pick a kind` | yes |
| 14 | `'j', 'Enter'` | `[docs] create rule: pick a place` | |
| 15 | `'Enter'` | `[docs] create rule: name it` | |
| 16 | `...'tidy', 'Enter'` | `[docs] created tidy.md` | |
| 17 | `':', 'q', 'Enter'` | `[docs] closed the editor on tidy.md` | |
| 18 | `'<C-h>'` | `[docs] tree focused` | |
| 19 | `'r'` | `[docs] rename: type the new path` | yes |
| 20 | seven `'Backspace'`, `...'neat.md', 'Enter'` | `[docs] renamed tidy.md to neat.md` | |
| 21 | `'A'` | `[docs] create by path: type the path` | |
| 22 | `'n', 'Tab'` | `[docs] completed to ~/.claude/rules/neat.md` | yes |
| 23 | `'Escape'` | `[docs] create cancelled` | |
| 24 | `'A'` | `[docs] create by path: type the path` | |
| 25 | `...'fresh.md', 'Enter'` | `[docs] created fresh.md` | |
| 26 | `':', 'q', 'Enter'` | `[docs] closed the editor on fresh.md` | |
| 27 | `'<C-h>'` | `[docs] tree focused` | |
| 28 | `'d'` | `[docs] asked to move fresh.md to the Trash` | yes |
| 29 | `'y'` | `[docs] moved fresh.md to the Trash` | |
| 30 | `'R'` | `[docs] index rebuilt: 9 entries` | |
| 31 | `'c'` | `[page] c ran docs.pickContext` | yes |
| 32 | `'j', 'Enter'` | `[docs] context ~/dev/selftest-repo` | |
| 33 | `' ', 'k', 'd'` | `[docs] tree hidden` | yes |
| 34 | `' ', 'k', 'd'` | `[docs] tree shown` | |
| 35 | `' ', 'k', 's'` | `[page]  ks ran sessions.showMode` | |
| 36 | `'<A-i>'` | `[docs] Docs tab shown` | yes |
| 37 | `'R'` | `[docs] session index read: 4 entries` | |

Why each value holds:
- 1: Docs mode's first `shown()` runs the build (07); the line follows the mode show, so the step waits on it rather
  than on `showed Docs mode`, which a fit check could outlast. 06's fixture has eight entries and every file exists,
  so the stand-in build lists the same eight.
- 2–3: `j` from `Global` reaches Global's `Instructions`; `l` expands it; `j` reaches `Self-test instructions`;
  `l` opens `CLAUDE.md`.
- 5: `Tab` moves focus to the body's first anchor, `[the style rule](rules/style.md)`; `Enter` clicks it; the link
  resolves to a listed entry (07 Links), which also selects the `Style` leaf under `Rules`.
- 7: `o` opens a line below in vim, the text is typed, `Escape` returns to normal mode, `:w` writes — the disk still
  equals the loaded text, so the write goes through.
- 10–11: `x` deletes a character, so `:q` is refused; `:q!` drops it (07 logs `dropped edits on <name>` before
  `closed the editor on <name>`).
- 13–16: the kind list's second entry is `rule`; its one place is `Global · ~/.claude/rules` (the fixture's rules are
  global); `tidy` is a valid rule name; the editor opens on the new file.
- 19–20: the box holds `~/.claude/rules/tidy.md`; seven Backspaces leave `~/.claude/rules/`.
- 21–22: the selected leaf is `neat.md`, so the box opens at `~/.claude/rules/`; `n` leaves one match, `neat.md`; Tab awaits
  the folder's listing before it completes (08), so the 30 ms between the keys is no race.
- 30: eight fixture entries + `neat.md`; `fresh.md` is gone, so the stand-in build lists nine.
- 31–32: the context picker opens on the home folder's context; `j` moves to `~/dev/selftest-repo` (07:
  `contextChoices`, home first, then by folder). Step 31 waits on the page's own line since the picker logs nothing.
- 35: the page logs a sequence's keys joined, a space shown as itself (`[page]  ks ran …`, as forms' `Space ?` step
  shows `[page]  ? ran keys.toggleHelp`). Use plan A's `sessions.showMode` command id as it lands.
- 36: `selftest`'s tabs are its Docs tab and its Form tab, the Form tab selected since its round; `<A-i>` steps to
  the other tab whichever order they were added in. The Docs tab may have shown once before the round arrived, so
  the step waits on `shown()`'s own line, not on the first run of the source.
- 37: `R` in the session view (its scope set by `shown()`) re-runs the session source; the stand-in prints the
  session document's four entries.

## GIVEN / WHEN / THEN

- GIVEN the self-test's temp home holds the docs fixture WHEN `npm run selftest` runs THEN every step above passes, with no file outside the temp home read or written by docs.

## Tests

The self-test itself; no Vitest test.

## Done when

`npm run selftest` passes (`[selftest] all passed`), each docs step reported `PASS`.

## Commit

One commit for the group: "Self-test: docs mode, links, the editor, create, rename, completion, context and the session Docs tab".

## Proof

