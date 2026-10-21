# 03 — Live config on the page

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     create `src/renderer/live-config.ts` · test `src/renderer/live-config.test.ts` ·
           modify `src/renderer/renderer.ts` · modify `src/renderer/page-keys.ts` ·
           modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts` ·
           modify `src/contracts/plugin.ts` · modify `src/contracts/editor.ts` ·
           modify `src/renderer/codemirror-vim/codemirror-vim-host.ts` · modify `src/renderer/codemirror-vim/vim-binds.ts` ·
           test `src/renderer/codemirror-vim/vim-binds.test.ts` · modify `src/shared/key-hints.ts` ·
           test `src/shared/key-hints.test.ts` · modify `src/plugins/keys/page/start.ts` ·
           modify `src/plugins/keys/page/help-view.ts` · modify `src/plugins/keys/page/key-bar-view.ts` ·
           modify `src/plugins/keys/page/help-sections.ts` · test `src/plugins/keys/page/help-sections.test.ts` ·
           modify `src/plugins/keys/page/key-bar.ts` · test `src/plugins/keys/page/key-bar.test.ts` ·
           modify `src/plugins/keys/page/which-key.ts` · test `src/plugins/keys/page/which-key.test.ts` ·
           modify `src/plugins/keys/page/which-key-controller.ts` · test `src/plugins/keys/page/which-key-controller.test.ts` ·
           modify `src/plugins/keys/page/keys-for.ts` · test `src/plugins/keys/page/keys-for.test.ts` ·
           modify `src/plugins/forms/page/start.ts` · modify `src/plugins/forms/page/autosave.ts` ·
           test `src/plugins/forms/page/autosave.test.ts` · modify `src/plugins/chat/page/start.ts` ·
           modify `src/plugins/forms/main/selftest-script.ts`
Consumes:  `Bridge.onConfig(listener: (config: AppConfig) => void): void` ← 02 ·
           `BRIDGE_CHANNELS.configChanged` ← 02 · `export interface Disposable { dispose(): void }` ← 02 ·
           `export type Platform = 'macos' | 'windows' | 'linux'` ← 02 · `AppConfig.platform: Platform` ← 02 ·
           `ConfigProblem { file: string; message: string }`, `AppConfig.problems: ConfigProblem[]` ← 01 ·
           the problem message wording in 02's table ← 02 ·
           `requireUnambiguousEditorBinds`, `requireUnambiguousBinds` in `src/shared/keymap-checks.ts` ← 02 ·
           `createThemeApplier(root: HTMLElement, reducedTransparency: Pick<MediaQueryList, 'matches' | 'addEventListener'>): ThemeApplier`,
           `ThemeApplier.apply(theme: Theme, settings: Pick<Settings, 'transparency' | 'fonts'>): void` ← 01 (`src/renderer/theme.ts`) ·
           the problems status item and start toasts task 01 leaves in `renderer.ts` ← 01 ·
           `parseChord`, `isChordToken` ← tree (`src/shared/chord-notation.ts`) ·
           `CommandRegistry.requireRegistered(ids: Iterable<CommandId>)` ← tree (`src/shared/command-registry.ts`) ·
           `createChordMatcher`, `createSequenceMatcher`, `createPendingTimeout`, `dropPendingKeys` ← tree (`src/renderer/`)
Produces:  `export function formatChord(token: string, platform: Platform): string` in `src/shared/key-hints.ts`
           `EditorHost.setKeymap(keymap: EditorKeymap): void` in `src/contracts/editor.ts`
           `PageApi.settings(): M['settings']`,
           `PageApi.onSettingsChanged(listener: (settings: M['settings']) => void): Disposable`,
           `PageApi.keys.keymap(): Keymap`,
           `PageApi.keys.onKeymapChanged(listener: (keymap: Keymap) => void): Disposable`,
           `PageApi.platform: Platform` in `src/contracts/plugin.ts`
           `export interface LiveConfig { current(): AppConfig; onChanged(listener: (config: AppConfig, previous: AppConfig) => void): Disposable }`
           and `export function createLiveConfig(initial: AppConfig, log: Log): LiveConfig & { replace(next: AppConfig): void }`
           in `src/renderer/live-config.ts`
           `installPageKeys(...)` returns `{ hold(): void; cancel(): void; setBinds(binds: PageBind[], timeoutMs: number): void }` in `src/renderer/page-keys.ts`
           `export function appliedMappings(keymap: EditorKeymap, groups: BindGroup[]): { keys: string; mode: EditorMode }[]`
           in `src/renderer/codemirror-vim/vim-binds.ts`
Decisions: see the sections below; each carries its source.
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass with the tests below;
           `npm run selftest` passes with the steps below; no `api.settings.` or `keys.keymap,` property read is
           left under `src/plugins/` (`grep -rn "api\.settings\.\|keys\.keymap[,)]" src/plugins` finds nothing).
           The final verification task (08) checks the live items in the report.
Commit:    one commit for the group

## The page applies each pushed config

`renderer.ts` registers `bridge.onConfig` before `await bridge.config()`; a push arriving before start
finishes is held, and the newest held one applies once start has run (drafter: a change during
start is never lost). `createLiveConfig(config, log)` holds the config; `replace(next)` sets it and then
calls each `onChanged` listener with `(next, previous)` in registration order, logging a listener's
throw as `[config] listener failed: <errorText>` and running the rest.

On each push, in this order (drafter: the checks first, so a refused keymap changes nothing):

1. When `keymap` or `settings.keySequenceTimeoutMs` differs (`JSON.stringify`): run
   `requireUnambiguousEditorBinds`, `commands.requireRegistered` over the new page and editor binds, and
   `pageKeys.setBinds(next.keymap.page, next.settings.keySequenceTimeoutMs)`, then
   `editor.setKeymap(next.keymap.editor)` when `keymap.editor` differs. A throw from any of them logs
   `[config] keys not applied: <errorText>` and leaves the page's keys as they were; the rest still applies.
   Main ran the same checks, so this is a guard against drift, not a path the user sees.
2. `applier.apply(next.theme, next.settings)` on the `ThemeApplier` start built (task 01): it rewrites every
   token, so a font override removed or a theme switched applies in full.
3. `live.replace(next)`: plugins' listeners run.
4. Problems: update the status item; for each problem not in the previous list (same `file` and
   `message`), `toasts.show('<file>: <message>', 'error')` and log `[config] <file>: <message>`.
5. Log `[config] applied a new config`.

Start shows the first config's problems the same way (status item, a toast and a log line each).

### Problems copy (pinned)

One status-bar item, class `status-error`, hidden while `problems` is empty; created once at start in
place of task 01's item (which shows `Config: <file>: <message>` and toasts `Config error: <file>: <message>`
once per problem at start); this task's text and toast below replace both:

| Problems | Text | `title` |
|---|---|---|
| 0 | hidden | — |
| 1 | `<file>: <message>` | the same |
| n ≥ 2 | `<n> config problems` | each `<file>: <message>`, one per line |

### `installPageKeys(...).setBinds`

Today the matchers are built once (`page-keys.ts:166`). After: the listeners stay installed once and
read the current chord matcher, sequence matcher and pending timeout. `setBinds` builds the new chord
and sequence matchers first (a throw leaves the old ones), then drops pending keys through
`dropPendingKeys` on the old matcher (reporting `[]`), then swaps in the new matchers and a new
`createPendingTimeout` with the new timeout. `hold` and `cancel` act on the current matcher.

### `EditorHost.setKeymap`

Contract text: "Replaces the keymap every editor follows, at once in every open editor and in every
editor created after. The caller has checked the keymap with `requireUnambiguousEditorBinds`."

In `codemirror-vim-host.ts`, `keymap` and `groups` become variables. With no editor hosted,
`setKeymap` runs steps 1 and 2 (neither needs an editor), skips step 3, and marks the keymap unapplied so the next
`hostView` runs the new `vimrcLines`. Otherwise it runs all three:

1. Remove each mapping `appliedMappings(oldKeymap, oldGroups)` lists with `Vim.unmap(keys, <mode>)`
   (`normal` and `insert` contexts); verify the call against `@replit/codemirror-vim` 6.4.0's source
   under `node_modules` (read only) before writing it.
2. `defineBindCommands(newGroups, hosted, run)`: each group's ex command or insert action is redefined
   under the same `exBindName(index)`; a name beyond the new count stays defined and unmapped.
3. Apply `vimrcLines(newKeymap, newGroups)` through the first hosted editor, leaving out the
   `unmap <leader>` line when the leader is unchanged (vim already dropped that default).

A changed leader: the new leader is unmapped; the old leader key keeps no mapping until the next start,
since vim's default for it cannot be restored without clearing every map (drafter).

`appliedMappings` lists the remaps by mode and keys (`<Leader>` as the leader), then each group by mode
and keys, in `vimrcLines` order; the old leader's `unmap` is not in the list.

### PageApi and page plugins

`PageApiDeps` drops `keymap`, `settings`, `label`, `commandInfo` and `scopes` and gains
`config: LiveConfig`; every one of those reads `deps.config.current()`. `renderer.ts` still throws for a
page part main served no settings for (`servedSettings`), at its start.

| Member | Behaviour |
|---|---|
| `settings()` | `config.current().pluginSettings[<id>]` |
| `onSettingsChanged` | fires with the plugin's new settings only when `JSON.stringify` of its entry differs from the previous config's |
| `keys.keymap()` | `config.current().keymap` |
| `keys.onKeymapChanged` | fires with the new keymap only when `JSON.stringify(keymap)` differs |
| `platform` | `config.current().platform` (fixed for the page load) |

Call sites converted (measured at plan time, re-verify):

| Where | After |
|---|---|
| forms `page/start.ts:143` | `AutosaveDeps.delayMs` becomes `() => number`, read each time a save is scheduled; passed `() => api.settings().autosaveDelayMs` |
| chat `page/start.ts:119` | `profiles: () => api.settings().profiles` |
| keys `which-key-controller.ts` | `WhichKeyDeps.delayMs` becomes `() => number` and `timeoutMs` `() => number \| null`, read at each schedule; keys' start passes `() => api.settings().whichKeyDelayMs` and `() => api.settings().whichKeyTimeoutMs` |
| keys `which-key` model, `barHints`, `keysFor` | read `keys.keymap()` per call, and take `api.platform` |
| keys help | `mountHelpView` returns `setSections(sections: HelpSection[])`, which replaces the grid; start calls it with fresh `helpSections` on `keys.onKeymapChanged` |
| keys key bar | `mountKeyBarView` returns `{ render(): void }`; start calls it on `keys.onKeymapChanged` |

A view outside the keys plugin that drew a `keysFor` hint once (the sessions empty state,
`sessions/page/start.ts:202`, and the forms, chat and docs views) shows the new key from its next
redraw (drafter: plan C rebuilds those hints on the Kbd primitive; a redraw hook per view now would be
undone there).

## formatChord

`formatChord(token, platform)` prints a chord in the page notation (`parseChord`) for the platform; any
token `parseChord` rejects (a plain key, `<Esc>`, `<S-k>`) returns as it is (lead, pinned):

| Platform | Modifiers | Joiner | Key | `<S-D-k>` | `<A-o>` | `<C-h>` | `<D-Enter>` |
|---|---|---|---|---|---|---|---|
| `macos` | `⌃ ⌥ ⇧ ⌘` in that order | none | letter upper case, digit as is, `Enter` → `↩` | `⇧⌘K` | `⌥O` | `⌃H` | `⌘↩` |
| `windows`, `linux` | `Ctrl Alt Shift Win` in that order | `+` | letter upper case, digit as is, `Enter` | `Shift+Win+K` | `Alt+O` | `Ctrl+H` | `Win+Enter` |

Call sites (drafter: the two helpers every key hint already passes through, so every keys-plugin hint
prints chords for the platform now; plan B's Kbd consumes `formatChord` directly):

- `formatKeys(keys: string[], platform: Platform)`: each key is `KEY_NAMES[key] ?? formatChord(key, platform)`.
- `formatVimToken(token: string, platform: Platform)`: `VIM_TOKEN_NAMES[token] ?? formatChord(token, platform)`.
- `pageHints`, `helpSections`, `barHints`, `whichKeyModel` and `keysFor` gain a last `platform: Platform`
  parameter and pass it down. `editorHints`, `chordName` and the app and system accelerators stay as
  written today (plan B's Kbd and plan C redraw them).

## Self-test steps

In `STEPS` of `src/plugins/forms/main/selftest-script.ts`, right after the step expecting
`[forms] not applicable on question 2` (the page holds focus there, outside any box), measured at plan
time, re-verify. `Q` is bound nowhere today (re-verify with `grep -rn "'Q'" src/plugins`):

| writeFile (`.config/wigley-ai-gui/keymap.json`) | keys | expect |
|---|---|---|
| `{"page":[{"keys":["Q"],"scope":"any","command":"keys.toggleHelp"}]}` | — | `[config] applied a new config` |
| — | `Q` | `[page] Q ran keys.toggleHelp` |
| — | `Escape` | `[page] Escape ran keys.closeHelp` |
| `{"page":[{"keys":["Q"],"scope":"any","command":"keys.noSuchCommand"}]}` | — | `[config] keymap.json: "page[0].command" names no command "keys.noSuchCommand".` |
| — | `Q` | `[page] Q ran keys.toggleHelp` |
| — | `Escape` | `[page] Escape ran keys.closeHelp` |
| `{}` | — | `[config] applied a new config` |

The second write proves the last good keymap stays; the last puts the defaults back for the steps after.

## Tests

GIVEN a live config WHEN `replace` runs THEN each listener hears `(next, previous)` in registration order
GIVEN a listener that throws WHEN `replace` runs THEN the next listener still runs and `[config] listener failed: boom` is logged
GIVEN plugin `p`'s settings unchanged and `q`'s changed WHEN the config is replaced THEN only `q`'s `onSettingsChanged` fires

Tests:     `live-config.test.ts`: `calls listeners with the next and previous config`; `logs a throwing listener and runs the rest`; `stops calling a disposed listener`
           `page-api.test.ts`: `settings() reads the current config`; `onSettingsChanged fires only for the plugin whose settings changed`;
           `onKeymapChanged fires when the keymap changes and not for a settings-only change`; `platform is the served platform`
           `key-hints.test.ts`: `formatChord` — every cell of the table above, plus `<C-A-S-D-1>` → `⌃⌥⇧⌘1` (macos) and
           `Ctrl+Alt+Shift+Win+1` (windows), `<A-o>` → `Alt+O` (linux), `j` → `j`, `<Esc>` → `<Esc>`, `<S-k>` → `<S-k>`;
           `formatKeys([' ', '<A-o>'], 'macos')` → `Space ⌥O`
           `vim-binds.test.ts`: `appliedMappings lists remaps then groups` — leader `<Space>`, remap `{mode:'normal', keys:'Y', to:'y$'}`,
           binds `<Leader>a` (normal) and `<CR>` (insert) → `[{keys:'Y',mode:'normal'}, {keys:'<Space>a',mode:'normal'}, {keys:'<CR>',mode:'insert'}]`
           `which-key-controller.test.ts`: `reads the delay when it schedules` — the getter changes from 200 to 50 between two sequences; the second opens at 50
           `autosave.test.ts`: `reads the delay when it schedules a save` — the same shape
           existing help-sections, key-bar, which-key and keys-for tests pass `'macos'` and expect chord tokens printed by the table

## Proof

