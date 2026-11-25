# 05 — xterm adapter and layer rules

Status: done
Type: Task
Rung: hard · adds the `TerminalEmulator` seam that 06 and 09 consume
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/contracts/terminal-emulator.ts` · create `src/renderer/xterm/xterm-emulator.ts` ·
           create `src/renderer/xterm/key-rule.ts` · create `src/renderer/xterm/key-rule.test.ts` ·
           modify `scripts/check-layers.mts`
Consumes:  the `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0 packages ← 01
Produces:
- `src/contracts/terminal-emulator.ts`: `TerminalPalette`, `TerminalScreenOptions`, `TerminalSize`, `TerminalScreen`,
  `TerminalEmulator`, word for word as plan.md § File Structure gives them, with the comments under Decisions.
- `export function createXtermEmulator(): TerminalEmulator` in `src/renderer/xterm/xterm-emulator.ts`.
- `export function passesToPage(key: string): boolean` in `src/renderer/xterm/key-rule.ts`. It returns `true` only
  for `'Escape'`. The file imports nothing.
- `scripts/check-layers.mts` `CORE_LAYERS`:
  - new entry `'src/renderer/xterm': { layers: ['src/contracts'], packages: ['@xterm/xterm', '@xterm/addon-fit'] }`,
    placed after the `'src/renderer/fzf'` entry (now at `scripts/check-layers.mts:742`).
  - `'src/renderer/renderer.ts'` (now at `:764`): its `layers` gain `'src/renderer/xterm'`, after `'src/renderer/fzf'`
    (now at `:772`).

Decisions:
- **Contract comments.** Write these comments on the contract members:
  - `TerminalScreen.element`: the screen's own element; the caller places it. The element stops the bubble of every
    keydown that is not Esc, and the shell never receives Esc.
  - `write`: writes shell output to the screen.
  - `onInput`: hears each piece of text the user types into the screen, to send to the shell.
  - `onResize`: hears the screen's new size each time its columns or rows change.
  - `size`: the screen's columns and rows now; 80 and 24 before its first fit.
  - `fit`: fits the columns and rows to the element's box; does nothing while the element is not in the page or has
    no width or height.
  - `focus`: fits, then moves keyboard focus into the screen.
  - `setPalette`: sets the colours and font, then fits.
  - `reset`: clears the screen and its scrollback, as a new shell needs.
  - `dispose`: removes the element and frees the screen; a second call does nothing.
- **One key rule.** `passesToPage` in `key-rule.ts` is the only place that names the key that passes. It sits in its
  own file so that `key-rule.test.ts` runs in vitest's `node` environment without an import of xterm. Both key
  handlers in `xterm-emulator.ts` call it:
  - `terminal.attachCustomKeyEventHandler((event) => !passesToPage(event.key))`. xterm then skips every Esc key
    event, so the shell never receives `\x1b`.
  - A bubble-phase `keydown` listener on `element` calls `event.stopPropagation()` when `!passesToPage(event.key)`.
    Esc has no chord modifier, so the page's capture-phase listener (`src/renderer/page-keys.ts`, the listener that
    ends `{ capture: true }` at `:337`) does not consume it. Esc bubbles on to the document's bubble-phase listener
    (`page-keys.ts:339`), which calls `feedPageKey` (`:146`). There `<Esc>` in scope `terminal.terminal` runs
    `terminal.back` (task 08).
  - The element listener is like `textBoxInput` (`src/shared/page/text-box.ts:16-20`), but stricter: `textBoxInput`
    lets Tab, Enter, Esc and every chord pass, and this listener lets only Esc pass.
- **Which keys reach the page.** The capture-phase listener consumes only a press that holds Control, Alt or Meta and
  matches a bind, before xterm sees it. So `<C-\`>`, Alt+j and Alt+k still fire with the screen focused. An unbound
  chord such as Ctrl+C reaches xterm and the shell. A plain key (Space, a letter, Enter, Tab) reaches the page only
  through the bubble-phase listener, which the element blocks. So a `<Leader>` sequence such as `Space b t` cannot
  start while the screen has focus. That is intended: Space goes to the shell. Task 09 tells users so in `docs/keymap.md`.
