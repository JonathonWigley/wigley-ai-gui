# UI design plan A — foundation — plan

Feature: UI design rework · Implements: none · Ticket: none
Target: main · Written: 2026-10-21

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Lay the base the UI rework builds on. Every surface keeps its structure, now reading the new tokens
with the brief's Mocha values:

- a user config folder (`~/.config/wigley-ai-gui/`) watched by a main-side ConfigStore, with a
  layered keymap, so every setting, key and theme hot reloads
- the theme model: a token registry with kinds, `extends`, palette alpha, a `reduced` block,
  `colorScheme`, plugin-declared `themeTokens`, and code colours from `@catppuccin/codemirror`'s Mocha map, copied into the app
- the shell as a registry with a replaceable `ShellLayout`, a title bar, an activity bar, and mode
  side bars
- the chord formatter, the `Disposable` type, the `uiState` service, the Icon primitive over
  Codicons, and every CSS file renamed onto the new tokens

Plan B (primitives) and plan C (surfaces) build on this plan's Produces.

## Architecture

Systems touched:

- **contracts** — `theme.ts`, `settings.ts`, `keymap.ts`, `bridge.ts`, `plugin.ts`, `editor.ts`, new
  `disposable.ts`, `ui-state.ts`, `platform.ts`
- **config** — `src/config/theme-tokens.ts` (new core token registry), `src/config/themes/catppuccin-mocha.json`,
  `src/config/settings.ts`
