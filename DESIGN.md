# DESIGN.md — wigley-ai-gui

**Contents**

- **Intent** — what the app should feel like, and the three qualities every screen is judged by.
- **Layers** — the four layers, the material each one takes, and the rules between them.
- **Tokens and themes** — where every value comes from, and how to add one.
- **Colour** — the roles, the one accent, and status colours.
- **Type** — fonts, the scale, weights, sentence case, prose.
- **Space, size and shape** — the spacing scale, row heights, radii, separation, breakpoints.
- **Motion** — durations, easing, what may move, reduced motion.
- **Keys and focus** — the key rule, the keyboard cursor, the mouse.
- **Primitives** — the shared building blocks, and how a new one joins.
- **Surfaces** — how each kind of screen is built.
- **Icons and copy** — one icon set; plain, sentence-case words.
- **Checks** — what proves a screen follows this file.

The standard every view in this app follows. Read it before any UI change: a view, its CSS, a
theme, a primitive, a layout, or a key. When a change needs a value or a pattern this file does
not cover, add it here first, with its reason, and then build it. Where code and this file
disagree, fix the code, or change this file on purpose. The reasons behind these choices are in
`docs/features/ui-design/design.md`.

## Intent

A desktop workbench for driving coding agents: agent sessions, review forms, chat, and a docs
browser and editor. It is a calm professional tool in the lineage of VS Code and JetBrains Fleet,
with the transcript model of the Codex, Claude Code and Gemini GUIs, wearing Catppuccin Mocha with
a light Apple-style glass on the chrome.

**Solid, quiet content sheets inside a softly translucent chrome.**

Every screen is judged by three qualities, in this order:

1. **Legible and dense.** The user lives in this app for hours. Density beats whitespace;
   readability beats effect.
2. **Calm.** The chrome recedes, so the content carries the colour and the attention.
3. **Crafted.** Glass, hairlines and motion are quiet enough that the user notices the quality, not
   the effect.

When a choice is unclear, take the quieter one: remove styling before adding it.

## Layers

Everything on screen belongs to exactly one layer, and the layer decides its material.

```
┌──────────────────────────────────────────────────────────────┐
│ L1 title bar (glass)          mode context                   │
│ ┌────┬──────────────┬──────────────────────────────────────┐ │
│ │ L1 │ L1 side bar  │ L1 tab strip (sits on the sheet top) │ │
│ │act.│ (glass,      │ ┌──────────────────────────────────┐ │ │
│ │bar │  dense)      │ │ L2 CONTENT SHEET (solid)         │ │ │
│ │    │ sessions /   │ │ form, chat, doc, editor          │ │ │
│ │    │ docs tree    │ │        ┌ L3 floating (glass) ┐   │ │ │
│ │    │              │ │        │ composer, picker    │   │ │ │
│ │    │              │ └────────┴─────────────────────┴───┘ │ │
│ └────┴──────────────┴──────────────────────────────────────┘ │
│ L1 status bar (glass)                                        │
└──────────────────────────────────────────────────────────────┘
  L0 backdrop: crust with two faint washes, seen only through L1
```

| Layer       | What lives here                                                         | Material                                                                                              |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| L0 backdrop | The window itself                                                       | `--wg-window-background` with `--wg-window-ambient`                                                   |
| L1 chrome   | Title bar, activity bar, side bar, tab strips, status bar, panel header | The `material-chrome` class (`material-chrome--dense` for the side bar)                               |
| L2 content  | Form tab, chat transcript, docs, editors, the forms rail, diffs         | Solid `--wg-sheet-background`, as inset sheets with a `--wg-sheet-gutter` gutter and `--wg-radius-lg` |
| L3 floating | Composer, pickers, which-key, help, dialogs, menus, toasts              | The `material-floating` class                                                                         |

The forms rail is the one L2 exception: it stays on `--wg-block-background` until plan C restyles forms.

- **Content is solid.** Glass in L2 makes text compete with whatever scrolls behind it, so cards,
  code blocks and inputs inside a sheet tint with alpha over the solid sheet and never show through.
