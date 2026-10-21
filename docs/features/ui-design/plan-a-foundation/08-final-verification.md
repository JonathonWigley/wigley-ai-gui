# 08 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     none changed; a failure found here goes back to the task that owns the code, as a fix commit
Consumes:  the landed plan A tree and each task's **Proof** ← 01–07
Produces:  the run's proof: the four command results and the live-check list handed to the user
Decisions: the agent runs the four commands; the user runs every live check in a visible `npm start`, since
           that run takes the user's foreground (AGENTS.md § Running and testing) · each check is tagged
           **expected** (the change doing what it was made to do) or **low-confidence** (where a bug is likely:
           code with no test over it, wiring, layout), with its reason (`wigley:writing-tests` § What earns a
           live run instead) · no screenshot step: the self-test's screenshots arrive in plan B · split-width
           persistence is plan B's Split and is not checked here
Tests:     none new
Done when: `npm run typecheck`, `npm run lint`, `npm test` and `npm run selftest` each pass on the final
           commit (each run under `source ~/.nvm/nvm.sh && nvm use &&` when the shell's Node differs from
           `.nvmrc`); the live-check list below is handed to the user with its steps; the user's result for each
           check is recorded in Proof, and a failed check is fixed in the task that owns it and re-checked
Commit:    none, unless a fix lands (then one commit per fix, in the owning task's area)

## Commands

| Command | Passes when |
|---|---|
| `npm run typecheck` | exits 0 |
| `npm run lint` | exits 0: layer check (with `@vscode/codicons` under one layer), oxlint, oxfmt |
| `npm test` | exits 0, the plan's new tests among those run |
| `npm run selftest` | prints `[selftest] all passed`, task 04's steps (`[page] side bar hidden` / `shown`, `[page] marked Docs in the activity bar`) and the other tasks' steps among them |

## Live checks for the user

Before starting: back up and then remove `~/.config/wigley-ai-gui/` if it exists, so the run starts on the
defaults; start the app with `npm start`.

### Title bar, activity bar and side bars (task 04)

| # | Steps | Expected | Tag |
|---|---|---|---|
| 1 | Look at the window's top left on macOS | The three window buttons sit inside the title bar, vertically centred in it, clear of the activity bar's icons and any text | **low-confidence**: `hiddenInset`'s button position against the 40px `toolbar-height` and the `traffic-light-inset` padding is geometry no test sees |
| 2 | Drag the title bar by an empty spot, then by the centred context text; double-click it | The window moves both times; the double-click zooms it as macOS does | **low-confidence**: `-webkit-app-region` wiring, untested |
| 3 | Look at the activity bar | Two icons draw as glyphs (Sessions: a speech-bubble pair; Docs: a book), not empty boxes or letters | **low-confidence**: the Codicons font is bundled through Vite and loaded under the page's CSP, which no test loads |
| 4 | Hover each icon; press `Space k d`, then `Space k s` | Each tooltip names its mode; the shown mode's icon is `fg` with a 2px accent bar on its left edge, the other `fg-secondary`; the mark follows each key | **expected** |
| 5 | Click the Docs icon, then press `j` | Docs mode shows and is marked; `j` moves the tree (the click took no focus) | **low-confidence**: the click path and focus have no test |
| 6 | In Sessions mode press `Space k s` twice; switch to Docs and back with `Space k d`, `Space k s` | The session list hides, then shows beside the sheet; after the round trip it is as the user left it | **expected** |
| 7 | Narrow the window below 680px; press `Space k s`; widen it again | Narrow: the session list hides; the key lays it over the sheet's left edge, the sheet not shrinking; widening puts it back beside the sheet | **low-confidence**: the overlay's grid placement is CSS no test sees |
| 8 | Select a session row; switch to Docs mode, open a doc; open no doc in a fresh start of Docs mode | Sessions: the title bar centre shows the session's label with its folder after it in secondary text; Docs: the doc's path from `~/`; no doc: the centre is empty | **expected** |
| 9 | Windows only, if a Windows machine is at hand: start the app there; change `theme` (check 17) | The OS window buttons sit at the top right on the window background colour with secondary-text glyphs, the centre text clear of them; after the theme change the buttons follow its colours | **low-confidence**: `titleBarOverlay`, `env(titlebar-area-*)` and `setTitleBarOverlay` run only on Windows |

### Config hot reload and app state (tasks 01–03, 05)

| # | Steps | Expected | Tag |
|---|---|---|---|
| 10 | After the first start, look in `~/.config/wigley-ai-gui/` | The folder exists and is empty: the app created it and wrote no file | **expected** |
| 11 | Create `~/.config/wigley-ai-gui/settings.json` holding `{ "fonts": { "uiSize": 16, "monoSize": 16 } }`; save; then change both to `12`; then set `"ui": "Georgia", "mono": "Courier New"` | With no restart and no work lost (an open doc and a chat stay): UI text and the docs editor's and a code block's text grow, then shrink; then the UI turns serif and the editor and code blocks Courier | **low-confidence**: the font tokens reach body text through `index.css` and the editors through `editor-theme.ts`, two renamed paths no test reads |
| 12 | Create `~/.config/wigley-ai-gui/keymap.json` holding `{ "unbind": [{ "page": [" ", "k", "d"], "scope": "any" }] }`; save; press `Space k d`; open help with `Space ?`; then delete the file | While the file exists, on the page `Space k d` does nothing and help's page section drops it (the editor section keeps `<Leader>kd`); after deleting, `Space k d` shows Docs mode again and help lists it | **expected** |
| 13 | Open help (`Space ?`); then set keymap.json to `{ "page": [{ "keys": ["<S-D-k>"], "scope": "any", "command": "keys.toggleHelp" }] }` and press `⇧⌘K` | Help prints sessions' next tab as `⌥O` and chat's send as `⌘↩`; after the save help lists `⇧⌘K`, which toggles it | **expected** |
| 14 | Set keymap.json to `{ "unbind": [{ "global": "Control+Alt+Command+W" }], "global": [{ "accelerator": "Control+Alt+Command+S", "command": "window.summon" }], "app": [{ "accelerator": "Command+Shift+9", "command": "window.summon" }] }`; hide the window; press `⌃⌥⌘W`, then `⌃⌥⌘S` | `⌃⌥⌘W` does nothing; `⌃⌥⌘S` brings the window back; the app menu lists "show the app" on `⇧⌘9` | **low-confidence**: `registerGlobalShortcuts` and the menu rebuild re-run from a store change, main-side wiring no test drives |
| 15 | Set keymap.json to `{ "app": [{ "accelerator": "Command+Nope", "command": "window.summon" }] }` | The app keeps running with the previous menu and global shortcuts, every other bind still works, and the log shows `[config] keys not applied: <errorText>` (main builds the new menu and shortcuts in a try/catch); record whether Electron throws on the accelerator or accepts it | **low-confidence**: task 02 pins no check on accelerator syntax, so Electron's menu build meets it first |
| 16 | Set keymap.json to `{ "editor": { "leader": "," } }`; in a docs editor press `,` then a key help lists under the leader; then delete the file | The leader bind fires on `,`; after deleting, it fires on `Space` again in the open editor (the old leader `,` keeps no mapping until the next start) | **low-confidence**: `EditorHost.setKeymap` unmaps and remaps vim in live editors, which only `appliedMappings` is tested for |
| 17 | Create `~/.config/wigley-ai-gui/themes/my-mocha.json` holding `{ "name": "my-mocha", "extends": "catppuccin-mocha", "tokens": { "accent": "peach" } }`; set `"theme": "my-mocha"` in `settings.json`; then change the token to `"green"` in the theme file | The accent (activity mark, selected row edge, focus ring) turns peach, then green, each on save | **expected** |
| 18 | Break `settings.json` (delete its closing `}`); save; then fix it. Do the same to `my-mocha.json` | Each break shows one status bar item and a toast naming the file and the problem, and the app keeps the last good settings or theme; each fix clears the item and applies the file | **low-confidence**: the problem crosses main, the Bridge and the page's status item and toast, wiring no single test covers |
| 19 | With `"transparency": "system"` (the default), turn macOS System Settings → Accessibility → Display → Reduce transparency on, then off; then set `"transparency": "reduced"`, then `"full"` with the OS setting on | Under `system` the chrome turns opaque and back with the OS switch, with no restart; `reduced` keeps it opaque; `full` keeps it translucent despite the OS switch. Where no surface in plan A looks different, DevTools (View → Toggle Developer Tools) shows `data-transparency` on `<html>` changing the same way | **low-confidence**: Electron 44's support for `prefers-reduced-transparency` is unproven, and the OS query meets the setting in the `ThemeApplier`, which a test feeds but no test runs against the OS |
| 20 | Set `"window": { "width": 900, "height": 600 }` in settings.json; then `"claude": { "command": "claude-nope" }` and start a new session; then remove both and restart | The open window keeps its size until the next start, which opens at 900×600; an open session keeps running and the new one fails naming `claude-nope`; after removing, the next start and session are as before | **expected** |
| 21 | Windows only, if a Windows machine is at hand: open help | Help prints sessions' next tab as `Alt+O` and chat's send as `Win+Enter`, never mac glyphs | **low-confidence**: `formatChord`'s Windows row is unit-tested but no Windows run has drawn it |
| 22 | Quit; back up `~/Library/Application Support/wigley-ai-gui/ui-state.json` if it exists; write `{oops` into it; start; then restore the backup (or delete the file when there was none) | The app starts as usual; the page log holds `[ui-state] ui-state.json is not valid JSON, starting empty: …` | **low-confidence**: the lazy load on the first `uiStateRead` and its log line reaching the page are wiring no test covers |

### Window, code colours, icons and the token rename (tasks 01, 04, 06)

| # | Steps | Expected | Tag |
|---|---|---|---|
| 23 | Start the app and watch the window appear | It opens on the crust window background, with no white flash before the page draws | **low-confidence**: `window-background` reaches `BrowserWindow`'s `backgroundColor`, which only a start shows |
| 24 | In Docs mode open a markdown doc with a fenced code block (e.g. a `SKILL.md` with a `bash` block), then focus the doc (`<C-l>`) and press `i` to edit it | The rendered code block and the editor both show Catppuccin Mocha code colours (keywords mauve, strings green, comments grey) | **expected** |
| 25 | Walk every surface: Sessions with the forms preview round (`Space z l o`), a Chat tab, Docs mode, a session's Docs tab, which-key (`Space`, wait), help (`Space ?`), a toast, the status bar | Every element shows its text, borders and backgrounds — no black text on black, transparent panel or browser-default button; the look is the brief's Mocha values, with UI text at 13px (was 15) and editor text at 13px (was 14) | **low-confidence**: the token rename touched every stylesheet and no test reads CSS; a missed name renders as the property's initial value |
| 26 | In the forms preview round, look at a recommended choice, the recommend badge, the origin and severity badges, and which-key's command and prefix colours | The recommended choice and its badge are mauve (the accent); origin, severity and which-key colours are as before the plan | **expected** |
| 27 | Look at the side bar, title bar, status bar and activity bar over content | The translucent chrome reads clearly: no text lost against what lies behind, though nothing blurs (`backdrop-filter` arrives with plan B's material helpers) | **low-confidence**: Mocha's chrome alpha is chosen for a blurred backdrop, and plan A draws it unblurred |

## Next plan

When this task's checks pass, the agent ends its report by prompting the user to start plan B (primitives): run `/clear`, then `wigley:make` on `docs/features/ui-design/plan-b-primitives/`.

## Proof