- **main** — new `src/main/config/` (ConfigStore), `src/main/themes/` (a pure resolver; the ConfigStore reads the files),
  `main.ts` composition root, `keybindings.ts` (re-install on change), `window.ts` (hidden title bar),
  `selftest-config.ts` (the self-test's layer over the served config; its temp home holds the config folder), new ui-state file owner
- **preload** — Bridge `onConfig`, ui-state calls
- **renderer** — `renderer.ts`, `theme.ts`, `shell/` (registry, `ShellLayout`, title bar, activity bar),
  `plugins/page-api.ts`, `page-keys.ts`, `codemirror-vim/` (`setKeymap`, catppuccin highlight)
- **shared** — `plugin-manifests.ts` (layered keymap), `key-hints.ts` (`formatChord`),
  `theme-variables.ts`, new `src/shared/page/ui/icon.ts`
- **plugins** — every plugin's `start` reads `settings()` / `keys.keymap()` live; forms and keys
  declare `themeTokens`; sessions and docs register mode icons, side bars and title context; every
  CSS file renamed onto the new tokens

## Preconditions

`wigley:make` re-runs each command before the first dispatch; a different result stops the run.

| Claim | Command | Expected (2026-10-21) |
|---|---|---|
| The docs written ahead are in the tree | `git merge-base --is-ancestor e1f6b73 HEAD && echo ok` | `ok` |
| The agent-chat resume run has closed, so no peer edits the chat plugin or `main.ts` under this run | `test -d docs/features/agent-chat/plan-b-resume && echo open` | prints nothing. On 2026-10-21 it printed `open`, with that run's uncommitted edits in `src/plugins/chat/`; this plan waits for it |
| No uncommitted source edits from another session | `git status --short src` | prints nothing |
| No user config folder exists, so the folder move breaks nothing | `test -e "$HOME/.config/wigley-ai-gui" && echo exists` | prints nothing |
| No user themes in the old place | `test -e "$HOME/Library/Application Support/wigley-ai-gui/themes" && echo exists` | prints nothing |
| The approved package resolves | `npm view @vscode/codicons dist-tags.latest` | `0.0.46-24` measured at plan time, re-verify; a newer version is fine |
| Node matches `.nvmrc` | `node --version; cat .nvmrc` | the same major |

The user approved `@vscode/codicons` for this plan (interview round 1), so its install in task 04 is
approved. `@catppuccin/codemirror` is not installed: its Mocha tag map is copied (follow-up round). No other package reaches the machine.

## Docs written ahead

Commit `e1f6b73` holds the docs this plan implements; task 07 re-reads them against the landed code.

- `DESIGN.md` — the design standard
- `AGENTS.md` — the shell, theme, key, setting, user config folder and self-test rules
- `docs/features/ui-design/design.md` — the decision record
- `docs/features/followups.md` — the items pulled into this feature removed, new follow-ups added

## Mandatory Reads

Every implementer reads these before its task:

- `AGENTS.md` (the only `AGENTS*.md` / `CLAUDE*.md` in the repo; no `.claude/rules/`)
- `DESIGN.md`
- `docs/features/ui-design/design.md`
- `docs/features/ui-design/reference/tokens.css` — the role names and values the user's brief
  gave; task 01 gives Mocha every value from it (the `reduced` overrides included), and task 07
  deletes it, leaving the theme file the one source of those numbers

## Design Overview

After this plan:

```
~/.config/wigley-ai-gui/              src/config/ (defaults, core token registry, mocha)
  settings.json  keymap.json  themes/        │
          │ Files.watch                       │
          ▼                                   ▼
  ┌───────────────────────── main ─────────────────────────────┐
  │ ConfigStore  current() / onChanged()                       │
  │   settings: defaults ⊕ settings.json (deep merge)          │
  │   keymap:   core → plugins (dependency order) → keymap.json │
  │   theme:    built-in or user theme, `extends` resolved,     │
  │             core tokens + plugin themeTokens, by kind       │
  │   problems: one per broken file; last good config kept      │
  │        │                         │                          │
  │        ▼                         ▼                          │
  │  menu / intercepts /       MainApi.settings() +             │
  │  global shortcuts          onSettingsChanged                │
  │  re-installed              (window size, claude cmd: next)  │
  └────────┬───────────────────────────────────────────────────┘
           │ Bridge: config() once, onConfig(push) each change
           ▼
  ┌───────────────────────── page ─────────────────────────────┐
  │ renderer: ThemeApplier.apply(theme, settings) → --wg-<name> │
  │           page keys re-installed, EditorHost.setKeymap      │
  │           problems → one status item + a toast              │
  │ PageApi: settings() / onSettingsChanged,                    │
  │          keys.keymap() / keys.onKeymapChanged, platform     │
  │ Shell registry ── ShellLayout (default, replaceable)        │
  │   titleBar │ activityBar │ sideBar │ main │ panel │ status  │
  │            │ mode icons  │ shown   │ shown│       │         │
  │            │             │ mode's  │ mode │       │         │
  │   centre: shown mode's context (ModeHandle.setContext)     │
  │ services.uiState ── Bridge ── main ui-state.json (userData)│
  └────────────────────────────────────────────────────────────┘
```

Decisions (from the interview, `design.md` holds the reasons):

- A theme file owns every token; a user theme `extends` a base and lists only what it changes.
- Token names are the brief's roles with the `--wg-` prefix; the JSON key drops the prefix; a plugin
  token `forms.origin-caused` is `--wg-forms-origin-caused`.
- Colour values: a palette name, `#rrggbb`, `#rrggbbaa`, or `"<palette name> / <alpha>"`.
- Font settings, when set, override the theme's font tokens.
- Code colours are `@catppuccin/codemirror`'s Mocha tag map, copied into one module with its MIT credit, in editors
  and markdown code blocks alike; the package exports only whole editor extensions, so it is not installed. The
  `syntax.*` tokens and `syntax.css` go.
- The ConfigStore keeps the last good config on a broken file and reports one problem per file.
- The keymap layers core → plugins → user; a later layer's bind replaces an earlier one with the
  same keys in the same scope; `unbind` removes one; only a clash inside one layer is an error.
- The shell is a registry; the default `ShellLayout` is one module a page plugin may replace.
- The native title bar is hidden; the OS window buttons stay native.
- Split widths are app state in `uiState`, never in the user's config.

Decided at plan time (no interview round; each follows from a settled answer):

- **The core token registry declares kinds only, no defaults.** A theme with no `extends` must set
  every core token, and the loader rejects one that misses any. Values then live in one place, the
  theme file (single source of truth); a plugin token still declares a default, since a theme
  written before the plugin existed must still load. Task 07 corrects `AGENTS.md`, `DESIGN.md` and
  `design.md`, which say every core token declares a default.
- **A colour token may name another token** as `var(--wg-<name>)`, as `tokens.css` aliases roles
  (`focus-border` is the accent). The user changes the accent once and every alias follows. The
  loader checks the named token exists.
- **Font overrides map to two tokens added for them:** `text-ui` (the UI base size) and `text-mono`
  (code size). `fonts.ui` → `font-ui`, `fonts.mono` → `font-mono`, `fonts.uiSize` → `text-ui`,
  `fonts.monoSize` → `text-mono`. `text-13` stays a fixed step of the scale. Task 07 adds the two
  names to `DESIGN.md` § Type.
- **One problems list.** `AppConfig.problems` carries a broken theme, settings file or keymap file
  alike; `ThemeChoice` goes.
- **The Icon primitive lands here**, not in plan B: a mode registers an icon, and the activity bar
  draws it. `@vscode/codicons` comes with it.
- **The code colours land here**, not in plan B: the `syntax.*` tokens go with the token
  rename, so their replacement lands in the same plan.
- **Mocha takes the brief's values in this plan**, every token `tokens.css` defines and its reduced-
  transparency overrides, so the rename lands on final values and plan B holds no value work.
- **Platform** in the served config is `'macos' | 'windows' | 'linux'`; `formatChord` prints Linux
  as Windows.

Out of scope (follow-ups in `docs/features/followups.md`): Latte and following the OS light/dark
setting; native vibrancy and mica; the full `Platform` record; the runtime plugin loader and
unloading every registration; the command palette; layouts as a core service. The look itself
(Mocha's final values, materials, primitives beyond Icon) is plan B; surfaces and key changes are
plan C.

## File Structure

### Shared names and signatures

Every name below is used by more than one task, or by plans B and C. A task's Produces repeats the
part it lands; this list is the spelling every task uses.

```ts
// Each heading names the producing task (← nn) and the users.

// src/contracts/disposable.ts (new, ← 02) — used by 02, 03, 04, plans B and C
export interface Disposable {
  dispose(): void;
}

// src/contracts/platform.ts (new, ← 02) — used by 03, 04, plan B's Kbd
export type Platform = 'macos' | 'windows' | 'linux';

// src/contracts/theme.ts (replaced, ← 01) — used by 02, 03, 04
export type TokenKind =
  | 'color' | 'length' | 'duration' | 'number' | 'shadow' | 'filter' | 'raw';
export interface TokenDecl { kind: TokenKind; default: string } // plugin tokens
export type ColorScheme = 'dark' | 'light';
// Every token resolved: keys are core names (`fg-secondary`) and qualified plugin
// names (`forms.origin-caused`); values are CSS text ready for a custom property.
export interface Theme {
  name: string;
  colorScheme: ColorScheme;
  tokens: Record<string, string>;
  reduced: Record<string, string>; // overrides while transparency is reduced
}

// src/contracts/settings.ts (changed, ← 01 but `platform` ← 02) — used by 02, 03
export type Transparency = 'system' | 'full' | 'reduced';
export interface Settings {
  window: { width: number; height: number; minWidth: number; minHeight: number };
  theme: string;
  transparency: Transparency;
  fonts: { ui?: string; mono?: string; uiSize?: number; monoSize?: number };
  keySequenceTimeoutMs: number;
  claude: { command: string };
}
export interface ConfigProblem { file: string; message: string } // ← 01
export interface AppConfig {
  settings: Settings;
  keymap: Keymap;
  commands: Record<CommandId, CommandInfo>;
  scopes: ScopeInfo[];
  pluginSettings: Record<string, object>;
  theme: Theme;                 // ← 01
  platform: Platform;           // ← 02
  problems: ConfigProblem[];    // ← 01 (served as []), filled by 02
}

// src/config/theme-tokens.ts (new, ← 01) — used by 02 (through main.ts), 06
export const coreThemeTokens: Readonly<Record<string, TokenKind>>;

// src/main/themes/theme-loader.ts (changed, ← 01) — used by 02
export interface ThemeFileText { file: string; text: string }
export interface ThemeTokenRegistry {
  core: Readonly<Record<string, TokenKind>>;
  plugins: Readonly<Record<string, TokenDecl>>;
}
export class ThemeError extends Error {
  readonly file: string; readonly problem: string;
  constructor(file: string, problem: string);
}
export function resolveTheme(name: string, builtIns: readonly unknown[],
  userThemes: readonly ThemeFileText[], tokens: ThemeTokenRegistry): Theme;

// src/renderer/theme.ts (changed, ← 01) — used by 03
export interface ThemeApplier {
  apply(theme: Theme, settings: Pick<Settings, 'transparency' | 'fonts'>): void;
}
export function createThemeApplier(root: HTMLElement,
  reducedTransparency: Pick<MediaQueryList, 'matches' | 'addEventListener'>): ThemeApplier;

// src/shared/theme-variables.ts (changed, ← 01) — used by 06
export function themeVariable(token: string): string; // `--wg-` + name, `.` → `-`

// src/contracts/keymap.ts (added, ← 02) — used by 07
export type KeymapUnbind =
  | { page: string[]; scope: ViewScope }
  | { editor: string; scope: ViewScope; mode?: EditorMode }
  | { app: string }
  | { global: string }
  | { intercept: Omit<InterceptBind, 'command'> };
export interface UserKeymap {
  page?: PageBind[];
  editor?: { leader?: string; remaps?: EditorRemap[]; binds?: EditorBind[] };
  app?: AcceleratorBind[];
  intercept?: InterceptBind[];
  global?: AcceleratorBind[];
  unbind?: KeymapUnbind[];
}

// src/shared/plugin-manifests.ts (`pluginThemeTokens` and `dependencyOrder` added; `mergeKeymap` already exists, so 02 changes its signature)
export function pluginThemeTokens(manifests: readonly PluginManifest[]):
  Record<string, TokenDecl>;                                              // ← 01, used by 02
export function dependencyOrder(manifests: readonly PluginManifest[]): PluginManifest[]; // ← 02
export function mergeKeymap(core: Keymap, manifests: readonly PluginManifest[],
  user: UserKeymap): Keymap;           // ← 02: existing 2-argument function (called at main.ts:187) gains `user`

// src/contracts/bridge.ts (added) — used by 03, 05
//   BRIDGE_CHANNELS.configChanged = 'bridge:config-changed'                      ← 02
//   Bridge.onConfig(listener: (config: AppConfig) => void): void                 ← 02
//   BRIDGE_CHANNELS.uiStateRead = 'bridge:ui-state-read', uiStateWrite = 'bridge:ui-state-write' ← 05
//   Bridge.uiState(): Promise<Record<string, unknown>>                           ← 05
//   Bridge.setUiState(key: string, value: unknown): void                         ← 05

// src/contracts/ui-state.ts (new, ← 05) — used by plan B's Split
// App-written view state that survives a restart, scoped to one plugin.
export interface UiState {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

// src/contracts/plugin.ts (changed)
//   PluginManifest gains `themeTokens: Readonly<Record<string, TokenDecl>>`   ← 01
//   PageApi.settings(): M['settings']                                          ← 03
//   PageApi.onSettingsChanged(listener: (settings: M['settings']) => void): Disposable ← 03
//   PageApi.keys.keymap(): Keymap                                              ← 03
//   PageApi.keys.onKeymapChanged(listener: (keymap: Keymap) => void): Disposable ← 03
//   PageApi.platform: Platform                                                 ← 03
//   MainApi.settings(): M['settings']                                          ← 02
//   MainApi.onSettingsChanged(listener: (settings: M['settings']) => void): Disposable ← 02
//   PageServices.uiState: UiState  (scoped to the plugin by the page API)     ← 05
//   AreaName = 'titleBar' | 'activityBar' | 'sideBar' | 'main' | 'panel'
//            | 'statusBar' | 'overlay'                                         ← 04
//   interface ContributeOptions { order?: number; align?: 'start' | 'center' | 'end' } ← 04
//   Area.contribute(element: HTMLElement, options?: ContributeOptions): Disposable ← 04
//   PluginAreas = Record<'titleBar' | 'panel' | 'statusBar' | 'overlay', Area> ← 04
//   interface ModeContext { title: string; detail: string | null }            ← 04
//   Mode gains `icon: string` (a Codicon name) and `sideBar?: HTMLElement`    ← 04
//   ModeHandle gains setContext(context: ModeContext | null): void,
//                    toggleSideBar(): void, sideBarShown(): boolean           ← 04
//   interface ShellLayout { mount(root: HTMLElement): Record<AreaName, HTMLElement> } ← 04
//   PageApi.shell: { setLayout(layout: ShellLayout): Disposable }            ← 04

// src/contracts/editor.ts (added, ← 03)
//   EditorHost.setKeymap(keymap: EditorKeymap): void

// src/shared/key-hints.ts (added, ← 03) — used by plan B's Kbd
export function formatChord(token: string, platform: Platform): string;

// src/shared/page/ui/icon.ts (new, ← 04) — used by plans B and C
export function icon(name: string): HTMLElement; // a Codicon by its name, `codicon-<name>`

// src/main/config/config-store.ts (new, ← 02) — used by 04 (the title bar overlay)
export interface ConfigStore {
  current(): AppConfig;
  onChanged(listener: (config: AppConfig) => void): Disposable;
}
```

Core token names: the semantic names in `reference/tokens.css` (every custom property but the
`--ctp-*` palette entries), with `focus-ring` drawn inset (DESIGN.md: 1px, inside), plus `text-ui`,
`text-mono`, `sidebar-width`, `traffic-light-inset` and `diff-changed-mark`, which `tokens.css` lacks (task 01's
document lists them). Task 01's registry is the
list; task 06's rename map reads from it.

### Existing files modified

- `src/contracts/{theme,settings,keymap,bridge,plugin,editor,highlight}.ts` — the shapes above
- `src/config/settings.ts`, `src/config/themes/catppuccin-mocha.json` (`src/config/themes/index.ts` unchanged)
- `src/main/main.ts`, `src/main/keybindings.ts`, `src/main/window.ts`, `src/main/selftest-config.ts`,
  `src/main/themes/theme-loader.ts`, `src/main/plugins/main-api.ts`, `src/main/claude-code/claude-code-harness.ts`
- `src/preload/preload.ts` (the Bridge)
- `src/renderer/renderer.ts`, `theme.ts`, `index.css`, `page-keys.ts`, `key-sequences.ts`, `editor-binds.ts`,
  `plugins/page-api.ts`, `shell/shell.ts`, `shell/shell.css`, `shell/modes.ts`, `codemirror-vim/` (host keymap,
  `vim-binds.ts`, highlighter, `editor-theme.ts`)
- `src/shared/plugin-manifests.ts`, `src/shared/key-hints.ts`, `src/shared/theme-variables.ts`,
  `src/shared/define-plugin.ts`, `src/shared/page/dialog.css`, `src/shared/page/markdown.css`
- every plugin's `manifest.ts` (`themeTokens`), the `main/start.ts` and `page/start.ts` that read settings or the
  keymap, and the services they feed (forms `forms-service.ts`, `autosave.ts`; chat `chat-sessions.ts`; docs
  `index-sources.ts`; keys' help, key bar, which-key and `keys-for.ts`)
- sessions `page/sessions-view.ts`, `page/tabs.ts`, `page/sessions.css`; docs `page/docs-view.ts`, `page/doc-view.ts`;
  every other `*.css` under `src/` (task 06)
- forms' and docs' `main/selftest-script.ts` (the self-test steps)
- `scripts/check-layers.mts` (new layers and package entries below), `package.json`, `package-lock.json` (the one
  approved package, task 04)
- `index.html` sits at the repo root and needs no change: its `default-src 'self'` covers the bundled icon font

### New files

- `src/contracts/disposable.ts`, `platform.ts`, `ui-state.ts` — seams more than one module crosses
- `src/config/theme-tokens.ts` — the core token registry, read only by main like the rest of `src/config`
- `src/main/config/config-store.ts`, `user-settings.ts`, `user-keymap.ts` (+ `config-store.test.ts`) — the
  ConfigStore, the module `AGENTS.md` names
- `src/main/ui-state/ui-state-file.ts` (+ test) — the main-owned ui-state file behind the Bridge
- `src/main/title-bar-overlay.ts` (+ test) — the Windows and Linux title bar overlay colours from the theme
- `src/shared/keymap-checks.ts` (+ test) — the keymap checks main and page both run
- `src/renderer/live-config.ts` (+ test) — the page's live config
- `src/renderer/ui-state.ts` (+ test) — the page's scoped `uiState`
- `src/renderer/shell/shell-layout.ts` — the default `ShellLayout`, the one module that places areas;
  `shell/activity-bar.ts`, `shell/title-bar.ts`, and `shell/shell.test.ts`
- `src/renderer/codemirror-vim/code-colours.ts` — the Catppuccin Mocha highlight style, copied with its credit
- `src/shared/page/ui/icon.ts` and `icon.css` — the one module naming the Codicons font

### Deleted files

- `src/renderer/codemirror-vim/syntax.css` — code colours come from `code-colours.ts`

### Boundary rules

- `scripts/check-layers.mts` keeps passing: `src/contracts` imports nothing; `src/config` is read only by main.
- A package has a single importer when `scripts/check-layers.mts` lists it under one layer's `packages` only:
  `@vscode/codicons` under `src/shared/page/ui` (task 04).
- New layers: `src/shared/page/ui` (task 04; `src/renderer` lists it, and a plugin's `page/` layer gains it when
  that plugin first imports a primitive), `src/main/config` (task 02), `src/main/ui-state` (task 05); `main.ts`'s
  layer lists the two main ones.
- No `process.platform` check outside the composition roots (`main.ts`, `renderer.ts`) and
  `window.ts`'s title bar options, which `main.ts` hands it.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Theme model and token registry](01-theme-model.md)

### Wave 2
- [x] [ConfigStore and the layered keymap](02-config-store.md) — after 01
- [x] [Token rename across every stylesheet](06-token-rename.md) — after 01

### Wave 3
- [x] [Live config on the page](03-live-config-page.md) — after 02

### Wave 4
- [ ] [Shell registry, title bar, activity bar, mode side bars](04-shell-registry.md) — after 03, 06

### Wave 5
- [ ] [uiState service](05-ui-state.md) — after 04

### Wave 6
- [ ] [Doc re-read](07-doc-re-read.md) — after 01–06

### Wave 7
- [ ] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: 17cf5935eb176577587a6a3c230e907efdef81c9

### Groups
- 01 · 943c502 · diff read + typecheck pass; lint fails only on DESIGN.md format (pre-existing) · concerns: highlighter test asserts definitionKeyword (same class as keyword); a `git rm` of syntax.css was reset to an unstaged deletion; `npx vitest` ran once (installed copy, nothing downloaded)
- 06 · 3da1dc1 · diff read + registry check + camel-case grep clean · concerns: workers skipped skills and mandatory reads (pure rename)
- 02 · 0cbd5d4 · diff read + typecheck pass; lint only DESIGN.md (pre-existing) · concerns: `registerGlobalShortcuts` unregisters all before registering, so a throwing user accelerator loses the earlier globals (the parser does not validate accelerator syntax); `npx vitest` ran once (installed copy)
### Contract changes
### Rulings
- `src/main/themes` layer allows no packages now that the loader is pure — task 02 reads files through `Files` in `src/main/config` — 02 would need `node:` back if it reads files there · group 01
- Alias cycles are also checked with `reduced` laid over `tokens` — a reduced override could close a cycle — a stricter rejection only · group 01
- `window-background` step 7 error names the file that set the value, as steps 3/5/6 do — consistent with the extends-chain rule — none · group 01
- Only colour tokens accept a whole-value alias; shadow/filter/raw accept one inside their text; length/duration/number reject one — the grammar table — a theme aliasing a length is rejected · group 01
- `code-colours.ts` keeps the tag list in a `MOCHA_TAG_STYLES` const: check-layers' `preProcessFile` reads an inline `define([` as an AMD import — none · group 01
- `theme-tokens.ts` registry carries `// prettier-ignore` so every key keeps its quotes (oxfmt would unquote four, breaking the count grep) — none · group 01
- `colorScheme` is checked on every theme in the chain that sets it — none · group 01
- `DESIGN.md` fails `oxfmt --check` at the review base (two unaligned tables); task 07, which owns `DESIGN.md`, formats it — lint stays red until 07 lands · lead
- dialog `.list-picker-item` rows take the list-* defaults (list-hover-background, list-active-background, focus-border) — rows, not buttons — a look tweak in plan C if wrong · group 06
- `src/main/config/config-json.ts` added (shared JSON reading for user-settings and user-keymap); `renderer.ts` import and `forms/manifest.test.ts` touched for the moves — one home, not a copy — none · group 02
- `dependencyOrder` treats a dependency not in the list as satisfied, leaving `startPlugins`' own error to report it — an unlisted dependency would read as a cycle otherwise · group 02
- `WindowKeybindings.setKeymap` checks commands before changing anything, so a bad keymap leaves menu and intercepts as they were — none · group 02
- Problems order: the watch problem first, then settings.json, keymap.json, theme files by path — none · group 02
- Only `themes/*.json` directly in the folder are read; an unreadable one is its own problem; a non-ThemeError from `resolveTheme` is a problem with file `themes` — none · group 02
- keymap.json messages beyond the task's table follow its style; unbind entries are not checked against known names — an unbind matching nothing is ignored · group 02
- A rebuild that throws unexpectedly logs `[config] config not read: …` and keeps the served config — none · group 02
- `vimrcLines` takes a required `unmapsLeader` parameter — needed for re-applying a changed leader — none · group 03
- `setKeymap` unmaps only mappings vim holds (read in `@replit/codemirror-vim-core` 0.1.0: unmapping one never made can delete a vim default) and rejects an untypeable insert key before unmapping anything — a throw leaves the old keymap whole — none · group 03
- `PageApi.keys.scopes` stays a property, now a getter over the current config — none · group 03
- `src/plugins/forms/page/editor-boxes.test.ts` gained `setKeymap` on its fake EditorHost (outside the Files line) — none · group 03
### Review rounds
### Test gate
