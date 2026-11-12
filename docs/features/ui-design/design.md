# UI design rework — design

**Contents**

- **Intent** — what the rework is for, and what a good outcome looks like.
- **Plans** — the three plans and what each one lands.
- **Theme and tokens** — what a theme file owns, token kinds, names, plugin tokens, code colours.
- **Config files and hot reload** — the user config folder, the ConfigStore, the layered keymap.
- **Shell** — the registry, the default layout, the title bar, the activity bar, mode side bars, splits.
- **Primitives and the gallery** — where primitives live, which ones, the gallery mode, screenshots.
- **Surfaces** — how each existing surface maps to a layer.
- **Keys** — the key philosophy and the key changes it brings.
- **Packages** — the third-party packages the user approved, and how each enters the app.
- **Out of scope** — what stays a follow-up, and why.

The decision record behind the UI rework. `DESIGN.md` at the repo root holds the standards every
view follows; this file holds why the rework is shaped the way it is, so a later change does not
reopen a settled choice by accident. The user's starting brief (an agent-written `DESIGN_REWORK_BRIEF.md`,
`DESIGN.md` and `tokens.css`) was reference only; where this file and the brief differ, this file
holds the user's decision.

## Intent

The app had no design rules. The rework gives it a design system in the lineage of VS Code and
JetBrains Fleet, with the agent-GUI transcript model, in Catppuccin Mocha with light glass on the
chrome. The user must still be able to rework the structure and the theme easily, as before: the
theme is a file, the shell layout is one replaceable module, and every look a view has comes from
tokens and shared primitives.

## Plans

Three plans in this folder, run in order. Each one leaves a working app.

1. **Plan A — foundation.** The ConfigStore (user config files, everything hot reloads, the layered
   keymap), the theme model and token registry, plugin-declared tokens, the shell registry with the
   title bar, activity bar and mode side bars, the chord formatter, the token rename across
   every existing CSS file, the Icon primitive with `@vscode/codicons`, the Catppuccin Mocha code
   colours (copied into `code-colours.ts`, no package), the `uiState` service, and Mocha's final
   values. The structure stays as it was and the colours change.
2. **Plan B — primitives.** Landed: `DESIGN.md`'s primitives in `src/shared/page/ui/`, the gallery
   mode, the self-test screenshots, the style check (`scripts/check-styles.mts`), and
   `@fontsource/jetbrains-mono`.
3. **Plan C — surfaces.** Landed: every existing surface rebuilt on the primitives (chrome, floating
   surfaces, Sessions, the session popup (form) with its rail as a split, Chat with the floating composer, Docs
   with its tree in the side bar and in a session's Docs tab, later moved to the optional `docs-session-tab` plugin), the key changes below, the editor's
   active-line band, and the style check judging every file. The agent ran every live check the drive
   run (`npm run drive`) reaches in agent-drive's final verification; the two it could not reach
   are in [followups.md](../followups.md).

The design skills (Impeccable's critique, audit, polish and quieter guidance, and ui-skills'
baseline-ui, fixing-accessibility and fixing-motion-performance) become their own feature in
wigley-ai-marketplace, tailored to read a project's `DESIGN.md`. These plans do not depend on them.

## Theme and tokens

- **A theme file owns every token**: colours, glass materials, the backdrop, spacing, radii, sizes,
  the type scale and motion. The user can then make a compact or rounder theme without touching code.
- **A user theme extends a base.** The built-in `catppuccin-mocha` lists every core token. A user
  theme sets `extends` to a theme name and lists only the tokens it changes. Today every theme had
  to list every token.
- **One token registry.** Every token declares a kind: colour, length, duration, number, shadow,
  filter, or raw CSS (the backdrop gradient, easing curves, font stacks). Core tokens declare a
  kind only, and a base theme sets every one, so the theme file holds each core value. Plugin
  tokens declare a kind and a default, so a theme written before the plugin still loads. The
  loader checks each value by its kind, and `applyTheme` walks the registry. Core tokens are the
  design-system roles; each plugin declares its own in its manifest's `themeTokens`, qualified
  `<pluginId>.<token>`. A theme may set a plugin token; a missing one takes its default.
  This retires `whichKey.*`, `origin.*` and `severity.*` from the core list.
- **Names.** The brief's role names with the `--wg-` prefix (`--wg-fg`, `--wg-fg-secondary`,
  `--wg-accent`, `--wg-material-chrome-bg`). The theme JSON key is the name without the prefix
  (`fg-secondary`). A plugin token `forms.origin-caused` is `--wg-forms-origin-caused`. The prefix
  keeps the app's variables apart from CodeMirror's and any library's.