- **Glass sits on what is behind it, never on glass.** A control on a glass bar is a plain
  hover-fill control.
- **Glass needs something behind it,** which is why L0 carries the ambient wash.
- **`backdrop-filter` appears only in `src/shared/page/ui/materials.css`**, which holds the three
  classes `material-chrome`, `material-chrome--dense` and `material-floating`, so the
  reduced-transparency mode turns every glass surface opaque in one place.
- **The layers stack** by the `number` tokens `z-chrome` (L1), `z-floating` (L3), `z-dialog` and
  `z-toast`, in that order (`10`, `100`, `200`, `300` in Mocha).
- **Every screen looks intentional under reduced transparency**: the `transparency` setting
  (`system`, `full`, `reduced`) and the OS preference under `system` both make materials opaque
  through the theme's `reduced` block.

## Tokens and themes

Every colour, length, duration, shadow and font a view uses is a token, read as a CSS variable
`--wg-<name>`. The value lives in the theme file, so the user reworks the look by editing a theme,
and a broken value is caught by the theme loader instead of shipping in a stylesheet.

- The built-in theme `src/config/themes/catppuccin-mocha.json` holds a value for every core token;
  it is the reference for every number this file names by role.
- A user theme in `~/.config/wigley-ai-gui/themes/` sets `extends` to a base theme and lists only
  the tokens it changes.
- Core tokens are design-system roles (`fg-secondary`, `accent-tint`, `material-chrome-bg`,
  `space-2`, `radius-md`, `duration-fast`). A plugin's own tokens (`forms.origin-caused`, read as
  `--wg-forms-origin-caused`) are declared in its manifest's `themeTokens` with defaults.
- Views name roles, never palette entries: a view reads `--wg-status-error`, and only the theme
  maps that role to `red`.
- **Adding a token:** add it to this file's matching section with its role and reason, declare it
  as below, then use it. A core token: declare its kind in the core token registry and give every
  built-in base theme (Mocha) its value. A plugin token: declare its kind and default in the
  plugin's `themeTokens`. A one-off value in a stylesheet is a token not yet named.
- **Raw values** live only in theme files. CSS may still write `0`, `1px` hairlines, percentages,
  `fr` tracks, viewport units, unitless numbers, and breakpoints inside `@media` (CSS reads no
  variable there; see **Breakpoints**). Code may write a unitless custom property on an element
  (`--ui-row-depth`, `--ui-split-start`) through `style.setProperty`, which the style check does not
  judge.

## Colour

Catppuccin Mocha by role. At rest a screen is neutral with one accent; colour appears where it
means something.

| Role                   | Tokens                                                                  | Use                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Backdrop               | `window-background` (crust)                                             | L0 only                                                                                                             |
| Chrome                 | `material-chrome-bg` (translucent mantle)                               | L1                                                                                                                  |
| Sheet                  | `sheet-background`, `editor-background`, `transcript-background` (base) | L2, solid                                                                                                           |
| Raised in content      | `card-background`, `input-background`, `block-background`               | Cards, inputs, code blocks: a tint over the sheet                                                                   |
| Lines                  | `border-subtle`, `border-default`, `border-strong`                      | Hairlines on L1 edges; gutters elsewhere                                                                            |
| Text                   | `fg`, `fg-secondary`, `fg-tertiary`, `fg-disabled`                      | Primary, labels and metadata, hints, disabled and placeholder                                                       |
| **Accent (the one)**   | `accent`, `accent-tint`, `accent-tint-strong`, `focus-border`           | Focus ring, selection, the primary button, the active tab and activity mark, the active row, the recommended choice |
| Links and info         | `fg-link`, `status-info`                                                |                                                                                                                     |
| Running                | `status-running` (sapphire)                                             | An agent working, a tool running                                                                                    |
| Success / added        | `status-success`                                                        |                                                                                                                     |
| Warning                | `status-warning`                                                        |                                                                                                                     |
| Needs you              | `status-attention` (peach)                                              | A permission prompt, an open round: "your turn", apart from warning                                                 |
| Error / removed        | `status-error`                                                          |                                                                                                                     |
| Text selection, cursor | `selection-background`, `cursor`                                        | Catppuccin convention                                                                                               |
| Changed sections       | `diff-inserted-mark`, `diff-removed-mark`, `diff-changed-mark` (peach)  | The mark on an inserted, removed or changed section in rendered markdown                                            |

