# 01 — Per-platform chord matching

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/platform.ts` · `src/shared/platform.ts` · test `src/shared/platform.test.ts`
- modify `src/shared/chord-notation.ts` · test `src/shared/chord-notation.test.ts`
- modify `src/renderer/key-sequences.ts` · test `src/renderer/key-sequences.test.ts`
- modify `src/renderer/page-keys.ts` · test `src/renderer/page-keys.test.ts`
- modify `src/renderer/renderer.ts` (the `installPageKeys` call)
- modify `src/shared/key-hints.ts` (`VIM_TOKEN`) · test `src/shared/key-hints.test.ts`
- test `src/shared/key-notation.test.ts` (`key-notation.ts` reads chords through `parseChord` and needs no edit)
- test `src/shared/keymap-checks.test.ts` (`keymap-checks.ts` reads `CHORD_NOTATION_RULE` and `parseChord` and needs no edit)
- modify `src/main/drive/page-driver.ts` · test `src/main/drive/page-driver.test.ts`
- modify `src/plugins/settings/page/leader-menu-view.ts` (`CHORD_NOTE`) · test `src/plugins/settings/page/leader-menu-view.test.ts`
- modify `src/plugins/forms/main/selftest-script.ts` (one keymap constant, `USER_KEYMAP_STEPS`, the "user keymap" section's `why`)
- create `src/shared/page/chord-press.ts` (`isChordPress`) · test `src/shared/page/chord-press.test.ts`
- modify `src/shared/page/text-box.ts` · `src/renderer/fabric/fabric-markup-editor.ts` (their `isChord` guards)
- modify comments only: `src/contracts/keymap.ts` (the `PageBind` comment) ·
  `src/renderer/codemirror-vim/prefix-completion.ts` (line 124's comment)
- modify `docs/keymap.md` · `AGENTS.md` · `docs/features/intent-alignment/master-plan.md` · `docs/features/followups.md`

Consumes: none.

Produces:
- `src/contracts/platform.ts`, verbatim from plan.md File Structure:
  ```ts
  export interface PlatformKeys {
    // An Option (Alt) chord matches the physical key, since Option changes the typed character.
    readonly optionMatchesByCode: boolean;
    // A press with AltGr down types a character and is never a chord.
    readonly altGraphTypes: boolean;
  }
  ```
  and `Platform` gains `readonly keys: PlatformKeys;`.
- `src/shared/platform.ts`: `createMacPlatform` sets `keys: { optionMatchesByCode: true, altGraphTypes: false }`;
  `createWindowsPlatform` and `createLinuxPlatform` set `keys: { optionMatchesByCode: false, altGraphTypes: true }`.
  `platformRecord` takes the `keys` record as a parameter beside `lifecycle`.
- `src/shared/chord-notation.ts`:
  - `export interface Chord` keeps its five fields. Its doc comment changes: `key` is the `KeyboardEvent.key` value
    the chord's key types or names.
  - `export const CHORD_NOTATION_RULE` with the new text (Pinned values).
  - `export function parseChord(token: string): Chord | null`, widened to the notation below.
  - `export function chordToken(chord: Chord): string | null` (new): the token that `parseChord` reads back as
    `chord`, or null when no token writes it.
  - `isChordToken` is unchanged.
- `src/renderer/key-sequences.ts`:
  ```ts
  // The parts of a key event a chord matches on, as plain data.
  export interface ChordPress {
    key: string;
    code: string;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    altGraph: boolean;
  }
  export function createChordMatcher(binds: PageBind[], keys: PlatformKeys): ChordMatcher;
  export function chordTokenFor(press: ChordPress, keys: PlatformKeys): string | null;
  ```
  `ChordMatcher.match(press: ChordPress, scope: ViewScope): PageBind | undefined` keeps its signature. The old
  `Pick<KeyboardEvent, …>` alias goes.
- `src/renderer/page-keys.ts`:
  - `export function capturedKeys(press: ChordPress, keys: PlatformKeys): string | null`. `CapturedPress` is removed;
    its callers and tests use `ChordPress`.
  - `feedChordKey` keeps its signature (`press: ChordPress` is now the new interface).
  - `installPageKeys(timeoutMs, currentScope, editors, commands, log, timers, boxFocus, platformKeys: PlatformKeys)`:
    one new last parameter.
- `src/renderer/renderer.ts`: the `installPageKeys` call passes `config.platform.keys` as the last argument.

Decisions (source: plan.md Decisions, "Chord notation", "Chord matching", "AltGr"; "Key code reads `platform.keys`
flags, never `os === …`"):

1. **One parser.** `parseChord` is the only reader of the page chord notation. `key-notation.ts`, `key-hints.ts`
   (`formatChord`), `keymap-checks.ts`, `page-driver.ts`, `leader-menu-view.ts` and the matcher call it and keep no
   own list of chord keys. Key code reads `PlatformKeys` flags. No key file reads `platform.os` to decide a match.
2. **Notation.** A token is `<`, then the modifiers `C-`, `A-`, `S-`, `D-` in that order, each at most once, then
   one key, then `>`. Names are case-exact (`<C-space>`, `<D-enter>`, `<C-up>` are not chords). The key forms:

   | Key written | `Chord.key` | Modifiers it needs |
   |---|---|---|
   | one lowercase letter `a`–`z` | the letter | at least one of `C-`, `A-`, `D-`; `S-` may join |
   | one digit `0`–`9`, or one character of the symbol list below | the character | at least one of `C-`, `A-`, `D-`; `S-` is rejected |
   | `lt`, `Bslash`, `Bar`, `Space` | `<`, `\`, `\|`, `' '` | as a symbol |
   | `Enter` | `Enter` | one of `C-`, `A-`, `D-`, or `S-` alone |
   | `Tab` | `Tab` | any, or none |
   | `F1`–`F12` | `F1`–`F12` | any, or none |
   | `Up`, `Down`, `Left`, `Right` | `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` | at least one of `C-`, `A-`, `D-`; `S-` may join |
   | `Home`, `End`, `PageUp`, `PageDown` | the same name | as the arrows |
   | `BS`, `Del` | `Backspace`, `Delete` | as the arrows |

   The symbol list (29 characters, written raw): ``! " # $ % & ' ( ) * + , - . / : ; = > ? @ [ ] ^ _ ` { } ~``.
   Every other character is rejected: a capital letter (`<C-H>`; write `<C-S-h>`), raw `<`, `\`, `|` or space
   (write `lt`, `Bslash`, `Bar`, `Space`), and any character outside ASCII (`<C-é>`), since a non-Latin key
   matches by its physical key (decision 4).
   A symbol or digit is written by the character it types, so Shift is in the character: `<C-?>`, never
   `<C-S-/>`. `parseChord` returns `shift: false` for every symbol, digit and named symbol.
   The arrows and the four page keys need Ctrl, Alt or Cmd, because Shift alone on them extends a text selection,
   as Shift alone on a letter types a capital (agent decision, see the report).
3. **`chordToken`** spells a `Chord` back: modifiers in `C-A-S-D-` order, then the key as the table writes it
   (`<` as `lt`, `\` as `Bslash`, `|` as `Bar`, `' '` as `Space`, `ArrowUp` as `Up`, `Backspace` as `BS`,
   `Delete` as `Del`, every other key as `Chord.key`). It returns the token only when `parseChord` reads that token
   back as an equal `Chord`; else null.
4. **Matching (the algorithm; it changes behaviour, so it is written here).** The matcher turns a press into the
   `Chord` it names, then finds a bind whose parsed `Chord` is equal in all five fields and that fires in the scope.
   The press's `Chord` comes from these steps, in order:
   1. `press.altGraph && keys.altGraphTypes` → no chord (the press is typing).
   2. `press.key` is a named key of the table (`Enter`, `Tab`, `F1`–`F12`, `ArrowUp`, `ArrowDown`, `ArrowLeft`,
      `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `Backspace`, `Delete`) → `key` is `press.key`; `shift` is
      `press.shift`.
   3. `press.alt && keys.optionMatchesByCode` → by code (step 6).
   4. `press.key` is one Latin letter (`a`–`z`, `A`–`Z`) → `key` is the letter in lowercase; `shift` is
      `press.shift`.
   5. `press.key` is one digit, `' '`, or one of the 32 ASCII symbols (the 29 above plus `<`, `\`, `|`) → `key` is
      `press.key`; `shift` is `false` (Shift is in the character, and on AZERTY or a German layout the user holds
      Shift to type it).
   6. Otherwise, and for step 3: by code, through the US-layout table below. `KeyA`–`KeyZ` give the lowercase letter
      with `shift: press.shift`. Every other listed code gives its unshifted character when `press.shift` is false
      and its shifted character when it is true, with `shift: false`. A code outside the table → no chord.

      | code | unshifted | shifted |
      |---|---|---|
      | `Backquote` | `` ` `` | `~` |
      | `Digit1`…`Digit9`, `Digit0` | `1`…`9`, `0` | `!` `@` `#` `$` `%` `^` `&` `*` `(`, `)` |
      | `Minus` · `Equal` | `-` · `=` | `_` · `+` |
      | `BracketLeft` · `BracketRight` · `Backslash` | `[` · `]` · `\` | `{` · `}` · `\|` |
      | `Semicolon` · `Quote` | `;` · `'` | `:` · `"` |
      | `Comma` · `Period` · `Slash` | `,` · `.` · `/` | `<` · `>` · `?` |
      | `Space` | `' '` | `' '` |

   `ctrl`, `alt` and `meta` are always the press's own. `chordTokenFor(press, keys)` is
   `chordToken(<the press's Chord>)` when the steps give a chord, else null. The comment above `createChordMatcher`
   changes from "matches on the physical key … never on `KeyboardEvent.key`" to these steps in one sentence each.
5. **The event edge.** `page-keys.ts` builds a `ChordPress` from a `KeyboardEvent` in one private function:
   `key`, `code`, `ctrlKey`, `altKey`, `shiftKey`, `metaKey`, and `altGraph: event.getModifierState('AltGraph')`.
   Every keydown listener and `takeCapturedKey` pass that record on; `editors.takesChordKey(event)` keeps the event.
6. **AltGr is typing** where `platformKeys.altGraphTypes` is true: `isPageKey` takes the `ChordPress` and the
   flags, and returns true for an AltGr press that is not a bare modifier, so the typed character (`@`) feeds the
   page's sequence binds like any plain key, while the chord matcher runs no chord for it (step 4.1). A Ctrl+Alt
   press with `altGraph` false stays a chord.
7. **Capture.** `capturedKeys(press, keys)` returns null for a bare modifier (`Shift`, `Control`, `Alt`, `Meta`).
   It spells a chord through `chordTokenFor` when the press is not AltGr typing and holds Ctrl, Alt or Meta, or is
   Shift+Enter, Tab, or an `F1`–`F12` key. Every other press keeps today's spelling through `vimTokenForPageKey`
   (`T`, `<Space>`, `<lt>`, `@`), and null for a key with no name (`ArrowUp` alone, `Dead`).
8. **`VIM_TOKEN`** in `key-hints.ts` becomes `/<(?:[A-Za-z]-)+>>|<[^<>]+>|./gu`, so a vim-notation string reads
   `<C->>` as one token. `<C-w>>` still reads as `<C-w>` then `>`, and `<Leader>>` as `<Leader>` then `>`.
9. **The drive presses the new tokens.** `pressChord` sends `keyCode` from a chord-only map, then `chord.key`:
   `' '` → `Space`, `+` → `Plus`, `ArrowUp` → `Up`, `ArrowDown` → `Down`, `ArrowLeft` → `Left`,
   `ArrowRight` → `Right`. These are the names in Electron's accelerator key list, which `KeyboardInputEvent.keyCode`
   requires (electronjs.org, keyboard-shortcuts § Available key codes; KeyboardInputEvent § keyCode, read
   2026-11-09). `Backspace`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, `F1`–`F12`, `Enter`, `Tab`, letters,
   digits and symbols go as `chord.key`. A shifted symbol (`?`) goes without an added `shift`; Electron sets Shift
   for a shifted character. `KEY_CODES` for plain presses is unchanged.
10. **Leader menu.** `CHORD_NOTE` becomes the text in Pinned values, since `<Tab>` and `<F5>` are chords that the
    menu refuses and hold no Ctrl, Alt or Cmd.
11. **Popup keys stay.** `popupActionOf` (`src/renderer/codemirror-vim/prefix-completion.ts`) keeps matching
    Ctrl+N and Ctrl+P on `code`, and `takesChordKey`'s contract is unchanged: it reads the event, not the notation.
    Its line-124 comment ("The Ctrl forms read the physical key and exact modifiers, as the page's chords do") is
    reworded to say the popup keeps the physical key on purpose, since page chords no longer do.
12. **AltGr in text boxes too.** The two guards that keep typed keys away from the page — `textBoxInput`
    (`src/shared/page/text-box.ts:16`) and `keepTextKeysFromPage` (`fabric-markup-editor.ts:301`) — test
    `ctrlKey || altKey || metaKey` and let such a press reach the page. Both call one shared predicate,
    `isChordPress(event: KeyboardEvent): boolean` in `src/shared/page/chord-press.ts`: Ctrl, Alt or Meta down and
    `event.getModifierState('AltGraph')` false. An AltGr press in a text box is then stopped there as typing. The
    predicate needs no platform flag: Chromium reports AltGraph only where the layout has an AltGr key. Test: a table
    in `chord-press.test.ts` (Ctrl+Alt with AltGraph → false; Ctrl+Alt without → true; Meta → true; plain → false).
13. **"Latin letter" means ASCII.** Steps 4 and 5 accept only ASCII `a`–`z`/`A`–`Z`, digits and the ASCII
    symbols; every other typed character (`é`, `ö`, `ß`, Cyrillic) goes to the US code table at step 6. The
    `docs/keymap.md` and `AGENTS.md` lines say "not an ASCII letter, digit or symbol", not "non-Latin". Test: one
    `key-sequences.test.ts` matcher row, press `{ key: 'é', code: 'Digit2', ctrl }` runs `<C-2>`.
14. **Comments the notation makes untrue.** The `PageBind` comment in `src/contracts/keymap.ts` (lines 62–67: "one
    lowercase letter, one digit, `;`, `'`, or Enter … matched on the physical key") becomes one line pointing at
    `CHORD_NOTATION_RULE` in `src/shared/chord-notation.ts` and saying a chord matches the typed character.
15. **A Shift-digit bind becomes malformed.** `<C-S-1>` and `<A-S-;>` were valid and now make
    `requireWellFormedChords` refuse the whole `keymap.json`. No such bind is in the tree, and the user has no
    `~/.config/wigley-ai-gui/keymap.json` (plan.md Preconditions). `docs/keymap.md` gains one sentence: Shift is in
    the character (`<C-!>`, not `<C-S-1>`), and a keymap holding the old form is refused whole.
16. **Electron behaviour the matcher rests on** (outside claims, each run live in 07): `KeyboardEvent.key` is the
    shifted character under Ctrl, Alt and Cmd (Chromium's `key` reports the produced character with modifiers other
    than AltGr/Option applied as Shift only; checks 2 and 5); `sendInputEvent` with `keyCode: '?'` produces key `?`
    (check 5); `getModifierState('AltGraph')` on a Windows AltGr press is the user's check (07, wrap-up).

Pinned values:
- `CHORD_NOTATION_RULE` = `"write modifiers C-, A-, S-, D- in that order, then the key: a lowercase letter (S- allowed), a digit or a symbol written as the character it types (no S-; lt, Bslash, Bar, Space for <, \\, |, space), each with at least one of C-, A-, D-; Enter with one of C-, A-, D- or S- alone; Tab or F1 to F12 with any modifiers or none; Up, Down, Left, Right, Home, End, PageUp, PageDown, BS or Del with at least one of C-, A-, D-"` (the `\\` is one backslash in the string).
- `CHORD_NOTE` = `'A leader item is one key with no Ctrl, Alt or Cmd, and not Tab or F1 to F12'`.
- Self-test keymap constant `PUNCTUATION_CHORD_KEYMAP = JSON.stringify({ binds: [{ keys: '<C-/>', scope: 'any', command: 'keys.toggleHelp' }] })`.

GIVEN `<C-a>` bound and Windows keys WHEN AZERTY Ctrl+A is pressed (`key: 'a', code: 'KeyQ'`) THEN `<C-a>` runs and a
bound `<C-q>` does not.
GIVEN `<A-o>` bound and macOS keys WHEN Option+O is pressed (`key: 'ø', code: 'KeyO'`) THEN `<A-o>` runs.
GIVEN `<C-j>` bound WHEN Ctrl+J is pressed on a Cyrillic layout (`key: 'о'`, Cyrillic, `code: 'KeyJ'`) THEN `<C-j>` runs.
GIVEN `<C-A-q>` and `@` bound and Windows keys WHEN AltGr+Q types `@` (`ctrl`, `alt`, `altGraph` all true) THEN no
chord runs and the `@` bind runs.
GIVEN `<C-/>` bound WHEN Ctrl+/ is pressed on a German layout (`key: '/', code: 'Digit7', shift: true`) THEN `<C-/>`
runs.
GIVEN the user's `keymap.json` binds `<C-/>` to `keys.toggleHelp` WHEN the self-test presses `<C-/>` THEN the log
reads `[page] <C-/> ran keys.toggleHelp`.

Tests (rows go into the test that owns each rule; `wigley:make` owns when they run):
- `src/shared/platform.test.ts` — a new `it.each` over `macos`, `windows`, `linux` in `describe('platformFor')`:
  `platformFor(os, INPUTS).keys` equals `{ optionMatchesByCode: true, altGraphTypes: false }` for `macos` and
  `{ optionMatchesByCode: false, altGraphTypes: true }` for `windows` and `linux`.
- `src/shared/chord-notation.test.ts`:
  - a new accept table (`token`, expected `Chord`): `<C-/>` → `ctrl`, key `/` · `<C-,>` → `,` · `<C-?>` → `?` ·
    `<C->>` → `>` · `<C-lt>` → `<` · `<C-Bslash>` → `\` · `<C-Bar>` → `|` · `<C-Space>` → `' '` · `<F5>` → no
    modifiers, `F5` · `<S-F12>` → `shift`, `F12` · `<C-F1>` → `ctrl`, `F1` · `<A-Up>` → `alt`, `ArrowUp` ·
    `<C-S-Down>` → `ctrl`, `shift`, `ArrowDown` · `<D-Left>` · `<A-Right>` · `<C-Home>` · `<C-End>` · `<C-PageUp>` ·
    `<C-PageDown>` · `<D-BS>` → `meta`, `Backspace` · `<C-Del>` → `ctrl`, `Delete`. Every row's other flags are false.
  - the reject table `'rejects %s'` drops `<C-,>` and `<C-F1>` and gains `<C-S-/>`, `<C-S-1>`, `<S-/>`, `<C-<>`,
    `<C-\>`, `<C-|>`, `<C- >`, `<C-é>`, `<Up>`, `<S-Up>`, `<C-up>`, `<C-space>`, `<C-F13>`, `<F0>`, `<C-Insert>`.
  - a new `chordToken` table: each accept-table token, and `<C-A-S-D-h>`, `<S-Enter>`, `<Tab>`, `<S-Tab>`, gives
    back the same token from `chordToken(parseChord(token)!)`; `chordToken({ ctrl: true, alt: false, shift: true,
    meta: false, key: '/' })` is null; `chordToken({ ctrl: false, alt: false, shift: false, meta: false, key: 'h' })`
    is null.
- `src/renderer/key-sequences.test.ts`:
  - the `press` helper becomes `press(key, code, held)` returning a `ChordPress` with every flag false but `held`;
    the existing rows pass the letter, digit or name the code types (`press('o', 'KeyO', { alt: true })`).
  - two literals `MAC_KEYS = { optionMatchesByCode: true, altGraphTypes: false }` and
    `PC_KEYS = { optionMatchesByCode: false, altGraphTypes: true }`; the existing rows build with `MAC_KEYS`.
  - the row "matches a digit chord on its top-row code" changes: `press('1', 'Numpad1', { ctrl: true })` now runs
    `<C-1>`, since the typed character is `1`.
  - a new table `it.each` (`case`, `keys`, `bind`, `press`, `runs`): AZERTY `PC_KEYS` `<C-a>` `('a','KeyQ',ctrl)` true ·
    AZERTY `PC_KEYS` `<C-q>` `('a','KeyQ',ctrl)` false · Dvorak `PC_KEYS` `<C-o>` `('o','KeyS',ctrl)` true ·
    mac Option `MAC_KEYS` `<A-o>` `('ø','KeyO',alt)` true · mac Option+Shift `MAC_KEYS` `<A-S-o>`
    `('Ø','KeyO',alt,shift)` true · mac Option symbol `MAC_KEYS` `<A-/>` `('÷','Slash',alt)` true · Cyrillic
    `PC_KEYS` `<C-j>` `('о','KeyJ',ctrl)` true · US `PC_KEYS` `<C-/>` `('/','Slash',ctrl)` true · German `PC_KEYS`
    `<C-/>` `('/','Digit7',ctrl,shift)` true · `PC_KEYS` `<C-?>` `('?','Slash',ctrl,shift)` true · `PC_KEYS` `<F5>`
    `('F5','F5')` true · `PC_KEYS` `<F5>` `('F5','F5',ctrl)` false · `MAC_KEYS` `<A-Up>` `('ArrowUp','ArrowUp',alt)`
    true · `PC_KEYS` `<C-lt>` `('<','Comma',ctrl,shift)` true · AltGr `PC_KEYS` `<C-A-q>`
    `('@','KeyQ',ctrl,alt,altGraph)` false · Ctrl+Alt `PC_KEYS` `<C-A-q>` `('q','KeyQ',ctrl,alt)` true.
  - the malformed-chord table drops `<C-,>` and `<C-F1>` and gains `<C-S-/>` and `<Up>`.
- `src/renderer/page-keys.test.ts`:
  - `feedChordKey`'s `ctrl(code)` helper builds a `ChordPress` (`ctrl(key, code)`); its matchers take `MAC_KEYS`.
  - `capturedKeys` with `MAC_KEYS`: `CHORD_ROWS` row `';' 'Semicolon' ALL_MODIFIERS` → `'<C-A-S-D-;>'` becomes
    `':' 'Semicolon' ALL_MODIFIERS` → `'<C-A-D-:>'`; `CHORD_ROWS` gains `('/','Slash',ctrl)` → `'<C-/>'`,
    `('?','Slash',ctrl,shift)` → `'<C-?>'`, `('<','Comma',ctrl,shift)` → `'<C-lt>'`, `(' ','Space',ctrl)` →
    `'<C-Space>'`, `('ArrowUp','ArrowUp',alt)` → `'<A-Up>'`, `('Backspace','Backspace',meta)` → `'<D-BS>'`,
    `('F5','F5')` → `'<F5>'`, `('[','BracketLeft',ctrl)` → `'<C-[>'`. The `F5` and `[` rows leave the null rows;
    `ArrowUp` alone, `Dead`/`Backquote`, `Shift` and `Meta` stay null. `capturedKeys_Chord_MatchesTheChordBindItSpells`
    runs over the grown `CHORD_ROWS` with `MAC_KEYS`.
  - new `capturedKeys_AltGrTyping_SpellsTheCharacter`: `('@','KeyQ',ctrl,alt,altGraph)` with `PC_KEYS` → `'@'`.
  - `installPageKeys`: `installed()` takes the platform keys (default `MAC_KEYS`) and passes them as the last
    argument; its fake event gains `getModifierState: (name: string) => name === 'AltGraph' && altGraph`, with
    `altGraph` a field of the press options (default false). New `keydown_AltGrTyping_RunsTheCharacterBindNotTheChord`:
    `PC_KEYS`, binds `<C-A-q>` → `p.chord` and `['@']` → `p.at` in scope `any`, press `'@'` with code `KeyQ`, ctrl,
    alt, altGraph → `runs` holds `p.at` alone. New `keydown_CtrlAltWithoutAltGr_RunsTheChord`: same binds, press `'q'`
    with code `KeyQ`, ctrl, alt → `runs` holds `p.chord` alone.
- `src/shared/key-hints.test.ts`: lines 53 and 64 change `<C-A-S-D-1>` to `<C-A-S-D-h>`, printed `⌃⌥⇧⌘H` and
  `Ctrl+Alt+Shift+Win+H` (a Shift-digit chord is now malformed, Decision 2); `formatChord` macOS rows gain `<C-/>` → `⌃/`, `<C-lt>` → `⌃<`, `<C-Space>` →
  `⌃Space`, `<A-Up>` → `⌥↑`, `<F5>` → `F5`, `<D-BS>` → `⌘⌫`; Windows rows gain `<C-/>` → `Ctrl+/`, `<A-Up>` →
  `Alt+Up`, `<C-PageUp>` → `Ctrl+PageUp`, `<F5>` → `F5`. `vimTokens` gains `vimTokens('<C->>x', '<Space>')` →
  `['<C->>', 'x']` and `vimTokens('<C-w>>', '<Space>')` → `['<C-w>', '>']`.
- `src/shared/key-notation.test.ts`: "keeps chords and single characters as written" adds `<C-/><F5><C-lt>` →
  `'<C-/>', '<F5>', '<C-lt>'`; the throw test changes from `<F5>` to `<Insert>`
  (`'<Insert> is not a key the page can bind.'`); `isChordKeys` gains `<F5>` true, `<C-/>` true, `<A-Up>` true,
  `<Up>` false.
- `src/shared/keymap-checks.test.ts`: `requireWellFormedChords` gains one row: `<C-S-/>` throws
  `CHORD_NOTATION_RULE`.
- `src/main/drive/page-driver.test.ts` `describe('press')`: new table `press_NewChordTokens_SendsElectronKeyCodes`:
  `<C-/>` → keyDown and keyUp `keyCode: '/'`, `modifiers: ['control']` · `<C-?>` → `'?'`, `['control']` ·
  `<C-Space>` → `'Space'` · `<C-+>` → `'Plus'` · `<A-Up>` → `'Up'`, `['alt']` · `<F5>` → `'F5'`, `[]` ·
  `<C-lt>` → `'<'`, `['control']` · `<D-BS>` → `'Backspace'`, `['meta']`; no `char` input in any row.
- `src/plugins/settings/page/leader-menu-view.test.ts`: the `chord` row's note becomes the new `CHORD_NOTE`; a new row
  `case: 'F-key chord'`, keys `<F5>`, expects `refused` with the new `CHORD_NOTE` and reason `chord`.
- Self-test (`src/plugins/forms/main/selftest-script.ts`): `PUNCTUATION_CHORD_KEYMAP` sits beside
  `COMMA_LEADER_KEYMAP`. `USER_KEYMAP_STEPS` ends with four new steps after its last step
  (`{ keys: ['Escape'], expect: '[forms] left the box' }`):
  `writeFile { path: USER_KEYMAP_FILE, text: PUNCTUATION_CHORD_KEYMAP }`, keys `[]`, expect
  `'[config] applied a new config'` · keys `['<C-/>']`, expect `'[page] <C-/> ran keys.toggleHelp'` · keys
  `['Escape']`, expect `'[page] Escape ran keys.closeHelp'` · `writeFile { path: USER_KEYMAP_FILE, text: '{}' }`,
  keys `[]`, expect `'[config] applied a new config'`. The "user keymap" section's `why` adds that a punctuation
  chord (`<C-/>`) binds and fires.

Docs (in this task's commit; the facts to state, not finished text):
- `AGENTS.md` § Architecture, the **A key** bullet, the sentence "its key is a lowercase letter, a digit, `;`, `'`,
  Enter or Tab … matched on the physical key, since macOS turns Option+o into `ø`": a chord's key is a lowercase
  letter, a digit or symbol written as the character it types (`<C-/>`, `<C-?>`), vim's names `lt`, `Bslash`, `Bar`,
  `Space`, Enter, Tab, F1–F12 (alone too), or an arrow, Home, End, PageUp, PageDown, BS, Del with Ctrl, Alt or Cmd;
  a chord matches the typed character, and the physical key for an Option chord where `platform.keys` says so
  (macOS) and for a key that types no Latin letter, digit or ASCII symbol; an AltGr press is typing where
  `platform.keys` says so (Windows, Linux). Name `CHORD_NOTATION_RULE` in `src/shared/chord-notation.ts` as the
  rule's home.
- `docs/keymap.md`, the vim-notation bullet (the one with `<Leader>ks`, `gg`, `<A-o>`, `<Esc>`): add the keys a chord
  may hold and the typed-character match, in one sentence, pointing at the `AGENTS.md` **A key** bullet for the
  full rule.
- `docs/keymap.md`, the **Cmd** bullet: keep `Cmd+,` as the app menu accelerator `CommandOrControl+,`. Replace the
  reason "since a page chord cannot hold `,`" with the true one: `Cmd+,` is the Settings item of the app menu, the
  macOS place for it, so it works through the menu. Keep the `Ctrl+,` on Windows and `Win+,` sentences.
- `docs/features/intent-alignment/master-plan.md` § Lane P: `- [ ] Per-platform chord matching [ready]` becomes
  `- [x] Per-platform chord matching [ready]`.
- `docs/features/followups.md` § Platform and packaging: remove the `**Per-platform chord matching**` entry (three
  lines, from `- **Per-platform chord matching**` through "allow non-letter chords (`<C-/>`, `<F5>`).").

Done when: `npm run typecheck` and `npm run lint` pass; the tests above pass in the test gate; a
`grep -rn "ctrlKey\|altKey\|shiftKey\|metaKey" src/renderer/key-sequences.ts` finds none; a
`grep -n "keys:" src/shared/platform.ts` finds the three records; live checks: 07 — Final verification.

Commit: one commit for the task, holding the code, the tests, the self-test steps and the four doc edits above.

## Proof