- **Aliases.** A colour token may name another as `var(--wg-<name>)`, which the loader checks
  exists.
- **Colour values** are a palette name, `#rrggbb` / `#rrggbbaa`, or a palette name with alpha
  (`"mauve / 0.16"`), which keeps the palette link that tokens.css kept with `rgb(var(--x-rgb) / a)`.
- **Reduced transparency** is a `reduced` block in the theme: token overrides applied while
  transparency is reduced (the setting, or the OS preference under `system`). It sets
  `data-transparency` on `<html>`.
- **Colour scheme** is the theme's `colorScheme` (`dark` for Mocha), so a Latte theme later needs no
  model change.
- **Font settings win over the theme** when set: `fonts` in `settings.json` are optional overrides of
  the theme's font family and base-size tokens. Mocha gives UI 13px, mono 13px and prose 14px.
- **Code colours** are the Catppuccin Mocha highlight style (the user's choice over theme-driven
  syntax tokens), in the editors and in rendered markdown code blocks. `@catppuccin/codemirror`
  exports only whole editor extensions, which would also override the editor's token-driven
  surfaces and give markdown blocks nothing to use, so its Mocha tag map is copied into one module
  in the codemirror-vim adapter with its MIT credit, and the package is not installed. The theme's
  `syntax.*` tokens and `syntax.css` go. Code colours stay Mocha under any theme; that is accepted.
- **Raw values live only in theme files.** CSS reads tokens. CSS cannot read a variable in
  `@media`, so breakpoints stay raw and `DESIGN.md` lists them. `0`, `1px` hairlines and percentages
  are allowed, as are `fr` tracks, viewport units and unitless numbers. `scripts/check-styles.mts`
  enforces this in `npm run lint` over every file under `src/`.
- **Backdrop.** The L0 backdrop is CSS (crust plus two faint washes) on both OSes. Native vibrancy
  (macOS) and mica (Windows 11) stay a follow-up behind a window adapter: one path keeps contrast
  checkable and the offscreen self-test faithful.

## Config files and hot reload

- **Folder:** `~/.config/wigley-ai-gui/` on both OSes (`%USERPROFILE%\.config\wigley-ai-gui` on
  Windows): `settings.json`, `keymap.json`, `themes/`. The user edits these by hand and may keep
  them in git, so a plain fixed path beats Electron's data folder. The self-test uses a folder in
  its temp home.
- **The ConfigStore** is one main-side module behind `current()` and `onChanged()`. It watches the
  folder through the `Files` service, parses, layers and validates, keeps the last good config on a
  broken file and reports the problem, and tells its listeners each new `AppConfig`, which
  `main.ts` pushes to the page over the Bridge. The theme loader is pure: the ConfigStore reads the theme files through `Files` and hands their
  text to it.
- **settings.json** is a partial override deep-merged over the defaults; plugin settings sit under
  the plugin id. A setting read only when something is created (window size, the claude command)
  applies to the next window or session; every other setting applies live. Transparency is a core
  setting: `system`, `full` or `reduced`, default `system`.
