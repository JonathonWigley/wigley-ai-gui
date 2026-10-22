# 04 — Primitives: key hints and controls

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/shared/page/ui/kbd-parts.ts` · test `src/shared/page/ui/kbd-parts.test.ts` ·
           create `src/shared/page/ui/kbd.ts`, `kbd.css` · create `src/shared/page/ui/button.ts`, `button.css` ·
           create `src/shared/page/ui/icon-button.ts`, `icon-button.css` · create `src/shared/page/ui/chip.ts`, `chip.css` ·
           create `src/shared/page/ui/tag.ts`, `tag.css` · create `src/shared/page/ui/status-dot.ts`, `status-dot.css` ·
           create `src/shared/page/ui/input-frame.ts`, `input-frame.css`
Consumes:  `export function formatChord(token: string, platform: Platform): string;` in `src/shared/key-hints.ts` ← plan A task 03 ·
           `export type Platform = 'macos' | 'windows' | 'linux';` in `src/contracts/platform.ts` ← plan A task 02 ·
           `export function icon(name: string): HTMLElement;` in `src/shared/page/ui/icon.ts` ← plan A task 04 ·
           `element` in `src/shared/page/dom.ts` ← tree ·
           the core tokens (the keys of `src/config/theme-tokens.ts`, `--wg-` prefixed) and JetBrains Mono behind `--wg-font-mono` ← plan A, 01 ·
           the `src/shared/page/ui` entry in `scripts/check-layers.mts` allowing `src/contracts`, `src/shared` and `src/shared/page` ← plan A task 04
Produces:  see **Produces** below — every signature lands in the file named beside it
Decisions: see **Decisions** below
Tests:     see **Tests** below
Done when: every file above exists with the signatures below; each builder file imports its own CSS
           (`import './kbd.css';`); `npm run typecheck`, `npm run lint` (check-styles included once 03
           lands) and `npm test` pass; the visual checks are in 08's live list (Kbd, buttons, chips,
           tags, dots, input frames in the gallery)
Commit:    one commit for the group

## Inventory — primitive → the surfaces that will use it

Measured at plan time from `src/plugins/*/page/`, `src/plugins/*/layouts/default/`, `src/shared/page/`,
`src/renderer/toasts.ts` and the keys plugin; re-verify before plan C maps them.

| Primitive | Replaces today | Surfaces (plan C) |
|---|---|---|
| Kbd | `appendKeys`'s `kbd.key-hint` (`dom.ts`), `<kbd>` in which-key, help and the key bar | every forms button with a bind (`forms-view.ts`, `round-view.ts` rail and review, `card-parts.ts` choices, `card-kit.ts` toggles, verdict, action picks), chat permission buttons and dialogs (`chat-kit.ts`, `chat-dialogs.ts`), which-key, help, key bar, empty states |
| Button | `.button`, `.button-primary`, `.button-danger` (`dialog.css`), `toggle`, `verdict-button`, `action-pick` (`forms.css`) | forms Submit / Cancel round / confirm dialogs, Accept, toggles (Not applicable, Don't ask me this), action picks; chat Allow / Deny and its confirm and reason dialogs; help's Close; docs confirm |
| IconButton | none drawn by a builder today | activity bar items and title bar actions (plan A's shell), the composer's send (plan C) |
| Chip | `span.chat-control` (`chat-view.ts`) | chat session controls in the composer |
| Tag | `.badge*` (`forms.css`: recommend, notice, origin, severity), `.docs-chip[data-state]` (`docs.css`), `.session-row-harness`, `.item-kind`, `.md-pill` stays markdown's | forms cards and review, docs header chips, session rows |
| StatusDot | `.rail-dot` (`forms.css`), `.session-row-marker` (`sessions.css`), `.chat-tool-running` / `-error` classes (`chat.css`) | forms rail, session rows, chat tool cards |
| InputFrame | `.box .cm-editor`, `.chat-box`, `.chat-reason-box`, `.docs-box`, `.list-picker-filter .cm-editor` | every CodeMirror text box: forms answer boxes, the composer box, chat reason, docs path box, picker filters |

InputFrame is added beyond the expected set: five surfaces draw their own text-box frame today.
The `danger` button variant is added beyond primary / secondary / ghost: forms' Cancel the round
and both chat confirm dialogs use `button-danger`.

## Produces

```ts
// src/shared/page/ui/kbd-parts.ts
export interface KbdPart { kind: 'key' | 'chord' | 'or'; text: string }
export function kbdParts(keys: string): KbdPart[];