- **One accent does brand work.** Any other colour on screen at rest must mean a status.
- **Status colours only where status exists**, and as small marks at full strength (dots, icons,
  2px indicators, text). A larger area takes the `*-tint` token (10–18% alpha). A pastel as a large
  fill is too loud.
- **Code colours** come from the official Catppuccin Mocha highlight style, in editors and in
  rendered markdown alike.

## Type

- **UI font:** the system stack (`font-ui`). **Mono** (`font-mono`, JetBrains Mono): only for
  code-like content — code, paths, commands, tool names and arguments, terminal output, key chords
  inside a Kbd (the label beside a Kbd stays in the UI font). A label is never mono for
  decoration. `font-mono` is JetBrains Mono from `@fontsource/jetbrains-mono`, weights 400, 500 and
  600, bundled into the app.
- **Scale:** `text-11`, `text-12`, `text-13`, `text-14` (prose), `text-16`, `text-20`. Nothing
  larger inside the app. `text-ui` is the UI base size and `text-mono` the code size; the UI
  default and code read these two, and `text-13` stays a fixed step of the scale.
- **Weights:** `weight-regular` (400), `weight-medium` (500) for labels and active items,
  `weight-semibold` (600) for headings. Nothing heavier.
- **Sentence case everywhere.** A section header is `text-12`, semibold, `fg-secondary`. Capitals
  shout, and a calm tool does not shout.
- **Prose** (chat, rendered docs): `text-14`, `leading-prose`, at most `prose-measure` wide.
- **Numbers that change** (counts, timers, costs, line numbers) use tabular numerals, so they do
  not jitter.
- The user's `fonts` settings, when set, override the theme's font families and base sizes:
  `fonts.ui` sets `font-ui`, `fonts.mono` `font-mono`, `fonts.uiSize` `text-ui` and
  `fonts.monoSize` `text-mono`.

## Space, size and shape

- **Spacing** is the `space-*` scale only (2, 4, 6, 8, 12, 16, 24, 32 in Mocha).
- **Density:** tree rows `row-tree`, list and menu rows `row-list`, tabs `tab-height`, the title
  bar `toolbar-height`, the status bar `statusbar-height`, the activity bar `activitybar-width`,
  the side bar `sidebar-width`, icon buttons `icon-button-sm` and `icon-button`, icons
  `icon-size`. The title bar leaves `traffic-light-inset` at its left for macOS's window
  buttons.
- **Radii by hierarchy:** `radius-sm` for rows, tags and inline code; `radius-md` for buttons,
  inputs, cards and code blocks; `radius-lg` for sheets, menus and pickers; `radius-xl` for
  dialogs and the composer. One radius on everything flattens the hierarchy.
- **Separation:** gutters between sheets, hairlines on L1 edges, and shadows only on L3. A shadow on
  content makes it float when it should sit.
- **Breakpoints** (raw in `@media`): `800px` tightens content padding; `680px` lays the side bar
  over the sheet instead of beside it; `640px` stacks a sheet's split panes.

## Motion

- **Durations:** `duration-fast` (hover, press), `duration-base` (small things opening and
  closing), `duration-slow` (panels, sheets, the composer).
- **Easing:** `ease-out` entering, `ease-in` leaving. No bounce and no overshoot.
- **What moves:** motion answers a user action or reports agent state (the streaming indicator, a
  tool card settling from running to done). Content does not animate in, and nothing moves on its
  own.