- **keymap.json** layers over the defaults (the default keymap `src/plugins/keymap.ts`, then any
  manifest's `keys`, then the user file), in the default keymap's own entry format, so a line copies
  across: a user bind replaces a default with the same keys in the same scope, `unbind` entries
  remove a default, and `groups` names replace the same prefix's. Only a clash inside one layer is an error. The
  user changes one key without
  copying them all, and a plugin's new keys still arrive.
- **Everything reads live.** Plugins read `settings()` and `keys.keymap()` with `onChanged`, in both
  processes, in place of start-time snapshots. On a change the page re-applies the theme, re-installs
  page keys, remaps vim (`EditorHost.setKeymap`), and the keys plugin rebuilds help; main re-installs
  the menu, intercepts and global shortcuts.
- **Broken config** keeps the last good config and shows one title bar badge and a toast naming the
  file and the problem, the way a broken theme did. Fixing the file applies it.
- **Split widths** are app-written state, not config: a `uiState` page service backed by a
  main-owned file in Electron's per-user data folder.

## Shell

- **A registry.** The shell's areas are the fixed set `AreaName` names, placed by the
  `ShellLayout`; contributions carry an order and an alignment and return a `Disposable`, as does
  `shell.setLayout`. The core ships the default
  `ShellLayout` module (where each area sits, on token track sizes); a page plugin may replace it
  through the shell API. Reworking the structure is editing that module or adding a plugin: the
  structure changes rarely, and sizes are already themeable.
- **Areas:** title bar, activity bar, side bar, main (the content sheet), panel, status bar, overlay.
- **Title bar.** The native title bar is hidden; the OS window buttons stay native (macOS
  `titleBarStyle: 'hiddenInset'`, Windows `titleBarOverlay`). The centre shows the shown mode's
  context, set through its mode handle (Sessions: the selected session's name and folder; Docs: the
  open doc's path). The right holds nothing until a feature contributes an action.
- **Activity bar.** A mode registers an icon and label; the activity bar shows every mode with the
  shown one marked. A click shows the mode; keys stay the main route.
- **Mode side bars.** A mode may hand a side bar element at registration; the core shows it in the
  side bar slot while the mode shows. `Space k s` / `Space k d` keep toggling it. Sessions puts its
  session list there; Docs mode puts its tree there.
- **Chrome parts.** The title bar's context, dev tag and config-problem badge and the activity bar's items draw
  through the shell's layout (the core setting `shell.layout`, `src/renderer/shell/shell-chrome.ts`); the areas and
  their arrangement stay the `ShellLayout`'s.
- **Splits** are resizable by drag; widths persist through `uiState`.

## Primitives and the gallery

- **Home:** `src/shared/page/ui/`, one builder per primitive with its CSS beside it, following the
  existing shared page builders (`dom.ts`, `list-picker.ts`).
- **Only what the existing surfaces use.** Each later feature adds its primitive to the gallery and
  `DESIGN.md`. A primitive built with no screen using it gets reworked when its first feature
  arrives.
- **Kbd** draws key hints through one `formatChord(token, platform)`: ⌘ ⌥ on macOS, Ctrl Alt on
  Windows. The page reads `platform.os` from the served config.
- **Icon** draws Codicons; it is the one module naming the icon font.
- **Layout kits** gain the primitives, so user layouts build from them too: forms' and chat's first, then every
  owner's, through the shared `BaseKit` (`docs/features/layouts/design.md`).
- **Gallery:** a `gallery` plugin (a page part, and a main part that only registers its layouts) adds a Gallery mode on `Space z g`
  showing every primitive in every state, with raw `t` in its scope to switch transparency. The
  switch is a page-only override (`PageApi.transparency`) that holds until the page reloads and
  never writes `settings.json`. `Space z s` swaps the shell to a test layout and back.
- **Screenshots:** a self-test step's `screenshot` field saves a PNG of the window to
  `.selftest/screenshots/<plugin>-<name>.png` (git-ignored) for the agent to check against
  `DESIGN.md`: the gallery's pages, Sessions and Docs, each in both transparency settings, and Docs' kind picker,
  completion list and session tab. The user
  still does the final visual check.

## Surfaces

| Surface | Layer | Notes |
|---|---|---|
| Title bar, activity bar, side bar, tab strips, status bar | L1 chrome | glass |
| Sessions list | L1, side bar slot | |
| Session tab content (Chat, Docs) | L2 sheet | tabs sit on the sheet's top edge |
| Session popup (round, primer, audio picker) | L2 sheet | raised over the tabs under the `scrim`, no shadow (`../session-popups/design.md`) |
| Forms rail | L2 | the left pane of a split inside the session popup |
| Chat transcript | L2 | user turns as tinted blocks; tool calls as collapsible cards with a status dot |
| Chat composer | L3 | floating glass, radius 14, 12px inset; entries scroll beneath it; holds the editor, the session controls as chips, and send |
| Docs mode tree | L1, side bar slot | the docs view hands back its tree and doc as two parts |
| Docs tab tree (in a session) | L2 | the left pane of a split |
| Which-key, help, pickers, dialogs, toasts | L3 | floating glass |
| Key hints | where each key acts (`docs/features/key-hints/design.md`) | each a KeyPrompt: a Kbd, the label in the UI font |

- Tool-call cards show a status dot and no duration: the harness reports duration per turn result
  only. Per-tool timing is a follow-up.
- Permission cards say **Allow once** and **Deny**; Always allow arrives with its follow-up.
- The recommended choice is marked with the accent, not peach: peach means "needs you", and Enter
  accepts the recommendation, so it is the primary action.

## Keys

The user's rule: **raw keys act on the focused scope, chords navigate the visible scope, the leader
changes scope or holds actions that need not be obvious.** Inside a text box raw keys cannot fire,
since vim owns them, so an action reached from a box keeps a leader route there.

How forms, chat and docs follow it:

- forms: raw `c` clear, `f` fix now, `u` follow-up, `s` leave it on the page, and raw digits
  choose; `<Leader>a…` stays in a text box.
- forms: there is no jump to question, since a digit key could not reach past item 9.
- forms: next and previous unanswered are `<A-n>` / `<A-p>`, page and box.
- forms: submit is `<D-Enter>`, as chat's send.
- chat: the session controls are raw `m` `e` `o` `c` in the chat scope; `<Leader>cm` / `ce` / `co` /
  `cc` stay in the composer box.
- docs' tree has `gg` / `G`; chat has `gg` beside `G`.
- Session rows are on `<A-S-o>` / `<A-S-i>`: the sessions list has no scope of its own, and the
  chords move between sessions from anywhere.

Mouse works everywhere; the keyboard is first. Buttons keep never taking focus, and the keyboard
cursor (the selected row, the focused box) always shows, drawn as the one focus ring. Browser Tab
focus is not added: a focused button would take Enter and Space from the page keys.

## Packages

Every package is bundled by Vite into the app, so nothing loads from the network at run time:

- `@vscode/codicons` (plan A) — the one icon set, behind the Icon primitive.
- `@fontsource/jetbrains-mono` (plan B) — weights 400, 500 and 600 only, imported in
  `src/renderer/renderer.ts`.

The code colours are the copied Mocha map in `code-colours.ts`, with no package.

## Out of scope

Each stays its own entry in `docs/features/followups.md`:

- Latte (light) theme and following the OS light/dark setting. The token model stays theme-neutral.
- The command palette. Plan B builds the floating list it will sit on.
- Layouts as a core service. This rework gave the forms and chat layout kits the primitives instead; the core
  LayoutService, `api.layouts` and the page host landed later (`docs/features/layouts/design.md`).
- Native window vibrancy and mica, behind a window adapter.
- Per-tool-call duration on chat tool cards.
- The runtime plugin loader, and unloading every registration. (The `Platform` record has landed.)