// src/shared/page/ui/kbd.ts
export function kbd(keys: string, platform: Platform): HTMLElement;

// src/shared/page/ui/button.ts
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface TextButtonOptions { variant?: ButtonVariant; hint?: HTMLElement | null }
export function textButton(label: string, onClick: () => void, options?: TextButtonOptions): HTMLButtonElement;

// src/shared/page/ui/icon-button.ts
export type IconButtonSize = 'sm' | 'md';
export function iconButton(iconName: string, label: string, onClick: () => void, size?: IconButtonSize): HTMLButtonElement;

// src/shared/page/ui/chip.ts
export function chip(label: string, value: string, onClick: (() => void) | null): HTMLElement;

// src/shared/page/ui/tag.ts
export type TagTone = 'neutral' | 'accent' | 'running' | 'success' | 'warning' | 'attention' | 'error';
export function tag(text: string, tone?: TagTone): HTMLElement;

// src/shared/page/ui/status-dot.ts
export type DotStatus = 'idle' | 'running' | 'success' | 'warning' | 'attention' | 'error';
export function statusDot(status: DotStatus): HTMLElement;
export function setDotStatus(dot: HTMLElement, status: DotStatus): void;

// src/shared/page/ui/input-frame.ts
export function inputFrame(): HTMLElement;
```

## Decisions

The convention every primitive in 04 and 05 follows (drafter, from `dom.ts`, `list-picker.ts` and
the state classes the surfaces already toggle):

- **Names.** A builder that returns an element is a noun (`kbd`, `tag`); one that returns a handle
  is `create<Name>` (`createSplit`), as `element` and `createListPicker` are today. `textButton`, not
  `button`, so it never shadows `dom.ts`'s `button` in a file importing both.
- **Classes.** Every root carries `ui-<name>` (`ui-kbd`, `ui-button`), parts `ui-<name>-<part>`,
  and a variant fixed at build a modifier `ui-<name>--<variant>` (as `material-chrome--dense`). The
  `ui-` prefix keeps them apart from the legacy `.button`, `.badge`, `.dialog` rules plan C retires.
- **States.** A boolean state is an `is-<state>` class the caller toggles with
  `classList.toggle`; an enumerated value is a `data-<name>` attribute; a state with behaviour is a
  handle method. The vocabulary, used everywhere:
  - `is-selected` — the chosen item: a selected row, a toggle button that is on, a picked action
  - `is-active` — the current one of a set that shows: the shown tab, a chip whose picker is open
  - `is-cursor` — the keyboard cursor: the one focus ring (`--wg-focus-border`, 1px, inside)
  - `is-disabled` — on a non-button root; a `<button>` root uses its `disabled` property instead,
    so the browser drops the click
  - `is-hover`, `is-pressed` — gallery only: each CSS rule for `:hover` also matches `.is-hover`,
    and each for `:active` also matches `.is-pressed`, so the gallery draws those states at rest
- **Buttons never take focus.** Every `<button>` a primitive builds sets `type = 'button'`,
  `tabIndex = -1` and prevents the default on `mousedown`, as `dom.ts`'s `button` does (DESIGN.md
  § Keys and focus).
- **Key hints compose.** A primitive that shows a hint takes the hint element (`kbd(...)`) or
  null, rather than keys and a platform, so only Kbd knows the platform. Null draws nothing, as
  `appendKeys` does today.
- **CSS reads tokens only**, `--wg-<name>` from the core registry; `0`, `1px`, `50%` and `@media`
  breakpoints are the only raw values (DESIGN.md § Tokens and themes). Transitions use
  `var(--wg-duration-fast) var(--wg-ease-out)` on `background-color`, `color` and `border-color`.

Per primitive:

- **Kbd notation** (drafter): `keys` is a hint string as `formatKeys`, `mergeHints` and `keysFor`
  print it today — keys separated by spaces, alternatives by ` / `, a digit run as `1–9`. A whole
  token in vim chord notation (`<A-o>`, `<D-Enter>`) is drawn through `formatChord`; every other
  token is drawn as written. Vim strings with no spaces (`<Space>kd`, the editor hints) are not
  split: plan C converts them with `vimTokens` and `formatVimToken` first.
- **Kbd look:** `kbd.ui-kbd`, inline-flex, `gap: var(--wg-space-1)`, `font-family:
  var(--wg-font-mono)`, `font-size: var(--wg-text-12)`, `color: var(--wg-fg-tertiary)`,
  `font-variant-numeric: tabular-nums`, `white-space: nowrap`; each part a `span.ui-kbd-key` or
  `span.ui-kbd-or` (`color: var(--wg-fg-disabled)`). No key-cap boxes (quieter, DESIGN.md
  § Intent): `.ui-kbd` sets `background: transparent`, `border: 0` and `padding: 0`, overriding the
  global `kbd` rule in `src/renderer/index.css` that the legacy hints keep until plan C. The label beside a Kbd stays in the UI font: it is the caller's text, not part of Kbd.
- **Button** (`button.ui-button.ui-button--<variant>`, default `secondary`): inline-flex,
  `gap: var(--wg-space-2)`, `padding: var(--wg-space-1) var(--wg-space-3)`, `border: 1px solid
  transparent`, `border-radius: var(--wg-radius-md)`, `font-size: var(--wg-text-13)`,
  `font-weight: var(--wg-weight-medium)`, `line-height: var(--wg-leading-ui)`; the label in
  `span.ui-button-label`, then the hint. States by variant:

  | Variant | Rest | Hover | Pressed | `is-selected` | Disabled |
  |---|---|---|---|---|---|
  | primary | `button-primary-background` / `button-primary-foreground` | `button-primary-hover` | `accent` | — | `button-secondary-background` / `fg-disabled` |
  | secondary | `button-secondary-background` / `fg` | `button-secondary-hover` | `border-strong` | `accent-tint-strong` / `fg` | `button-secondary-background` / `fg-disabled` |
  | ghost | transparent / `fg-secondary` | `button-ghost-hover` / `fg` | `button-secondary-background` | `accent-tint` / `fg` | transparent / `fg-disabled` |
  | danger | transparent / `status-error`, border `status-error-tint` | `status-error-tint` | `status-error-tint`, border `status-error` | — | transparent / `fg-disabled` |

  The primary variant's hint reads `button-primary-foreground`. Disabled sets `cursor: default` and
  no hover. The recommended choice is a primary button (design.md § Surfaces).
- **IconButton** (`button.ui-icon-button`, `--sm` for `'sm'`, default `'md'`): square
  `var(--wg-icon-button)` (`--wg-icon-button-sm` for sm), the `icon(iconName)` glyph at
  `var(--wg-icon-size)`; `aria-label` and `title` are `label`. Rest transparent / `fg-secondary`,
  hover `button-ghost-hover` / `fg`, pressed `button-secondary-background`, `is-active` `fg` on
  `button-ghost-hover`, disabled `fg-disabled`; `border-radius: var(--wg-radius-md)`
  (`--wg-radius-sm` for sm). A control on glass is a plain hover fill (DESIGN.md § Layers).
- **Chip** (`ui-chip`): a `<button>` when `onClick` is given, else a `<span>` that takes no hover
  (hover rules match `button.ui-chip` only). `span.ui-chip-label` in `fg-secondary`, then, when
  `value` is not empty, `span.ui-chip-value` in `fg`. `border: 1px solid var(--wg-border-default)`,
  `border-radius: var(--wg-radius-md)`, `padding: 0 var(--wg-space-2)`, `min-height:
  var(--wg-icon-button-sm)`, `font-size: var(--wg-text-12)`, transparent at rest (it sits on the
  composer's glass); hover `button-ghost-hover`; `is-active` `accent-tint` with border `accent`;
  disabled `fg-disabled` for both parts.
- **Tag** (`span.ui-tag.ui-tag--<tone>`, default `neutral`): `font-size: var(--wg-text-11)`,
  `font-weight: var(--wg-weight-medium)`, `line-height: var(--wg-leading-tight)`, `padding: 0
  var(--wg-space-1)`, `border-radius: var(--wg-radius-sm)`, `white-space: nowrap`. Tones: neutral
  `fg-secondary` with `border: 1px solid var(--wg-border-default)`; accent `accent` on
  `accent-tint`; each status tone `status-<tone>` on `status-<tone>-tint`. A plugin colour (forms'
  origin tokens) is the neutral tone plus the plugin's own class, whose rule sets `color` and
  `background` from its `themeTokens` (DESIGN.md § Tokens and themes). Tags have no states.
- **StatusDot** (`span.ui-dot`, `data-status`, `role="img"`, `aria-label` the status id):
  `width` and `height` `var(--wg-space-2)`, `border-radius: 50%`, `flex: none`. `idle` is hollow
  (`border: 1px solid var(--wg-fg-tertiary)`); every other status fills with `status-<status>`.
  Static: no animation (DESIGN.md § Motion — only the streaming indicator moves). `setDotStatus`
  sets `data-status` and `aria-label`.
- **InputFrame** (`div.ui-input`): the element a caller hands `EditorHost.create` as the box's
  parent. `background: var(--wg-input-background)`, `border: 1px solid var(--wg-input-border)`,
  `border-radius: var(--wg-radius-md)`, `padding: var(--wg-space-1) var(--wg-space-2)`; hover
  border `border-strong`; `:focus-within` and `.is-cursor` border `focus-border` (the focused box is
  the keyboard cursor); `.ui-input .cm-editor` transparent with no outline when focused;
  `.ui-input .cm-placeholder` in `input-placeholder`.

GIVEN a hint string WHEN `kbdParts` reads it THEN it splits on runs of whitespace, a lone `/` is an
`or` part, a token that is wholly one `<…>` group is a `chord`, and every other token is a `key`.

## Tests

`kbdParts` in `src/shared/page/ui/kbd-parts.test.ts` (the DOM builders are judged on screen; the
test environment is `node`, with no DOM, as `vitest.config.mts` sets it):

- `splits a page sequence into keys` — `'Space k s'` → `[{kind:'key',text:'Space'},
  {kind:'key',text:'k'}, {kind:'key',text:'s'}]`
- `reads a whole vim chord as one chord` — `'<A-o>'` → `[{kind:'chord',text:'<A-o>'}]`
- `reads a lone slash as an alternative` — `'j / k'` → `[{kind:'key',text:'j'},
  {kind:'or',text:'/'}, {kind:'key',text:'k'}]`
- `keeps a digit range whole` — `'1–9'` → `[{kind:'key',text:'1–9'}]`
- `ignores extra whitespace` — `'  <D-Enter>   x '` → `[{kind:'chord',text:'<D-Enter>'},
  {kind:'key',text:'x'}]`
- `reads an empty string as no parts` — `''` → `[]`
- `leaves a chord inside a longer token as a key` — `'<Space>kd'` → `[{kind:'key',text:'<Space>kd'}]`

`kbd` draws each chord part's text as `formatChord(part.text, platform)` and each key and `or` part
as written; that mapping restates `formatChord`, whose own tests (plan A) pin the platform glyphs,
so no test repeats it.

## Proof