- **Fit.** The adapter fits by itself and also exposes `fit()`:
  - A `ResizeObserver` observes `element` from `create` on; each callback calls `fit()`. A drag of the drawer and a
    window resize therefore refit with no call from the plugin.
  - `fit()` returns at once while the stylesheet has not loaded (below), while `!element.isConnected`, while
    `element.clientWidth === 0` or while `element.clientHeight === 0` (a closed drawer or a hidden frame).
  - Otherwise, the first time, `fit()` opens the xterm instance: it calls `terminal.open(element)`, then the fit
    addon's `fit()`, then writes the pending output (below) to xterm and empties it. The fit comes before the write,
    so the output lays out at the real width.
  - After the open, `fit()` calls the fit addon's `fit()` only.
  - xterm opens late on purpose: `create` runs before the drawer is in the page, and xterm measures its cells when it
    opens.
- **Before the open, xterm gets no `write` and no `reset`.** The adapter holds a `pending` string per screen:
  - `write(data)` appends `data` to `pending` while xterm is not open, and calls `terminal.write(data)` after.
  - `reset()` sets `pending` to `''` while xterm is not open, and calls `terminal.reset()` after.
  - `size()` returns `{ cols: 80, rows: 24 }` while xterm is not open, and `{ cols: terminal.cols, rows:
    terminal.rows }` after.
  - Reason: the `@xterm/xterm` 6.0.0 typings do not say that `reset` or `write` is safe before `open`, and the package
    is not readable in this run. Task 09 can call `reset` on a drawer that is opened while every fit was skipped.
    With `pending`, the result is the same whatever xterm does before `open`.
- **Stylesheet.** `import xtermStylesheet from '@xterm/xterm/css/xterm.css?url'` (the package's `style` field is
  `css/xterm.css` and it has no `exports` map, checked with `npm view @xterm/xterm@6.0.0 style exports`). A
  module-level flag, as `renderer.ts:99` imports `layout.css?url` for its link, makes only the first `create` in a
  document append the `<link rel="stylesheet">` with that `href` to `document.head`.
  - The link loads after `create` returns. xterm measures its cells at `terminal.open`, and the measure needs the
    stylesheet. So no screen opens before the link has loaded.
  - The module keeps a `stylesheetReady` flag, `false` at first, and a set of live screens. `create` adds its screen to
    the set; `dispose` removes it.
  - The link's `load` event sets `stylesheetReady` to `true`, then calls `fit()` on every screen in the set. A screen
    that `shown()` fitted too early therefore opens at the right size, with no box change.
  - The link's `error` event does the same as `load`, so a missing stylesheet gives an unstyled screen and not a screen
    that never opens.
- **Element.** `create` makes a `div` with class `terminal-screen`. The adapter sets no inline style (`check-styles`
  rejects raw lengths); task 09 styles `.terminal-screen` to fill the drawer.
- **xterm options at create.** `fontFamily` and `fontSize` from the options; `theme` from the palette (mapping below);
  `cols: 80`, `rows: 24`; `scrollback: 5000`. Every other option keeps xterm's default. `create` calls
  `terminal.loadAddon(fitAddon)` before the open, as the `@xterm/addon-fit` README shows.
- **Palette mapping** (xterm `ITheme`, member names checked in `@xterm/xterm@6.0.0` `typings/xterm.d.ts`):
  `background` → `background`, `foreground` → `foreground`, `cursor` → `cursor`, `selection` → `selectionBackground`.
  `setPalette` assigns `terminal.options.theme`, `terminal.options.fontFamily` and `terminal.options.fontSize`, then
  calls `fit()`.
