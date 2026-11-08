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
│ L1 right bar (glass, dense) sits beside the sheet, hidden    │
│   while empty (usage details, the unity pool panel)          │
│ L1 status bar (glass; only while a plugin contributes to it) │
└──────────────────────────────────────────────────────────────┘
  L0 backdrop: crust with two faint washes, seen only through L1
```

| Layer       | What lives here                                                                    | Material                                                                                              |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| L0 backdrop | The window itself                                                                  | `--wg-window-background` with `--wg-window-ambient`                                                   |
| L1 chrome   | Title bar, activity bar, side bar, right bar, tab strips, status bar, panel header | The `material-chrome` class (`material-chrome--dense` for the side and right bars)                    |
| L2 content  | the session popup (forms, primer), chat transcript, docs, editors, the forms rail, diffs                    | Solid `--wg-sheet-background`, as inset sheets with a `--wg-sheet-gutter` gutter and `--wg-radius-lg` |
| L3 floating | Composer, pickers, which-key, help, dialogs, menus, toasts                         | The `material-floating` class                                                                         |

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
  `fr` tracks, viewport units, unitless numbers, and breakpoints inside `@media` and `@container`
  (CSS reads no variable there; see **Breakpoints**). Code may write a unitless custom property on an element
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
| Text selection, cursor | `selection-background`, `cursor`, `editor-active-line`                  | Catppuccin convention; the active line's band in a focused document editor                                          |
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
- **Scale:** `text-11`, `text-12`, `text-13`, `text-14`, `text-16`, `text-20`. Nothing
  larger inside the app. `text-ui` is the UI base size, `text-mono` the code size and `text-prose`
  the prose size (14px in every theme); the UI default, code and prose read these three, and
  `text-13` and `text-14` stay fixed steps of the scale.
- **Weights:** `weight-regular` (400), `weight-medium` (500) for labels and active items,
  `weight-semibold` (600) for headings. Nothing heavier.
- **Sentence case everywhere.** A section header is `text-12`, semibold, `fg-secondary`. Capitals
  shout, and a calm tool does not shout.
- **Prose** (rendered markdown wherever it renders: chat, docs, forms cards): `text-prose`,
  `leading-prose`, at most `prose-measure` wide. A markdown `h3` is `text-prose` too. No surface
  overrides it.
- **Numbers that change** (counts, timers, costs, line numbers) use tabular numerals, so they do
  not jitter.
- The user's `fonts` settings, when set, override the theme's font families and base sizes:
  `fonts.ui` sets `font-ui`, `fonts.mono` `font-mono`, `fonts.uiSize` `text-ui`,
  `fonts.monoSize` `text-mono` and `fonts.proseSize` `text-prose`.
- **The active-line band** (`editor-active-line`) shows only in the docs document editor and only
  while it has focus. A text box never draws it; a box's focused frame marks it.

## Space, size and shape

- **Spacing** is the `space-*` scale only (2, 4, 6, 8, 12, 16, 24, 32 in Mocha).
- **Density:** tree rows `row-tree`, list and menu rows `row-list`, tabs `tab-height`, the title
  bar `toolbar-height`, the status bar `statusbar-height`, the activity bar `activitybar-width`,
  the side bar's opening width `sidebar-width` and the right bar's `rightbar-width` (until the user resizes them), icon buttons `icon-button-sm` and `icon-button`, icons
  `icon-size`, the docs page's right column `docs.aside-width`. The title bar leaves `traffic-light-inset` at its left for macOS's window
  buttons.
- **Radii by hierarchy:** `radius-sm` for rows, tags and inline code; `radius-md` for buttons,
  inputs, cards and code blocks; `radius-lg` for sheets, menus and pickers; `radius-xl` for
  dialogs and the composer. One radius on everything flattens the hierarchy.
- **Separation:** gutters between sheets, hairlines on L1 edges, and shadows only on L3. A shadow on
  content makes it float when it should sit.
- **Breakpoints** (raw in `@media` and `@container`): `950px` on the `docs-doc` container hides the docs page's right
  column; `800px` tightens content padding; `680px` lays the side bar
  over the sheet instead of beside it, drawn no wider than reaches the window's edge while the
  user's width is kept; `640px` stacks a sheet's split panes. Every split pane has a
  least width (the primer popup's card column `320px`, every other pane `160px` or more): a narrowing
  split gives up its start pane's width down to its least width first, then stacks at any window width.

## Motion

- **Durations:** `duration-fast` (hover, press), `duration-base` (small things opening and
  closing), `duration-slow` (panels, sheets, the composer), `duration-pulse` (one cycle of a looping
  agent-state pulse, such as a session row's Working label; slow enough to read as breathing, not flashing).
- **Easing:** `ease-out` entering, `ease-in` leaving. No bounce and no overshoot.
- **What moves:** motion answers a user action or reports agent state (the streaming indicator, a
  session row's pulsing Working label, a tool step settling from running to done). Content does not animate in, and nothing moves on its
  own.
- **Reduced motion:** under `prefers-reduced-motion` `duration-fast`, `duration-base` and
  `duration-slow` all take `duration-instant` (`1ms` in Mocha) and the streaming indicator and the
  pulsing Working label are static.
- **A floating panel fades in on open** (`openFloatingPanel`) over `duration-base`; showing a page
  or mode that holds an open panel does not fade it again, and closing is instant.

## Keys and focus

The keyboard is first; the mouse works everywhere.

- **Raw keys act on the focused scope** (`c` clears the focused item's choice, `m` opens the chat's
  mode picker).
- **Chords navigate the visible scope** (`<A-o>` next tab, `<A-n>` next unanswered item, `<A-l>`
  focus the doc pane).
- **The leader changes scope or holds actions that need not be obvious** (`Space k s` Sessions,
  `Space z …` debug).
- **Inside a text box** raw keys belong to vim, so an action reachable from a box keeps a leader
  route there (`<Leader>a…` in a forms box), and navigation chords work there unchanged.
- **The keyboard cursor always shows:** the selected row, the focused box, the focused card, each
  drawn with the one focus ring (`focus-border`, 1px, inside: an inset ring on a row, the border
  colour on a card or an input frame). The user must always see where the keys go.
  - **Chat is the one exception.** While the chat's message box has focus, the caret is the
    cursor: the box draws no focused frame and no entry is marked. Once the box loses focus (Esc),
    the focused block shows a thin left bar (`indicator-width`, `focus-border`) in place of the
    ring, on the entry itself when it has no blocks. A range of blocks shows `accent-tint` across each one.
    The bar sits in a gutter left of the text and of a list item's marker, moving no text. It stays on
    screen: when the transcript scrolls away from it, it moves to the nearest block wholly in view; a
    block too tall for the view counts while any of it shows, and with no block wholly in view it moves to the nearest that shows.
- **Buttons never take focus**, so Enter and Space stay with the page keys; a click runs them.
- **Key hints** draw through the Kbd primitive, which prints chords through `formatChord` for the
  platform. On macOS the modifiers and Return, Tab, Esc, Backspace, Delete and the arrows print
  as glyphs (⌃ ⌥ ⇧ ⌘, ↩ ⇥ ⎋ ⌫ ⌦ ← ↑ → ↓), and every other named key by name, Space included, as
  macOS menus write it; elsewhere they print as words (`Ctrl+`, `Enter`, `Esc`). A view draws a hint only when its command has a bind.
- **A key shows where it acts,** the way a game puts a button prompt beside the thing it moves:
  the app has no bottom key list. Each hint is a KeyPrompt the core draws into an anchor
  the view places (AGENTS.md § Architecture, Key hints), in one of four placement kinds:
  - **Edge prompt:** a navigation chord at the edges of what it moves through, with a chevron
    toward its direction: `⌥I ‹` and `› ⌥O` at the tab strip's ends, `⌥⇧I ▲ ▼ ⌥⇧O` on the session
    list's header, `⌃H ‹ F1 of 6 › ⌃L` on a card's header, `⌥L doc ›` at a split's edge. A pair
    hides when there is nothing else to move to. A split handle's resize prompt `⌥⇧H ◂ ▸ ⌥⇧L`
    (`⌥⇧K ▴ ▾ ⌥⇧J` on a divider between stacked panes) shows only on hover, during a drag and for a moment after a keyboard resize (Split, below).
  - **Cursor prompt:** an action on the selected row, with its label, on the cursor row only
    (`s star  r rename  d trash`): at the row's end in Docs, and in Settings and Backlog, where it
    wraps when the row has no room; on a line of its own under the label in Primer; in a column of
    its own in Notes. Out of scope it hides in place, keeping its space.
  - **Control hint:** the key inside the button, toggle or box label it presses (Accept ↩,
    Not applicable x, Notes a).
  - **Box hint:** a key that acts on a box or a pane, on the focused box's frame (`⌃P ⌃N`) or in
    the pane's header (`/ filter`, `a new`). The chat composer's status line holds the transcript's
    keys as box hints with no labels (`J K V y`), after the box's labelled `i` and `a`.
- **Hints show for the scope in force:** a hint whose scope is not the one keys fire in hides and
  keeps its space, so moving between panes never shifts the layout; a hint for a bind in every
  scope (tabs, sessions) always shows. In a chat pane's tab bar a key with no target takes no
  space, so unfocused panes' bars stay short. The keys plugin's `showHints` setting removes them all,
  their space included (`"keys": { "showHints": false }` in `settings.json`).
- **Vim's own keys show in help only:** `j`/`k`, `gg`/`G`, `h`/`l` on a tree, Enter on a row, Esc,
  and the `⌃J`/`⌃K` scroll keys work the same on every list and pane, so a hint for them is
  noise. Leader sequences show in which-key.
- **Every new bind** is checked against this rule, against `docs/keymap.md` (which modifier and
  which leader group it takes), and against every bind in its scope.

## Primitives

The shared building blocks live in `src/shared/page/ui/`, one builder per primitive with its CSS
beside it. Every surface is built from them and from tokens, so a change to a primitive restyles
every screen at once, and every owner's layout kit hands the same primitives to user layouts, through the
shared `BaseKit`.

- A primitive exists because a surface uses it. A new feature that needs one adds it to
  `src/shared/page/ui/`, to the gallery, and to this section.
- The gallery (`Space z g`) shows every primitive in every state (default, hover, active, focus,
  disabled). Raw `t` in it switches transparency in place until the page reloads, and writes
  nothing to `settings.json`.
- **Icon** is the one module naming the icon font. **Kbd** is the one place a key hint is drawn.

The primitives, each a builder in `src/shared/page/ui/`:

- **Kbd** (`kbd`): a key hint, chords in `font-mono`.
- **KeyPrompt** (`keyPrompt`): a Kbd with an optional label after it in `fg-tertiary`; the one
  thing the core draws into an anchor. A view places a chevron (`keyChevron`, `‹ › ▲ ▼ ◂ ▸`)
  beside the anchor element when the prompt points a direction; the chevron hides and shows with its
  anchor. The parts around anchors are builders in `key-anchors.ts`: an edge prompt (`keyEdge`),
  which `is-no-target` hides keeping its space; a box hint (`boxHint`); and a stack of one
  command's anchors in several scopes in one cell (`keyStack`). The core marks each anchor
  element `ui-key-anchor`; an anchor, box hint or stack holding no KeyPrompt (its commands unbound, or hints off)
  takes no space, and a box hint whose prompts are all hidden paints nothing.
- **Button** (`textButton`): a labelled button, variants primary, secondary, ghost, danger.
- **IconButton** (`iconButton`): a square Codicon button, sizes `sm` and `md`.
- **Chip** (`chip`): a session control's label and value; a button when given a click handler.
- **Tag** (`tag`): a small static label in a tone.
- **File chip**: a file's path drawn inside a vim box as a pill: `block-background`, `radius-sm`, `space-1` padding
  on the sides only so the box keeps its line height, `font-mono`, a file Codicon in `fg-secondary`, then the file's
  name. The CodeMirror adapter draws it; it is not a builder
  (`docs/features/file-drop/design.md`).
- **ToggleMark** (`toggleMark`): a small square on/off mark beside a row's label, such as an included item, with a check
  when on; a click calls the view's handler and the view sets the new state with `setToggleMark`, and the key that
  toggles it belongs to the view.
- **StatusDot** (`statusDot`): a static dot for idle, running, success, warning, attention or error.
- **Meter** (`meter`): a small bar filled to a percent in a status tone (`normal`, `warning`, `critical`); `setMeter`
  changes it.
- **InputFrame** (`inputFrame`): the frame around a text box.
- **Row** (`row`): a list or tree row, density `list` or `tree`.
- **Tabs** (`tabStrip`, `tab`): the strip on a sheet's top edge, and one tab. The `ui-tabs--scroll` strip scrolls
  sideways with no scroll bar when too narrow for its tabs, each tab keeping its full width.
- **Sheet** (`sheet`): the solid L2 content sheet.
- **Split** (`createSplit`): two panes with a drag handle, each pane with a least width and no most
  width; the start pane's width lives in `uiState`, written when a drag ends and on each keyboard resize. The
  shell's side bar resizes through the same split core. Three columns are two nested splits, the
  outer end pane's least width the sum of the inner two. Each handle draws the resize prompt
  `⌥⇧H ◂ ▸ ⌥⇧L`, centred on it and taking no space, while the pointer is over it, while a drag runs
  and for a moment after each keyboard resize. A view that drops a split calls its `dispose`.
- **HScroller** (`createHScroller`): a row that scrolls sideways, with a `sheet-background` IconButton chevron lying over
  each end, taking no space so overflow moves no item, that scrolls by one item and hides while nothing lies further
  that way, and a `reveal(item)` that scrolls an item into view.
- **Card** (`card`, with an `attention` or `error` edge) and the collapsible card
  (`createCollapsibleCard`), whose `plain` variant is a one-line row with no card chrome that opens
  its body in place under it.
- **FloatingPanel** (`floatingPanel`, opened with `openFloatingPanel`): the L3 glass panel.
- **Dialog** (`createDialog`): a modal over the `scrim`.
- **EmptyState** (`emptyState`): one line saying what to do, then the key that does it.
- **SectionHeader** (`sectionHeader`): a section's heading with a trailing slot.
- **DragReorder** (`createDragReorder`): drag to reorder over one or more drop zones, each a list of keyed items
  (`ui-drag-reorder-item`, dragged by a source element inside it); the item where the drop would land carries
  `is-drop-before` or `is-drop-after`, an unordered zone (`ui-drag-reorder-zone`), or an ordered one holding no other
  item, carries `is-drop-target`, and the dragged item `is-dragging`. A drop reports the item's key, the zone and the index it lands at among the zone's
  other items (0 in an unordered zone), so the view, not the primitive, changes the order. It acts only on drags it started, so file drops
  pass by. A view that drops it calls its `dispose`.

Icon stays the Codicon builder `icon`.

Conventions every primitive follows:

- A builder returning an element is a noun (`chip`); one returning a handle is `create<Name>`.
- Root class `ui-<name>`, parts `ui-<name>-<part>`, variants `ui-<name>--<variant>`.
- A composite primitive's element can carry another primitive's class (the dialog panel carries
  `ui-floating`, the collapsible card carries `ui-card`). Its overriding rules use the compound
  selector (`.ui-floating.ui-dialog`, `.ui-card.ui-collapsible`), which outranks either class
  alone, so they win whatever order the stylesheets load in.
- States are classes `is-selected`, `is-active`, `is-cursor`, `is-disabled` (a button's
  `disabled` attribute), `is-no-target` (an edge prompt or anchor with nothing to act on) and DragReorder's
  `is-dragging`, `is-drop-before`, `is-drop-after` and `is-drop-target`; an
  enumerated value is `data-<name>`; `is-hover` and `is-pressed` exist only so the gallery can show
  those states.
- Buttons never take focus.
- A hint is an anchor element handed in, which the core fills.

## Surfaces

Each surface below is the look of its owner's built-in `default` layout (`docs/features/layouts/design.md` lists
each owner's parts); a user layout redraws any part, and a part keeps these rules.

- **Title bar:** L1, `toolbar-height`, draggable; the shown mode's context centred; actions on the
  right as `icon-button` buttons when a feature contributes one: the Keys button with its
  `Space ?` prompt inside it (hidden at 640px window width and narrower, where the bar's end track is too
  narrow for it), and while a config file is broken an error-tone Tag badge naming it; in the dev
  app, a neutral Dev tag at the start. The OS window buttons stay native.
- **Activity bar:** L1, icons only; the shown mode carries a 2px accent mark on its window-side edge.
- **Side bar:** L1 dense glass. Sessions mode's rows sit in project groups under Favorites and Recent sections. Rows are `row-tree` or `row-list`; hover fills with
  `list-hover-background`; the selected row takes `list-active-background` and `fg`; the keyboard
  cursor adds the focus ring. In a split whose panes each keep a selection (Settings mode, the docs
  tree, the primer popup's tasks and items columns), the pane without focus marks itself `is-pane-inactive` and its selected
  row takes `list-inactive-selection-background` instead, so the pane the keys act on reads at a glance.
  Sessions mode's rows are compact cards, `card-background` under a `card-border` hairline with `radius-md`,
  `space-1` apart within a group: the title and activity's label on the first line (a Tag for Needs you and Error, `status-running` text for Working, `fg-tertiary` text for Done; an activity with an emphasis takes a Tag and a status edge at `indicator-width` on the card's start: `urgent`, Needs you, fills its Tag with the status colour over `fg-on-accent`, the one solid status fill, `raised`, Ready to make and Closed, keeps the tint, and a success Tag opens on a check), and a second line holding other
  plugins' row parts on one line that never wraps, the context bar, the run time and the cache mark at its end in slots of fixed least width, so the bars line up from row to row, gone while empty. Hover
  strengthens the border to `border-strong`, and the selected card takes `list-active-background` with an
  `accent-tint-strong` border.
- **Right bar:** L1 dense glass beside the content sheet in every mode, opening at `rightbar-width` and then the
  user's width (by drag; it carries no resize keys); hidden while no plugin contributes to it. In a window too narrow
  for both bars, the side bar narrows to its least width first, then the right bar to its own; with too little room left
  for its least width and the sheet's, it lies over the sheet's end at its least width. Rows and hover follow the side
  bar.
- **Tabs:** sit on the top edge of their sheet. The active tab is solid sheet colour with a 2px
  accent top mark; others are transparent in `fg-secondary`.
- **Status bar:** L1, `statusbar-height`, `text-12`, shown only while a plugin contributes to it;
  the usage plugin does (below). Status colours only on status items. A status belongs on the surface it
  describes: a form's saved state on its rail header, a config problem on the title bar.
- **Usage:** the status-bar line is always on and aligned to the end, in `text-12`: every profile stacked, one
  line each, its name in semibold `fg-secondary` before its plan rows, each a label, a meter and its percent in the
  server's order, each limit in a column shared across the profiles so its meters line up. A Chat session's context bar and cache
  countdown draw in the context line above its box, and its spend in its Chat status line. With the
  optional `usage-tab-line` plugin on, each session's line also sits in its own tab bar,
  after the tabs and before the pane controls, in `text-12`: its context bar (`used/limit` against the autocompact
  limit), its cache countdown and its spend. In a narrow bar the line drops whole items from its end (spend, then cache,
  then the context text), never part of a number, keeping its context bar and a `space-2` gap before `⌘W`. A session
  with no usage yet draws a zero line, its context `0k`. While the session compacts, the line opens with a
  `compacting` chip (`compacting · auto`) in `accent-tint`, which ellipsizes when too narrow to fit beside the context
  bar; in a tab bar the slot keeps room for the bar and a few of the chip's characters, and the strip scrolls instead.
  Its context bar pulses at `duration-pulse`, unbroken across redraws, static under reduced motion. A meter takes the existing status colours by the server's severity (`normal`,
  `warning`, `critical`); the context bar by its share of the limit
  (`warning` from 70 %, `critical` from 90 %). The context bar carries no label; a stale profile's rows and a note
  (`plan loading`, `plan unavailable`) draw in `fg-tertiary`. The details bar
  (right bar, `Space v u`) is a card per profile, each a header (the name, its muted `text-12` freshness beside it —
  `updated <ago>` from the poll's time, or `stale, last good <ago>` — and the default profile's tag at the end) over
  its rows with reset times, extra usage as `spent / limit` in its currency, and the poll's error in `status-error`;
  with no profile it holds a muted `No profiles` line. A meter's percent is never narrower than `100%`, so the meters
  line up from row to row. In the status line and the details, the 5h and Week rows always show; any other row (a
  model-scoped limit) shows only while used, and extra usage only while on and spent.
- **Profile:** every session row whose harness the app runs opens its row parts' line with a neutral Tag naming its
  profile: the name chat's profiles setting gives the session's config folder (`work`, `personal`), else the folder's
  last segment. A session with no config folder of its own counts as its harness's default folder.
- **Unity pool:** a session row holding a pool clone carries a neutral Tag, `Unity 3`, in its row parts' line, and
  one waiting in a pool's queue an `attention` Tag, `Unity: queued 2nd`; one Tag per pool. While the shown session is
  in a pool, the right bar holds the pool panel after the usage details: a section header `Unity pool · <pool>`, a
  `text-12` `fg-tertiary` summary of the counts (`3 free · 1 held`: free always, the rest while not zero), then a
  two-column grid of `card-background` `radius-md` tiles, one per clone. A tile's head holds its StatusDot (`success`
  free, `running` a session's, `idle` the user's hold, `warning` stranded or dirty with no holder), its title, and at
  its end the Hold button (`ghost`) or Release button (`secondary`), disabled while its run is in flight. Under the head
  in `text-12`: the branch in `font-mono`, wrapping anywhere; the editor's state in `fg-tertiary` with a `warning`
  `dirty` Tag while the tree is dirty; then `Free` in `status-success`, or `Stranded` in `status-warning` and the holder
  (a session's row label in `fg-link`, a click selecting its row; `Held by you` or `session <id>` in `fg-secondary`).
  Each only while it applies, the tile then shows an open handoff's time left, a stranded mark's reason in
  `status-warning`, a warm-up in `status-running` while it runs or a `warning` icon and `not warmed` in `status-warning`
  once it failed, its error in the tooltip because a failed warm-up blocks no claim, and the last Hold or Release's
  result (`status-error` for a failure). While a queue ticket waits long, each clone that blocks the queue takes the
  `status-attention-tint` fill and edge and shows `idle <time>`. The queue follows under a `Queue` section header, one
  row per ticket: its position, the waiting session, its branch in mono and `waited <time>`; no queue draws no header.
- **Popup:** a session's form (round or primer) is an L2 content sheet raised over the session's tabs, with no shadow
  (§ Separation): `sheet-background`, `radius-lg` on its top corners, its top edge at the `sessions.popup-top` token
  (`15%` of the frame's body), the tab under it dimmed by the `scrim`. It slides up on open and down on hide over
  `duration-slow`; hidden, a slim bar at the frame's bottom names it (`docs/features/session-popups/design.md`).
- **Forms:** the rail is the start pane of a split in the session popup's sheet, on the sheet colour with no fill of its own. Its header holds the
  open count, the saved state and the `⌥P ◂ ▸ ⌥N` edge prompt. Cards are `card-background` with
  `radius-md`. The recommended choice carries the accent, since Enter accepts it.
- **Primer:** the primer popup is three columns, tasks | items | card: tasks and items open `240px` wide and the card takes the rest. The
  tasks column holds the feature row and the tasks, grouped under section headers (Primer, Every feature, Extra
  tasks), each task row carrying its need as a Tag and its included items as a count. The items column lists the
  selected task's items as rows with a ToggleMark, or an empty state on the feature row and on a task with no items.
  The card column shows one card for the focused column's selection: a task card (context, add-item and task
  comment) or the feature card while the tasks column has focus, an item card (the item, its ToggleMark and its
  comment box) while the items column has focus. A review pane of every answer opens before it sends.
- **Chat:** user turns are a `card-background` block, not a bubble. Assistant prose is markdown on
  the sheet. The transcript shows the messages, permission prompts, notices, turn dividers and pending rows only: the agent's steps
  (tool calls, thinking, raw events) show in the **session hub**'s **activity dock**. The hub is
  a `264px` column beside the transcript, on `block-background` with a left `border-default` line, hidden in a Chat tab
  under `640px` and by `Space v s`. It stacks titled sections: each a `text-12` semibold `fg-tertiary` title with a
  chevron and a tabular-numeral summary at its end, over its content; a click on the title collapses it, and a
  `border-subtle` line parts the sections. Main agent holds the dock, Plan the workflow side pane, Skills one row per
  skill and agent (the name in mono, a Tag for `main` or the subagent), and Session one row per fact (a dim label, its
  value ellipsized). While the hub is not visible, the composer's **activity line** shows the dock's header on one line,
  or its finished line; while the hub is visible and the turn runs, the transcript's **turn line** shows that header
  under the last entry in `fg-tertiary`. While the session
  works on a turn, the dock shows a header (the turn's time as `m:ss` in tabular numerals and a state word,
  `1:05 Working…`), a `radius-md` card listing the main agent's latest three tool calls in mono (the newest in `fg`,
  the older ones in `fg-tertiary`, a failed one in `status-error`), and the main agent's tool counts, dim
  (`Read 3 Bash 2 Edit 1`). When the turn ends, the dock shrinks to one dim `fg-tertiary` line, such as
  `Done · 1m 05s · $0.57 · Bash 6 · Read 2`, its time compact in tabular numerals, and keeps it until the user sends
  the next message; with no finished turn to show it takes no space. While the session compacts, the dock's header
  reads `0:06 Compacting…` with the trigger after it in `fg-secondary`, ellipsized when narrow (`auto · cache cold · 182k`, `/compact`,
  `autocompact`), over a thin indeterminate bar in `status-running`, and no tool card. A message held for a compaction is
  a pending row reading `sends after compaction · ⌃C skips`. A finished compaction leaves a divider in the
  transcript: a centred dim `text-12` line between two `border-default` rules, `Compacted 182k → 24k · auto · 9s`
  (`Compacted 182k` until the after-size is known). A turn's result leaves the same divider with `space-3` above and
  below, `Turn ended · 14m 22s · 31 steps`: the stop reason replaces the words unless the turn finished normally, and
  the time and the steps show when known. A chat layout that sets `activityInTranscript`
  draws the steps in the transcript again, each run between two other entries as one **activity line**: one dim
  `fg-tertiary` line, live or finished: the step count and the tools used, such as
  `6 steps · Read 3 · Bash 2 · Edit · 42s`, with `· 1 failed` in `status-error` before the time when a step failed.
  The time is compact in tabular numerals (`8s`, `1m 05s`, `1h 02m`) and dim; a live line's ticks once a second. An
  opened activity line lists one plain row per step (the plain collapsible: a tool's status dot and its mono
  summary, `Thinking`, `Raw event`), and a step row opens its input and result in place under it,
  with no card. Permission prompts are cards with a
  `status-attention` edge and plain verbs (Allow once, Deny). The composer floats (L3,
  `radius-xl`, inset `space-3`) with the transcript scrolling beneath it, and holds, top to bottom: other plugins'
  composer parts (the workflow strip, the agent strip, the context line), `space-2` apart, the activity line, the strip of attached images' thumbnails, the box (no mode
  label: the cursor's shape shows the vim mode), and the status line, drawn in this order: repo and branch in `fg-secondary`, the `i`/`a`
  type hint (then `J`, `K`, `V` and `y` with no labels), one model · effort chip, every other control's chip, the status parts other plugins add (usage: spend),
  then the running indicator, which ends the line on whichever row it wraps to. The **context line** is a Meter that fills the composer's width, then `58k/300k` and
  `cache 59m` in `text-12` tabular numerals.
  The **agent strip** holds its subagents as an HScroller of cards, each a `card-background` Card with `radius-md`,
  heading with a running StatusDot, its name, a kind Tag and its elapsed time, then its description, `model · effort` in
  `fg-tertiary`, its latest three tool calls in mono on `block-background`, the older two fading, and a context Meter
  (`status-warning` at 80% or more), `84k/200k` and its cost. Its tasks stack under the cards as rows, one `text-12` line
  each: a running StatusDot, the Shell Tag (Task with no command), the command or else the description in mono, ellipsized (wrapped whole while open), and its elapsed
  time; past four rows they scroll. A box leaves when its subagent or task ends; the selected box takes the focus ring.
  A user turn shows its sent images
  as thumbnails under its text.
- **Visuals:** an agent's html block in any markdown. While it streams it is a Card holding a running StatusDot and
  `drawing visual…` in `text-12` `fg-secondary`. Once closed it is the inline box: the frame as wide as its column in a
  `radius-md` box that clips it, over a bar holding the small expand icon button at its end, the button's `v` hint on
  a chat entry's first visual only. The full-size overlay sits over the `scrim` with `space-8` padding: the overlay
  body fills it, a `radius-lg` sheet on `transcript-background` that scrolls a visual taller than the window, with the
  count (`2 of 3`, `text-12` `fg` in tabular numerals) under it, hidden for a single visual.
- **Docs:** in Docs mode the tree is the side bar; in the optional `docs-session-tab` plugin's session Docs tab it is the left pane of a
  split in the sheet. Rendered docs use the prose style; code blocks are solid `block-background`
  with `radius-md` and no border. The page draws through a frame of article and right column; the column holds On this
  page and Linked from and sticks while the article scrolls.
- **Settings:** in Settings mode the sections are the side bar; the open section is one sheet of `row-list` rows,
  each a label in `fg`, its description in `fg-secondary`, and its value or binds at the end, Kbd for keys. A row the
  user set carries a neutral "Set" Tag and the default in `fg-tertiary`; a box opens in place inside an InputFrame,
  its check message under it in `status-error`. A file that fails its check shows an error Card at the section's
  top.
- **Workflow:** three parts, each drawn by the `default` layout of the session's workflow, Light's, Medium's or Heavy's
  own (`docs/features/workflow/design.md`). The chip is one line under a session row: the level's badge, one letter (L, M
  or H) in the plugin token `--wg-workflow-light-badge` (default `status-info`), `--wg-workflow-medium-badge` (`accent`)
  or `--wg-workflow-heavy-badge` (`status-warning`), then the stage and its status as an accent Tag, unless the row's
  label says it, and Heavy's countdown; an idle session draws no stage, and on a row too narrow for the chip the row's usage bar shrinks away first, then the chip's tag ellipsizes; a session that finished a turn with no
  workflow started draws one error Tag, `No workflow`, in `status-error`. The strip sits above the Chat composer: the stepper, the countdown and the main action as a button. The stepper is a
  trail of step words with no marks, a `›` in `border-strong` between them, wrapping on a narrow pane: pending in
  `fg-tertiary`, done in `fg-secondary`, running in `accent` semibold with its word pulsing at `duration-pulse` (still
  under reduced motion), paused in `fg` semibold, ready in `accent` semibold. A stage outside the stepper draws its status
  mark and line instead. Every stage's strip keeps the height of a line
  holding the action and starts on the composer's left edge; an idle session draws no strip. The side
  pane sits beside the transcript from the first read of a plan (Heavy) or the agent's first checklist: the status mark and line (pending in `fg-tertiary`,
  running in `status-running`, ready in `accent`, paused in `status-warning`, done in `status-success`), the stage's
  detail, a progress meter, the checklist and every action as buttons. Heavy's checklist, titled `Plan`, folds finished waves into one
  toggle row, shows the current wave under its header with a mark per task (filled once done), and lists later waves
  one row each under `Up next`, all on the pane's left edge. Light's and Medium's pane, titled `Checklist`, draws the status
  mark and line, a `<checked>/<total>` line, the progress meter and one flat list with a mark per item, and no actions. An idle session, a session with no plan or checklist and a hidden pane draw no pane. A
  disabled action draws disabled.
- **Floating:** pickers, which-key, help and dialogs use the floating material with `row-list` rows
  and key hints right-aligned in `fg-tertiary`; dialogs, chat's full-size image viewer and the full-size visual
  overlay sit over the `scrim`. A `/` completion row's description is `fg-tertiary`, one line, in the UI font inside
  the mono list.
- **Empty states:** one line saying what to do, and the key or action that does it. No
  illustrations.
- **Splits** resize by drag and by `Alt+Shift+h`/`Alt+Shift+l` (`docs/keymap.md`), the side bar too, and
  stacked chat panes by `Alt+Shift+j`/`Alt+Shift+k`; the right bar and the session hub by drag alone; the app keeps the sizes.

## Icons and copy

- **Codicons**, one family, `icon-size`, `fg-secondary` at rest and `fg` on hover or when active.
- **Copy is sentence case with plain verbs.** A button says what happens ("Run agent", "Save
  file"); the toast echoes it ("Agent started", "Saved"). An error says what happened and what to
  do next, without apology. A button label stands alone, with no trailing arrow.

## Checks

- `npm run lint` runs `scripts/check-styles.mts`: no raw colour, length, duration or font stack in
  CSS or inline styles under `src/`, and `backdrop-filter` only in `materials.css`. Inline styles
  are judged through the TypeScript AST. The script judges every file under `src/` and takes no
  argument.
- A self-test step's `screenshot` field saves a PNG of the window to
  `.selftest/screenshots/<plugin>-<name>.png`. The self-test saves the gallery's pages
  (`forms-gallery-full-0` for the opening page, `forms-gallery-full-1` onward for each page press,
  `forms-gallery-reduced-0`, `forms-gallery-reduced-1` onward), Sessions (`forms-sessions-*`) and
  Docs (`docs-docs-*`) in both transparency settings, the docs kind picker, completion list and
  session Docs tab (`docs-kind-picker`, `docs-completion`, `docs-session-tab`), the shell layout
  swap (`forms-shell-layout-*`) and the layout previews (`forms-preview-*`, `primer-preview*`,
  `chat-chat-preview`), chat's visuals (`chat-visuals`) and the workflow strip and side pane (`workflow-heavy-strip-*`, `workflow-heavy-side-pane-hidden`, `workflow-light-*` and `workflow-medium-*`). The
  gallery's and the keys plugin's main parts hand no self-test script, so forms' script saves the gallery's pages and
  the shell swap, and no screenshot shows keys' overlays. The agent checks them against
  this file — density, the one accent, each surface on its layer
  and material, sentence case — before handing a UI change to the user.
- Text meets WCAG AA contrast against its opaque fallback background, in both transparency
  settings.
- Scrolling the transcript beneath the composer stays smooth; when blur is expensive, lower the
  blur radius before the opacity.
- The user runs the final visual check in a visible `npm start`.
