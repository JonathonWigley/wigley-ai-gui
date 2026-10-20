# 09 — Self-test

Status: not started
Type: Task
Wave: 6 · Depends on: 08
Plan: [plan.md](plan.md)

The docs key behaviours, proved offscreen by `npm run selftest`. Each plugin hands the driver its own script
(`SelfTestHost.run`, once per plugin, during its main part's `start`; `src/main/selftest.ts` runs the handed scripts
one after another in hand-over order on every page load), so the docs plugin gets its own
`src/plugins/docs/main/selftest-script.ts`, handed over the way chat's is. The docs main part already wrote its
fixture into the temp home at start (06); the script rewrites it at each run's start and drives it through the page.

Files:
- create `src/plugins/docs/main/selftest-script.ts`
- modify `src/plugins/docs/main/start.ts` (hand the script over)
- modify `src/plugins/forms/main/selftest-script.ts` (the steps the Docs tabs change, below)
- modify `src/plugins/chat/main/selftest-script.ts` only where a chat session's Docs tab (07) changes what a chat
  step sees — its first tab, `Chat tab shown` lines, tab cycling; run `npm run selftest` before 07's change is
  assumed harmless to chat's steps, and edit each step it breaks the way forms' are edited below

Consumes:
- `SelfTestScript`, `SelfTestStep`, `SelfTestHost` and `MainServices.selfTest` (`src/contracts/plugin.ts`, tree): a
  script is `{ pageBinds, settings, open(run) → { shownLine, result }, steps, scrollsItself, problems(result) }`;
  the driver waits for `shownLine` among the lines logged after `open`, runs the steps, then awaits `result` and
  reports `docs result <problems joined, or 'as expected'>`