- **Events.** `onInput` wraps `terminal.onData`; `onResize` wraps `terminal.onResize` and passes `{ cols, rows }`.
  Each returns a `Disposable` whose `dispose` disposes xterm's own `IDisposable`.
- **`focus`** calls `fit()`, then `terminal.focus()` when xterm is open.
- **`dispose`** runs once. It disconnects the observer, removes the screen from the live set, calls
  `fitAddon.dispose()`, disposes the xterm instance and removes `element`. A second call returns at once. The adapter
  disposes the fit addon itself, so it does not depend on xterm to dispose a loaded addon.
- **Unchecked, settled live.** These xterm 6.0.0 behaviours are not checked in this run: an `onData` or `onResize`
  subscription made before `open` fires after it, and an `options` assignment before `open` takes effect at the open.
  Task 12 step 1 (the prompt `$ ` shows in the first drawer) and step 2 (`echo hi` reaches the shell on the first
  open) settle them. When one fails, the fix is in this adapter, not in its callers.
- **Layer rules.** This task owns only the `src/renderer/xterm` entry and the `renderer.ts` layers line, because it
  creates the files under `src/renderer/xterm` (plan.md § Layer rules). Task 04 adds the `src/session-host/node-pty`
  rule with the file it covers. Each rule lands in the commit of its file, so `check-layers` passes at every commit.

Pinned values:
- Class `terminal-screen` · `cols: 80` · `rows: 24` · `scrollback: 5000` · import specifier
  `@xterm/xterm/css/xterm.css?url` · key that passes: `'Escape'`, named only in `key-rule.ts`.

GIVEN a screen whose element is not in the page WHEN `fit()` runs THEN xterm is not opened and `size()` is
`{ cols: 80, rows: 24 }`
GIVEN a screen not yet opened WHEN `write('a')`, `reset()` and `write('b')` run, then the first fit opens it THEN the
screen shows `b` only
GIVEN a screen in the page before the stylesheet has loaded WHEN `fit()` runs THEN xterm is not opened; WHEN the link's
`load` event fires THEN the screen opens and fits its box
GIVEN a screen in a drawer WHEN the user presses Esc THEN the shell receives nothing and the keydown reaches the
page keys
GIVEN a screen in a drawer WHEN the user presses Enter, Tab, Space or a letter THEN the keydown does not reach the
page keys' bubble-phase listener
GIVEN `npm run lint` WHEN `src/renderer/xterm/xterm-emulator.ts` imports `@xterm/xterm` and `@xterm/addon-fit`
THEN `check-layers` reports no violation

Tests:
- `src/renderer/xterm/key-rule.test.ts`, one table test in the style of `src/renderer/fzf/fzf-matcher.test.ts`:
  `passesToPage_EachKey_PassesOnlyEscape`. It catches a key rule that lets a typed key reach the page keys, or that
  sends Esc to the shell. Rows: `'Escape'` → `true`; `'Enter'`, `'Tab'`, `' '`, `'a'` → `false`.
- No vitest test for `xterm-emulator.ts`. `vitest.config.mts` sets `environment: 'node'`, and the repo's fake DOM
  (`src/shared/page/test-dom.ts`) has no layout, canvas or `matchMedia`, which xterm needs to open and measure. A test
  against a mock of xterm would assert the mock. The live checks of the open, the fit and the keys go to task 12.
Done when: `npm run typecheck` passes; `node scripts/check-layers.mts` passes; `npm test -- src/renderer/xterm`
           passes; the contract, the factory and `passesToPage` exist as Produces gives them.
Commit:    one commit: "Add the TerminalEmulator contract, its xterm.js adapter and the Esc key rule, with the layer
           rule for the xterm adapter"

## Proof

Commit 373e8453 · proof: diff read: every Produces present (contract, createXtermEmulator, passesToPage, both layer entries); typecheck clean in its files; layers lint clean · concerns: whether a subscription or options change before xterm opens takes effect is left to the live session (task 12)
