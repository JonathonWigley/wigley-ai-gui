# 16 — Final verification

Status: done
Type: Task
Wave: 8 · Depends on: 15
Plan: [plan.md](plan.md)

Files:     none, unless a check fails (a fix then goes in its own commit, and the failed check runs again)
Consumes:  every task
Produces:  the live checks below, each recorded in the Run log's Test gate with its result

Gate first:

- `npm run typecheck`, `npm run lint` and the tests every task added or edited, by name.
- `npm run selftest -- --plugin <id>` for each plugin whose script the plan changed or whose page part it changed:
  sessions, chat (it holds visual's `v` step, which task 06 changed, so visual needs no run of its own: visual has no
  self-test script), docs, settings, and `selftest-user` (task 14's core script). The whole self-test runs only
  when the user asks for it in the current turn.

Live checks, through a drive run (`.agents/skills/drive/SKILL.md`), each on the run's own temp home. Each check is
tagged expected (the change doing what it was made for) or low-confidence (a bug is likely: wiring no test sees).

Fixture rules for every check: the agent writes each fixture file into the run home's
`.config/wigley-ai-gui/plugins/<id>/` with its own file tools, as an outside editor would. Every command key and scope
key in a fixture manifest matches `SHORT_ID_PATTERN` (`^[A-Za-z][A-Za-z0-9]*$`), and no fixture scope is named `any`.
A key bind for a fixture command goes in the run home's `keymap.json`. Where a check waits on a reload's end, it
waits on `[plugin-switch] reloaded <id>`. A reload that fails logs
`reload of <id> failed: <message>; the last good version runs` or
`reload of <id> failed: <message>; the last good version failed too: <second message>` instead (task 10).

1. **Main bundle keeps the import** (low-confidence: the CJS bundle may rewrite a dynamic import, and task 01's proof
   ran before every other task landed). Start the dev app. The bundled `.vite/build/main.cjs` holds the real
   `import(` that `importModuleFrom` makes, and a fixture user plugin's main part logs its start.
2. **Load at start** (expected). Write a fixture user plugin with a main and a page part into the run home's config
   folder before start. Both parts start; its command runs from a drive `command` call; its Settings row shows the
   `user` origin. Then, while the app runs, write a second fixture plugin folder (a main and a page part, with a
   setting, and `dependsOn.page` naming the first fixture). It loads with no restart: its page part starts, it reads
   its setting with no `has a page part but main served no settings` line, and its row shows `user`.
3. **Reload on save** (expected). Change the plugin's `page.js` and a module `main.js` imports by a relative path.
   Both new versions run: the page logs the new line, and main logs the new relative module's line. The plugin's
   dependents (give the fixture one dependent fixture plugin) stopped and started again, in the order plan.md's
   Design Overview gives.
4. **Reload keeps work and place** (low-confidence: the restore window per live start is new wiring). Restart
   `sessions` and `chat` with the `core.restartPlugin` drive action while a session has a draft and a selected tab.
   The draft and the selected tab come back. The shown mode before the restart is the shown mode after it (not
   Gallery).
5. **No key without a handler during a restart** (low-confidence). The drive runs one command at a time, and only
   `quit` skips the queue, so a `do core.restartPlugin` would hold the queue and no `key` could run during it. So the
   restart comes from a save, which the watcher handles outside the drive queue:
   - Fixture: the check-2 fixture's `page.js` returns a `dispose` that logs `dispose begins <Date.now()>`, waits
     5000 ms, then logs `dispose ends <Date.now()>`. `keymap.json` binds its page command `hello` to `Space z u`.
   - Save a changed `page.js` (a new log text). Right after the save, run `key Space z u`, then
     `eval "Date.now()"`, then `wait-log` for the new `page started` line.
   - The check is valid when the `key` reply holds no line of the old handler and the `eval` time is before
     `dispose ends`: the key then fell inside the paused stop. Else run it again with a longer wait in `dispose`.
   - Pass: the `key` reply and `app.log` hold no `names no command` line (the text `runBound` logs for a bind with
     no handler) between `dispose begins` and the new `page started` line.
6. **Failed load keeps the last good version** (expected). Each case starts from a good, running fixture, and ends
   with a good save that clears the problem from the title bar and the row.
   - A `manifest.json` that fails a check: the last good version keeps running, the title bar shows the config
     problem `plugins/<id>: …`, and the Settings row shows the problem text with the `failed` Tag.
   - A `main.js` that throws on import: as above, with the row's problem from the catalog.
   - A `page.js` with a syntax error: the log holds `[plugin-switch] reloaded <id>` (main's part ran), the old page
     part runs again after the reload, and the row shows `page.js of <id> failed to load: <error>` (the `reload` reply's
     `problem`, task 11).
   - A `page.js` whose `start` throws `boom`: the row shows `Page part did not start: boom` (the `start` reply's
     `problems`, task 11).
   - A manifest that declares a page command `bye` that `page.js` returns no handler for: the row shows
     `Page part did not start: <id>: missing bye`, and `command <id>.bye` finds no handler.
   - A fixture written before start whose `page.js` has a syntax error: after launch, the row shows
     `page.js of <id> failed to load: <error>` (main's launch job's page `start` reply).
7. **Replace a built-in** (expected). Write a user plugin with the id task 14 picked. The built-in's parts stop; the
   user plugin's start; Settings shows `replaces built-in`. Delete the user plugin's folder: the built-in comes back.
8. **Delete a plugin** (expected). Delete the fixture plugin's folder. Its parts stop and its slots clear.
9. **Types written** (expected). `<config>/plugins/_types/` holds `plugin.d.ts`, `manifest.schema.json` and the
   contracts' `.d.ts`. A fixture `main.js` starts with `// @ts-check` and the three JSDoc `@import` lines task 07
   pins, and calls `api.dependency` with chat's `ChatMainExports` type. Run the repo's own compiler on the fixture's
   files, with the options of the repo's `tsconfig.json` that decide resolution:
   `<gui>/node_modules/.bin/tsc --noEmit --allowJs --checkJs --skipLibCheck --target esnext --module preserve --moduleResolution bundler <fixture>/main.js <fixture>/page.js`.
   - Pass: it exits 0.
   - Control: change one call in `main.js` to pass a number where the type wants a string. The same command exits
     non-zero and names that line. Without the control, a pass can mean the types were never read.
10. **Visual's overlay** (low-confidence: visual now finds the element from chat's slot). In a session whose entry
    holds a visual, press `v` on the focused entry. The overlay opens at the first visual in the cursor's block.
11. **A user plugin's default layout draws through its kit** (low-confidence: only the self-test's detached holder
    draws one, and task 11 changed the layout service's default folder and added the show's `draw`). Fixture
    `layout-fixture`, whose manifest declares a page command `hello` (`runsIn: 'page'`):
    - `main.js` calls `api.layouts.register` with layout types that import `BaseKit` from `'../kit'` and declare
      one part, `view?(parent: HTMLElement, input: { text: string }, kit: BaseKit): { element: HTMLElement }`.
    - `page.js` adds a mode through `api.modes.add` (id `view`, title `Layout fixture`, its own `element`), returns
      a `hello` handler, and calls `api.layouts.show` with: `defaultLayout` a fallback whose `view` returns
      `{ element: kit.el(parent, 'div', 'layout-fixture-view', 'fallback layout') }`; `defaultStylesheet: null`;
      `read` returning the module's `default` export (throwing when it has no `view` function);
      `userLayout: () => 'default'`; and `setLayouts` that disposes the last draw, empties the mode's element, and
      calls `show.draw('view', element, { text: 'drawn by the user layout' })`. It passes no scope, so the hint
      shows in every scope. After the first draw it calls the mode handle's `show()`.
    - `layouts/default/layout.js` exports a default object whose `view(parent, input, kit)` makes its root with
      `kit.el(parent, 'div', 'layout-fixture-view', input.text)` and puts `kit.keyHint(root, 'hello')` in it.
    - Pass, at start: `query .layout-fixture-view` returns the text `drawn by the user layout` with a non-zero box,
      and the element carries `data-layout="default"` and `data-layout-owner="layout-fixture"` (the marks `draw`
      sets). The key hint inside it shows the keys `keymap.json` binds to `layout-fixture.hello` (bind it in scope
      `any` to a `<Leader>z` key that no default uses, checked with `grep -n "<Leader>z" src/plugins/keymap.ts`), so
      the kit named the plugin's own command. A `screenshot layout-fixture` shows the view. The page logs no layout
      load error and no `layout default view failed` line.
    - Pass, on a save: change the layout's text in `layout.js`. The view redraws with the new text, and the log
      holds no `plugin layout-fixture loaded at revision` line (the layout reloads alone).
    - Pass, a default folder made after load (task 11's `makeFolder`): a second fixture `layout-late` with the same
      `main.js` and `page.js` and no `layouts/` folder starts and draws `fallback layout`. Then write its
      `layouts/default/layout.js`: the view redraws through it with no restart.
    - If the view draws `fallback layout` in `layout-fixture`, or the hint shows no keys, record a failed check:
      the kit did not reach the user's layout.

Checks only the user can make go in the wrap-up, with steps: none expected, since every check above runs offscreen.

Done when: the gate passes and each live check above is recorded as passed, or as failed with its fix landed and the
check passed again.
Commit:    none for the checks; a fix gets its own commit.

## Proof

Commit 61a0e287 · proof: gate: typecheck 0, lint 0, 42 changed test files pass after 58096b2d; selftest --plugin sessions/chat/docs/settings/selftest-user all passed. Live (drive): 1,2,3,5,6a-6f,7,8,9,10,11 pass; 6d/6e passed after fix 7927ccec; 4 passes 3 of 4 cases after 22796c7b and 61a0e287 — fails when Chat is selected and chat restarts (comes back on Docs). Reports 16-1.md, 16-2.md · concerns: check 4 Chat-selected + chat restart: chat main stop removes the session row, sessions deletes its saved place, frame dropped — fix is a design choice (open restore window at stop / keep removed row place until prune / main keeps rows through restart), to triage; check 9's spec tsc command fails TS5112 from repo root under TS 6 (ran outside repo / --ignoreConfig); selftest-user step 9 flaked once (zu racing reload unpause); check 11 one unexplained catalog restart on first late-layout write, not reproduced; sessions selftest shutdown logged docs watchDoc handler error (teardown race)