- **Reduced motion:** under `prefers-reduced-motion` `duration-fast`, `duration-base` and
  `duration-slow` all take `duration-instant` (`1ms` in Mocha) and the streaming indicator is
  static.
- **A floating panel fades in on open** (`openFloatingPanel`) over `duration-base`; showing a page
  or mode that holds an open panel does not fade it again, and closing is instant.

## Keys and focus

The keyboard is first; the mouse works everywhere.

- **Raw keys act on the focused scope** (`c` clears the focused item's choice, `m` opens the chat's
  mode picker).
- **Chords navigate the visible scope** (`<A-o>` next tab, `<A-n>` next unanswered item, `<C-l>`
  focus the doc pane).
- **The leader changes scope or holds actions that need not be obvious** (`Space k s` Sessions,
  `Space z …` debug).
- **Inside a text box** raw keys belong to vim, so an action reachable from a box keeps a leader
  route there (`<Leader>a…` in a forms box), and navigation chords work there unchanged.
- **The keyboard cursor always shows:** the selected row, the focused box, the focused card, each
  drawn with the one focus ring (`focus-border`, 1px, inside: an inset ring on a row, the border
  colour on a card or an input frame). The user must always see where the keys go.
- **Buttons never take focus**, so Enter and Space stay with the page keys; a click runs them.
- **Key hints** draw through the Kbd primitive, which prints chords through `formatChord` for the
  platform (⌘ ⌥ on macOS, Ctrl Alt on Windows). A view draws a hint only when its command has a bind.
- **Every new bind** is checked against this rule and against every bind in its scope.

## Primitives

The shared building blocks live in `src/shared/page/ui/`, one builder per primitive with its CSS
beside it. Every surface is built from them and from tokens, so a change to a primitive restyles
every screen at once, and forms and chat layout kits hand the same primitives to user layouts.

- A primitive exists because a surface uses it. A new feature that needs one adds it to
  `src/shared/page/ui/`, to the gallery, and to this section.
- The gallery (`Space z g`) shows every primitive in every state (default, hover, active, focus,
  disabled). Raw `t` in it switches transparency in place until the page reloads, and writes
  nothing to `settings.json`.
- **Icon** is the one module naming the icon font. **Kbd** is the one place a key hint is drawn.

The primitives, each a builder in `src/shared/page/ui/`:

- **Kbd** (`kbd`): a key hint, chords in `font-mono`.
- **Button** (`textButton`): a labelled button, variants primary, secondary, ghost, danger.
- **IconButton** (`iconButton`): a square Codicon button, sizes `sm` and `md`.
- **Chip** (`chip`): a session control's label and value; a button when given a click handler.
- **Tag** (`tag`): a small static label in a tone.
- **StatusDot** (`statusDot`): a static dot for idle, running, success, warning, attention or error.
- **InputFrame** (`inputFrame`): the frame around a text box.
- **Row** (`row`): a list or tree row, density `list` or `tree`.
- **Tabs** (`tabStrip`, `tab`): the strip on a sheet's top edge, and one tab.
- **Sheet** (`sheet`): the solid L2 content sheet.
- **Split** (`createSplit`): two panes with a drag handle; the start pane's width lives in `uiState`.
- **Card** (`card`, with an `attention` or `error` edge) and the collapsible card
  (`createCollapsibleCard`).
- **FloatingPanel** (`floatingPanel`, opened with `openFloatingPanel`): the L3 glass panel.
- **Dialog** (`createDialog`): a modal over the `scrim`.
- **EmptyState** (`emptyState`): one line saying what to do, then the key that does it.
- **SectionHeader** (`sectionHeader`): a section's heading with a trailing slot.

Icon stays the Codicon builder `icon`.

Conventions every primitive follows:

- A builder returning an element is a noun (`chip`); one returning a handle is `create<Name>`.
- Root class `ui-<name>`, parts `ui-<name>-<part>`, variants `ui-<name>--<variant>`.
- A composite primitive's element can carry another primitive's class (the dialog panel carries
  `ui-floating`, the collapsible card carries `ui-card`). Its overriding rules use the compound
  selector (`.ui-floating.ui-dialog`, `.ui-card.ui-collapsible`), which outranks either class
  alone, so they win whatever order the stylesheets load in.
