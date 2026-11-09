# 01 — Key capture: `api.keys.captureKey`

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Re-read every file below before editing: the keyboard-reach plan lands first and may move lines. Members and banner
comments are named here; line numbers were measured at plan time, re-verify.

Files:     modify `src/contracts/plugin.ts` (the `PageApi` interface's `keys` member and the long comment above
           `PageApi` that documents each `keys.*` member) · modify `src/renderer/page-keys.ts` · modify
           `src/renderer/key-sequences.ts` · modify `src/renderer/plugins/page-api.ts` · modify
           `src/renderer/renderer.ts` (the `createPageApi(part.manifest, { … })` deps inside `startPlugins`) · modify
           `src/shared/plugin-part-harness.test-support.ts` (the fake page `keys`, `PageWorld`,
           `PagePartHarness`) · test `src/renderer/page-keys.test.ts` · test `src/renderer/plugins/page-api.test.ts`
Consumes:  nothing from this plan. Reads the tree's `installPageKeys`, `dropPendingKeys`, `createChordMatcher`,
           `ChordPress`, `NAMED_KEY_CODES` / `chordCode` (`key-sequences.ts`), `vimTokenForPageKey`
           (`src/shared/key-notation.ts`), `parseChord` (`src/shared/chord-notation.ts`), and `PendingKeysHub.cancel`
           (`src/renderer/pending-keys.ts`).
Produces:  `captureKey(onKey: (keys: string) => void, onCancel: () => void): Disposable` on `PageApi['keys']` in
           `src/contracts/plugin.ts` (plan.md File Structure, word for word)
           `export function capturedKeys(press: CapturedPress): string | null` and
           `export type CapturedPress = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>`
           in `src/renderer/page-keys.ts`
           `capture(onKey: (keys: string) => void, onCancel: () => void): Disposable` on `installPageKeys`'s return
           `export function chordTokenFor(press: ChordPress): string | null` in `src/renderer/key-sequences.ts`
           `keyCapture: { capture(onKey: (keys: string) => void, onCancel: () => void): Disposable }` on `PageApiDeps`
           in `src/renderer/plugins/page-api.ts`
           On `PagePartHarness` (for 04 and 05's tests): `pressCapture(keys: string): void` (runs the armed capture's
           `onKey`; throws `no key capture is armed` when none is), `cancelCapture(): void` (runs its `onCancel`; same
           throw), `isCapturing(): boolean`

## Decisions