- chat's hand-over as the pattern (`src/plugins/chat/main/start.ts`: `services.selfTest?.run(chatSelfTestScript({
  … }))` during `start`; `chatSelfTestScript(deps)` in `src/plugins/chat/main/selftest-script.ts`, tree)
- `SessionsMainExports.connect(info: SessionInfo): ConnectedSession` and `activate(sessionId)`
  (`src/plugins/sessions/contract.ts`, tree); `ConnectedSession.session.id` is the id `activate` takes; a row's label
  is its project folder's base name (`groupOf` in `src/plugins/sessions/main/session-list.ts`), and the sessions page
  logs `activated <label>` when the selection changes; main's `activated` message shows Sessions mode
- `api.dependency<SessionsMainExports>('sessions')`, which needs `dependsOn` to hold `sessions` (07 adds it)
- the fixture of 06 (`writeDocsFixture`: eight entries, the stand-in `docs_index.py` whose `build` lists new rules
  and whose `session` prints the four-entry session document; each call first removes the rule files earlier steps
  added)
- `files.trash` deleting for good under the self-test (01: `main.ts` passes `rm` as `trashItem` when `isSelfTest`)
- the keys and log lines pinned in 07 and 08 (each `[docs] …` line below is `services.log('docs', …)`)
- `sessions.showMode` on `Space k s` (`src/plugins/sessions/manifest.ts`, tree): shows Sessions mode when it is
  hidden

## Produces

```ts
// src/plugins/docs/main/selftest-script.ts
export interface DocsSelfTestDeps {
  files: Files;
  // `services.homeDir`, the self-test's temp home.
  homeDir: string;
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>;
}
export function docsSelfTestScript(deps: DocsSelfTestDeps): SelfTestScript;
```

`start.ts` calls `services.selfTest?.run(docsSelfTestScript({ files: services.files, homeDir: services.homeDir,
sessions }))` during `start`, beside its existing `writeDocsFixture` call. `docsMainPart` is last in `mainParts`
(06), so the docs script runs after forms' and chat's.

## Decisions

- **`open(run)`** ends the previous run's docs session, then chains: `writeDocsFixture(files, homeDir)`; `H` =
  `files.realPath(homeDir)`; `sessions.connect({ sessionId: 'docs-selftest-<run>', projectDir:
  '<H>/dev/selftest-repo', deadlineSeconds: null, harness: 'claude' })`; `sessions.activate(connected.session.id)`.
  It returns `shownLine` `[sessions] activated selftest-repo` and `result`, that chain's promise resolving `null`, or
  the error text (`errorText`) when a link of it fails. Activating puts the page in a known state whatever chat's
  script left: Sessions mode, the docs session selected, its only tab (Docs) visible. A fresh host id each run keeps
  `connect` from joining an earlier run's session. Rewriting the fixture first means a page reload's fresh run
  starts from eight entries, whatever an interrupted run created.
- **`problems(result)`**: `[]` when `result` is `null`, else `[`fixture not ready: <text>`]`. The steps' log lines
  carry every other check: `wrote`, `created`, `renamed` and `moved … to the Trash` come from main's replies, and
  step 30's nine entries come from the stand-in build reading the rules folder.
- `pageBinds` `[]`, `settings` `{}`.
- `steps` is `STEPS` below, each `expect` verbatim, `checksFit: true` where marked. The header comment over `STEPS`
  narrates them in the style of forms' and chat's.
- `scrollsItself`: `'.docs-row-title'`, `'.docs-path'`, `'.docs-status'`, `'.docs-frontmatter'`,
  `'.docs-completion'`, `'.docs-editor'`, `'.session-row-label'`, `'.session-row-status'`, `'.session-tab-label'`
  (row titles, paths and the status line end in an ellipsis; the field table, the completion list — class
  `docs-completion`, task 08 — and the editor's wrapper `div.docs-editor`, task 07, scroll in their own box; step 35
  checks fit in Sessions mode, whose row and tab labels end in an ellipsis as in forms' list).
- The tree at the first load (07: roots expanded, the first row selected), from 06's fixture — rows:
  `Global` ▾, `Instructions`, `Rules`, `Hooks`, `Plugins` ▾, `selftest-plugin@selftest-market`, `selftest-repo` ▾,
  `Instructions`, `Skills`, `Features` (the fixture's plugin entry is `source: plugin`, so it sits in the plugin's
  node, not under `Global`).
- File changes stay in `~/.claude/rules` of the temp home, the only folder the stand-in build lists new files in (06).
- Delete runs to the confirm and answers `y`: under the self-test `files.trash` deletes for good (01), so the
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
| 35 | `' ', 'k', 's'` | `[docs] Docs tab shown` | yes |
| 36 | `'R'` | `[docs] session index read: 4 entries` | |

Why each value holds:
- 1: Docs mode's first `shown()` runs the build (07); the line follows the mode show, so the step waits on it rather
  than on `showed Docs mode`, which a fit check could outlast. `open` rewrote 06's fixture, eight entries whose files
  all exist, so the stand-in build lists the same eight.
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
- 21–22: the selected leaf is `neat.md`, so the box opens at `~/.claude/rules/`; `n` leaves one match, `neat.md`; Tab
  awaits the folder's listing before it completes (08), so the 30 ms between the keys is no race.
- 30: eight fixture entries + `neat.md`; `fresh.md` is gone, so the stand-in build lists nine.
- 31–32: the context picker opens on the home folder's context; `j` moves to `~/dev/selftest-repo` (07:
  `contextChoices`, home first, then by folder). Step 31 waits on the page's own line since the picker logs nothing.
- 35: `Space k s` runs `sessions.showMode`, which shows the hidden Sessions mode; the docs session, which `open`
  activated, is still selected, so its Docs tab becomes the visible tab again and its `shown()` logs (the sessions
  contract: `shown` runs each time the tab becomes visible).
- 36: `R` in the session view (its scope set by `shown()`) re-runs the session source; the stand-in prints the
  session document's four entries. The tab's first show, right after `open`, already ran the source once; `R`
  proves it on demand.

Forms' steps that plan B's Docs tabs change (every session now gets a Docs tab when it connects, selected as its
first tab until a round selects the Form tab; 07 Docs tabs), in `src/plugins/forms/main/selftest-script.ts`:
- `{ keys: ['<A-o>'], expect: '[sessions] no other tab in selftest 2' }` becomes
  `{ keys: ['<A-o>'], expect: '[sessions] showed Docs tab in selftest 2', checksFit: true }`, followed by a new step
  `{ keys: ['<A-o>'], expect: '[sessions] showed Form tab in selftest 2' }`, so the close-prompt steps after it run in
  the Form tab as before. These two prove a session's tab keys step over its Docs and Form tabs.
- `{ keys: ['<A-S-i>'], expect: '[sessions] nothing shown in Codex session', checksFit: true }` becomes
  `{ keys: ['<A-S-i>'], expect: '[docs] session index: No project folder is known for this session', checksFit: true }`:
  the third session (Codex, no folder) now shows its Docs tab, whose first show runs the session source, and 06's rule
  gives that message. It proves the no-folder path end to end. The next step (`<A-S-o>` → `activated selftest`) and
  the review steps stay: the Form tab's `shown()` sets `forms.forms` again.
- Forms' `SCROLLS_ITSELF` gains `'.docs-row-title'`, `'.docs-path'`, `'.docs-status'`: both steps above check fit
  with a Docs tab shown.
- The comment above forms' `STEPS` names these changes.

## GIVEN / WHEN / THEN

- GIVEN the self-test's temp home holds the docs fixture WHEN `npm run selftest` runs THEN the docs script's every
  step passes and `docs result as expected` is reported, with no file outside the temp home read or written by docs.

## Tests

The self-test itself; no Vitest test.

## Done when

`npm run selftest` passes (`[selftest] all passed`), each docs step reported `PASS`, and forms' and chat's scripts
still pass in the same run.

## Commit

One commit for the group: "Self-test: the docs plugin's own script — docs mode, links, the editor, create, rename,
completion, context and the session Docs tab — and forms' steps over the Docs tabs".

## Proof