- States are classes `is-selected`, `is-active`, `is-cursor` and `is-disabled` (a button's
  `disabled` attribute); an enumerated value is `data-<name>`; `is-hover` and `is-pressed` exist
  only so the gallery can show those states.
- Buttons never take focus.
- A hint is a Kbd element handed in.

## Surfaces

- **Title bar:** L1, `toolbar-height`, draggable; the shown mode's context centred; actions on the
  right as `icon-button` buttons when a feature contributes one. The OS window buttons stay native.
- **Activity bar:** L1, icons only; the shown mode carries a 2px accent mark on its window-side edge.
- **Side bar:** L1 dense glass. Rows are `row-tree` or `row-list`; hover fills with
  `list-hover-background`; the selected row takes `list-active-background` and `fg`; the keyboard
  cursor adds the focus ring.
- **Tabs:** sit on the top edge of their sheet. The active tab is solid sheet colour with a 2px
  accent top mark; others are transparent in `fg-secondary`.
- **Status bar:** L1, `statusbar-height`, `text-12`. Status colours only on status items.
- **Forms:** the rail is a solid pane in the Form tab's sheet. Cards are `card-background` with
  `radius-md`. The recommended choice carries the accent, since Enter accepts it.
- **Chat:** user turns are a `card-background` block, not a bubble. Assistant prose is markdown on
  the sheet. Tool calls are collapsible cards: a mono head with the tool and its summary, a status
  dot (running, success, error), collapsed once done. Permission prompts are cards with a
  `status-attention` edge and plain verbs (Allow once, Deny). The composer floats (L3,
  `radius-xl`, inset `space-3`) with the transcript scrolling beneath it, and holds the box, the
  session controls as chips, and send.
- **Docs:** in Docs mode the tree is the side bar; in a session's Docs tab it is the left pane of a
  split in the sheet. Rendered docs use the prose style; code blocks are solid `block-background`
  with `radius-md`.
- **Floating:** pickers, which-key, help and dialogs use the floating material with `row-list` rows
  and key hints right-aligned in `fg-tertiary`; dialogs sit over the `scrim`.
- **Empty states:** one line saying what to do, and the key or action that does it. No
  illustrations.
- **Splits** resize by drag, and the app keeps the widths.

## Icons and copy

- **Codicons**, one family, `icon-size`, `fg-secondary` at rest and `fg` on hover or when active.
- **Copy is sentence case with plain verbs.** A button says what happens ("Run agent", "Save
  file"); the toast echoes it ("Agent started", "Saved"). An error says what happened and what to
  do next, without apology. A button label stands alone, with no trailing arrow.

## Checks

- `npm run lint` runs `scripts/check-styles.mts`: no raw colour, length, duration or font stack in
  CSS or inline styles under `src/`, and `backdrop-filter` only in `materials.css`. Inline styles
  are judged through the TypeScript AST. A plain run skips the files on its `LEGACY_FILES` list,
  the ones plan C rebuilds on the primitives; `--no-legacy` judges every file, or only the paths
  given after it. Plan C's final task deletes the list.
- A self-test step's `screenshot` field saves a PNG of the window to
  `.selftest/screenshots/<plugin>-<name>.png`. The self-test saves the gallery's pages
  (`forms-gallery-<n>-full`, `forms-gallery-<n>-reduced`), Sessions (`forms-sessions-*`) and Docs
  (`docs-docs-*`) in both transparency settings, and the shell layout swap; the agent checks
  them against this file — density, the one accent, each surface on its layer and material, sentence
  case — before handing a UI change to the user.
- Text meets WCAG AA contrast against its opaque fallback background, in both transparency
  settings.
- Scrolling the transcript beneath the composer stays smooth; when blur is expensive, lower the
  blur radius before the opacity.
- The user runs the final visual check in a visible `npm start`.