- **How the engine reads a keydown today** (`page-keys.ts`): two `document` keydown listeners. The capture-phase one
  (`{ capture: true }`) first returns when `editors.takesChordKey(event)`, then feeds chords through
  `feedChordKey` → `createChordMatcher`, which matches the **physical key** (`event.code`) and the exact modifier
  flags, never `event.key`. The bubble-phase one drops pending keys when the target is inside an editor, skips
  non-page keys (`isPageKey`: a bare modifier, or any key holding Ctrl, Alt or Meta), and feeds `event.key` to the
  sequence matcher. A non-chord page key is a `KeyboardEvent.key` value; `vimTokenForPageKey` turns one into the
  bind spelling (`' '` → `<Space>`, `Enter` → `<CR>`, `Escape` → `<Esc>`, `Tab` → `<Tab>`, `Backspace` → `<BS>`,
  `<` → `<lt>`, `\` → `<Bslash>`, any other one character unchanged).
- **`capturedKeys(press)` spells the key exactly as a bind that fires on it is written** (one rule, one function):
  1. A press holding Ctrl, Alt or Meta is a chord: `chordTokenFor(press)`, the inverse of `chordCode`. It reads
     `press.code`: `KeyA`…`KeyZ` → the lowercase letter, `Digit0`…`Digit9` → the digit, `Semicolon` → `;`, `Quote`
     → `'`, `Enter` → `Enter`; modifiers written `C-`, `A-`, `S-`, `D-` in that order (`CHORD_NOTATION_RULE`).
     Any other code returns null. Read `NAMED_KEY_CODES` both ways rather than a second table.
  2. Shift with Enter and no other modifier is the chord `<S-Enter>` (the one Shift-only chord `parseChord` takes).
  3. Any other press is a page key: `event.key` of one character, or one of the named keys `vimTokenForPageKey`
     maps (`' '`, `Enter`, `Tab`, `Backspace`, `<`, `\`), spelled by `vimTokenForPageKey`. Shift is already in
     `event.key` (`T`, `:`); Shift+Tab is `<Tab>`, as the engine fires a `Tab` bind on it.
  4. Null for everything else: a bare modifier (`Shift`, `Control`, `Alt`, `Meta`, read with the existing
     `MODIFIER_KEYS`), and any other multi-character `event.key` (`ArrowUp`, `F5`, `Delete`, `Home`, `Dead`,
     `Process`, `Unidentified`). Null means "not a key a bind can take": the capture waits past it.
  `Escape` is never spelled: the capture handles it before calling `capturedKeys`.
- **macOS Option keys**: Option+o types `ø` in `event.key`, so a chord is read from `event.code` with `altKey`,
  never from `event.key`. A captured Option+o is `<A-o>`, Option+Shift+o is `<A-S-o>`, Option+' is `<A-'>`, Cmd+w is
  `<D-w>`, Ctrl+Option+Shift+Cmd+; is `<C-A-S-D-;>`. Every captured chord parses with `parseChord` and is matched by
  `createChordMatcher` for the same press (the round-trip test below pins this).
- **Where the capture sits, and how it beats the editor**: `installPageKeys` holds at most one armed capture. The
  check goes at the very top of the existing capture-phase `document` keydown listener, before
  `editors.takesChordKey`. A `document` capture-phase listener runs before every listener on the target: CodeMirror
  vim's `domEventHandlers.keydown` (`codemirror-vim-host.ts`, on the editor's own DOM) and `textBoxInput`'s
  listener (`src/shared/page/text-box.ts`, on the input). With a capture armed, every keydown except a null
  `capturedKeys` result gets `preventDefault()` (no character is typed into a box) and `stopPropagation()` (the
  editor, the text box and the engine's bubble-phase listener never see it), so a settings text box with focus,
  vim in insert mode, or an open completion popup cannot take the key. A null press (a bare modifier, an
  unspellable key) passes on untouched and the capture stays armed.
- **Esc** (`event.key === 'Escape'`, whatever modifiers are held) disarms and runs `onCancel`; it is consumed
  (`preventDefault` + `stopPropagation`) so it does not also leave the box or close the view.
- **Callbacks run after disarming**, so `onKey` or `onCancel` may arm a new capture at once (Settings' reassign
  re-arms to read Enter or Tab after the recorded key; 04 owns what `<CR>` and `<Tab>` mean to it). The capture
  hands `<CR>` and `<Tab>` to `onKey` like any key.
- **Arming a second capture** disarms the first and runs the first's `onCancel` before the second is armed.
  **Disposing** an armed capture disarms it with no callback; disposing one that already fired, was cancelled or
  was replaced does nothing.
- **Pending sequences**: the pending report lives in `createPendingKeys` (`src/renderer/pending-keys.ts`), whose
  `cancel` reaches whichever source holds keys: the page engine's `cancel` or the editor host's
  `cancelPendingKeys`. `api.keys.onPending` / `holdPending` / `cancelPending` are wired to it in `createPageApi`
  through `deps.pendingKeys`. So `captureKey` in `createPageApi` calls `deps.pendingKeys.cancel()` first (which-key
  hears `null` and closes; vim's pending leader input is dropped), then arms through `deps.keyCapture.capture`. The
  engine's `capture` itself does not touch the matcher: while armed it takes every key, so nothing new becomes
  pending.
- **Registration**: `createPageApi` files the returned handle with `track(...)`, so a stopped plugin's capture
  disarms with no callback.
- **Window blur and focus moves** leave an armed capture armed; the caller disposes it when its view moves on.
- **Out of reach**: a key main takes before the page never reaches the capture: the app menu's accelerators
  (`Cmd+,` → `settings.show` in `defaultKeymap.app`), and intercept and global binds. The Keybindings section leaves those
  to its advanced box (`docs/features/settings/design.md` § Scope). Say so in the contract comment.
- **Contract comment** in `plugin.ts` (the block above `PageApi` that lists every `keys.*` member) gains one entry:
  `keys.captureKey` hands the next key or chord pressed to `onKey` in the keymap's vim notation, as a bind's `keys`
  is written, ahead of every bind, a pending sequence and a text box; Esc runs `onCancel` and is never captured; a
  bare modifier or a key no bind can name is waited past; arming a second capture cancels the first; the handle's
  `dispose` disarms with no callback; keys main takes first (app menu accelerators, intercept and global binds)
  never reach it.
- **Harness fake** (`plugin-part-harness.test-support.ts`, the fake page `keys` object beside `holdPending() {}`):
  `captureKey` stores `{ onKey, onCancel }` on a new `PageWorld.capture` field (null when none), runs a replaced
  capture's `onCancel`, and returns a registered handle whose `dispose` clears it when it is still the armed one.
  `pressCapture` and `cancelCapture` clear the field before calling, as the engine does. Document the three members
  in the comment above `PagePartHarness`.

GIVEN a capture armed while focus sits in a CodeMirror box in insert mode WHEN the user presses Option+o THEN `onKey`
receives `<A-o>`, nothing is typed into the box, no chord bind on `<A-o>` runs, and the capture is disarmed
GIVEN a capture armed WHEN the user presses Shift, then Shift+t THEN `onKey` receives `T` once, after the second press
GIVEN `Space` pending (which-key open) WHEN a plugin calls `captureKey` THEN the pending sequence is cancelled first
and the next key goes to the capture, not to the sequence
GIVEN a capture armed WHEN the user presses Esc THEN `onCancel` runs, `onKey` does not, and Esc runs no bind

## Tests

In `src/renderer/page-keys.test.ts`:

- `describe('capturedKeys')`, `capturedKeys_Press_SpellsTheKeyAsABindIsWritten` — one table, `[press, keys]` rows:
  `{key:'t', code:'KeyT'}` → `t`; `{key:'T', code:'KeyT', shiftKey}` → `T`; `{key:':', code:'Semicolon', shiftKey}`
  → `:`; `{key:';', code:'Semicolon'}` → `;`; `{key:' ', code:'Space'}` → `<Space>`; `{key:'Enter', code:'Enter'}` →
  `<CR>`; `{key:'Tab', code:'Tab'}` → `<Tab>`; `{key:'Tab', code:'Tab', shiftKey}` → `<Tab>`;
  `{key:'Backspace', code:'Backspace'}` → `<BS>`; `{key:'<', code:'Comma', shiftKey}` → `<lt>`;
  `{key:'\\', code:'Backslash'}` → `<Bslash>`; `{key:'t', code:'KeyT', ctrlKey}` → `<C-t>`;
  `{key:'ø', code:'KeyO', altKey}` → `<A-o>`; `{key:'Ø', code:'KeyO', altKey, shiftKey}` → `<A-S-o>`;
  `{key:'w', code:'KeyW', metaKey}` → `<D-w>`; `{key:'æ', code:'Quote', altKey}` → `<A-'>`;
  `{key:'1', code:'Digit1', ctrlKey}` → `<C-1>`; all four modifiers on `Semicolon` → `<C-A-S-D-;>`;
  `{key:'Enter', code:'Enter', shiftKey}` → `<S-Enter>`; `{key:'Enter', code:'Enter', ctrlKey}` → `<C-Enter>`;
  `{key:'Dead', code:'KeyE', altKey}` (macOS Option+e) → `<A-e>`. Null rows: `{key:'Shift', code:'ShiftLeft',
  shiftKey}`, `{key:'Meta', code:'MetaLeft', metaKey}`, `{key:'ArrowUp', code:'ArrowUp'}`, `{key:'F5', code:'F5'}`,
  `{key:'Dead', code:'Backquote'}`, `{key:'[', code:'BracketLeft', ctrlKey}`.
- `capturedKeys_Chord_MatchesTheChordBindItSpells` — for each chord row above, `parseChord(captured)` is not null and
  `createChordMatcher([{ keys: [captured], scope: 'any', command: 'p.x' }]).match(press, 'any')` returns that bind.
  This pins the capture to the engine, so a change to one side fails here.
- In `describe('installPageKeys')`: extend `installed()`'s stub so `press` takes a partial `CapturedPress` (defaults
  `code: ''`, every modifier `false`), records `preventDefault` calls, and stops calling later listeners once a
  listener calls `stopPropagation`, as the browser does. Then:
  - `capture_Armed_TakesTheNextKeyAheadOfBindsAndRunsNothing` — binds `x` → `p.x` and `<C-x>` → `p.cx`; rows: press
    `x` → `onKey('x')`; press Ctrl+x → `onKey('<C-x>')`; each row: `runs` empty, default prevented, and a second
    press of the same key runs its bind (disarmed after one key).
  - `capture_ArmedOverAPendingSequence_TheKeyJoinsNoSequence` — binds `gg` → `p.top`; press `g`, arm, press `g`:
    `onKey('g')`, `runs` empty; then `g`, `g` runs `p.top` once.
  - `capture_NotAKey_WaitsForTheNext` — rows Shift alone, `ArrowUp`, Ctrl+`[`: each leaves `onKey` uncalled and the
    default not prevented; a following `t` reaches `onKey('t')`.
  - `capture_Escape_CancelsAndIsNotCaptured` — a bind `<Esc>` → `p.esc` exists; press Escape: `onCancel` once,
    `onKey` never, `runs` empty, default prevented.
  - `capture_ArmedAgain_CancelsTheFirst` — arm A, arm B, press `t`: A's `onCancel` once, A's `onKey` never,
    B's `onKey('t')`.
  - `capture_Disposed_DisarmsWithNoCallback` — arm, dispose, press `x` with bind `x`: no callback, `p.x` runs.
  - `capture_CallbackArmsAgain_NextKeyReachesTheNewCapture` — `onKey` arms a second capture; press `t` then `<`:
    first gets `t`, second gets `<lt>`.
  - `capture_EditorTakesTheChord_CaptureStillTakesIt` — `takesChordKey: () => true`, `contains: () => true`; press
    Ctrl+n: `onKey('<C-n>')`.
- In `src/renderer/plugins/page-api.test.ts` (its deps builder gains a `keyCapture` fake recording arms):
  - `captureKey_Armed_CancelsThePendingSequenceFirst` — `pendingKeys.cancel` is called before `keyCapture.capture`.
  - `captureKey_PluginStops_DisarmsTheCapture` — disposing the part's `registrations` disposes the capture handle.

Approach: `capture` keeps `armed: { onKey, onCancel } | null` inside `installPageKeys`; the capture-phase listener
reads it first. No other listener is added.

Done when: `npm run typecheck`, `npm run lint` and `npm test -- src/renderer/page-keys.test.ts
src/renderer/plugins/page-api.test.ts src/renderer/key-sequences.test.ts src/shared/plugin-part-harness.test.ts`
pass. No self-test group covers this task: nothing presses into a capture until 04, whose settings steps prove it
live; the runtime check of recording with focus in a settings box is in `07-final-verification.md`.
Commit:    one commit for the group

## Proof

