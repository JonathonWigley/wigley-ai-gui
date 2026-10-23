# 01 — Setting declarations and the userConfig contract

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · `src/shared/define-plugin.ts` · `src/shared/plugin-manifests.ts` ·
           `src/config/settings.ts` · `src/plugins/{chat,docs,forms,keys,gallery,sessions}/manifest.ts` ·
           create `src/contracts/user-config.ts` ·
           test `src/shared/define-plugin.test.ts` · `src/shared/plugin-manifests.test.ts` ·
           modify (manifest literals gain `settingInfo: {}`) `src/renderer/plugins/page-api.test.ts` ·
           `src/shared/plugin-host.test.ts` · `src/main/config/config-store.test.ts` · `src/main/plugins/main-api.test.ts`
Consumes:  nothing
Produces:  in `src/contracts/plugin.ts`:
           `export interface SettingInfo { label: string; description: string }`
           `export type SettingPath<T>` — every leaf of `T` as a dotted path
           `export type SettingInfos<T> = { readonly [P in SettingPath<T>]: SettingInfo }`
           `PluginManifest.settingInfo: Readonly<Record<string, SettingInfo>>` (required)
           in `src/config/settings.ts`: `export const settingInfo: SettingInfos<Settings>`
           in `src/shared/plugin-manifests.ts`:
           `export function pluginSettingInfo(manifests: readonly PluginManifest[]): Record<string, SettingInfo>`
           in `src/contracts/user-config.ts`: the records and interface below, word for word in their names
Decisions: label and description per setting, compiler-checked (round 2) · userConfig is a core main service
           (round 2) · stale writes refused by expected text, as docs' `writeDoc` (Decided) · booleans and closed
           choices both pick from a list (Decided)
Done when: `npm run lint` and `npx tsc --noEmit` pass (`MainServices.userConfig` lands in 02, with its filling) (the build fails on a missing or misspelled declaration); the
           tests below pass under the test gate
Commit:    one commit for the group

## SettingPath

A member whose value (with `null` and `undefined` removed) is a plain object recurses with `<key>.`; an array, a
scalar or `null` is a leaf; optional members count (`Settings['fonts']['ui']` gives `fonts.ui`). Over `Settings`
it yields the 12 core paths in plan.md § Preconditions; over `{}` it yields `never`, so a plugin with no settings
writes `settingInfo: {}`.

`definePlugin` takes `settingInfo: SettingInfos<NoInfer<T>>`, so each built-in manifest fails to compile on a missing
or extra path. `PluginManifest` keeps the loose record, for an outside plugin compiled elsewhere.

`pluginSettingInfo` qualifies each path as `<pluginId>.<path>` and throws, naming the plugin and the path, on a leaf
of `settings` with no declaration and on a declaration naming no leaf. It finds leaves as `settingDefaults` walks
them, but treating an array as one leaf (no `[]` element paths) and a member left unset by the defaults as invisible.
Every `optionalSettings` path without `[]` is a leaf too, nested ones included (as `SettingPath` counts optional
members at any depth); a path holding `[]` never is.

## The userConfig contract (`src/contracts/user-config.ts`)

```ts
// How a row edits a leaf setting. `theme` picks from `UserConfigRead.themes`;
// `json` is an array, edited whole as JSON.
export type SettingControl =
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'boolean' }
  | { kind: 'choice'; choices: readonly string[] }
  | { kind: 'theme' }
  | { kind: 'json' };

// `path` nests as settings.json does: core `fonts.ui`, plugin `forms.autosaveDelayMs`.
// `fallback` null: the defaults leave it unset (`fonts.ui`); otherwise the default, null included.
export interface SettingLeaf {
  path: string;
  label: string;
  description: string;
  control: SettingControl;
  fallback: { value: unknown } | null;
}

// `id` is `core` or the plugin id; `title` is `Core` or the id with its first letter upper-cased.
export interface SettingSection {
  id: string;
  title: string;
  leaves: readonly SettingLeaf[];
}

// `sections`: core first, then each plugin with at least one leaf, in manifest order.
// `defaultBinds`: the default keymap's binds, then each manifest's `keys.binds`, qualified, in layer order.
// `defaultAccelerators`: the same layers' `app`, `global` and `intercept` binds, which main commands run on.
export interface UserConfigSchema {
  sections: readonly SettingSection[];
  commands: Readonly<Record<CommandId, CommandInfo>>;
  scopes: readonly ScopeInfo[];
  defaultBinds: readonly KeyBind[];
  defaultAccelerators: {
    app: readonly AcceleratorBind[];
    global: readonly AcceleratorBind[];
    intercept: readonly InterceptBind[];
  };
  defaultLeader: string;
}

// `text` null: no file. `layer` null with state `ok`: no file.
export type ConfigFileRead<L> =
  | { state: 'ok'; layer: L | null; text: string | null }
  | { state: 'broken'; problem: string; text: string | null };

// `themes`: every theme name, built-ins first, then the user's by name.
export interface UserConfigRead {
  settings: ConfigFileRead<Record<string, unknown>>;
  keymap: ConfigFileRead<UserKeymap>;
  themes: readonly string[];
}

export type ConfigWriteResult =
  | { type: 'written' }
  | { type: 'refused'; problem: string }
  | { type: 'changedOnDisk' };

// The user's own layers of settings.json and keymap.json. A write runs the
// ConfigStore's check of that file on `layer` and refuses one that fails; it
// refuses as `changedOnDisk` when the file's text is no longer `expectedText`
// (null: no file). `onChanged` hears each config the ConfigStore serves.
export interface UserConfig {
  schema(): UserConfigSchema;
  read(): Promise<UserConfigRead>;
  writeSettings(layer: Record<string, unknown>, expectedText: string | null): Promise<ConfigWriteResult>;
  writeKeymap(layer: UserKeymap, expectedText: string | null): Promise<ConfigWriteResult>;
  onChanged(listener: () => void): Disposable;
}
```

The control is chosen in order: a `settingChoices` path → `choice`; the core `theme` path → `theme`; an array
default → `json`; a `boolean` default or kind → `boolean`; a `number` default or kind → `number`; else `string`. Task
02 builds it; it is stated here so tasks 04 and 05 read the same rule.

## Pinned copy

Labels are sentence case; each description is one line. Core (`src/config/settings.ts`):

| Path | Label | Description |
|---|---|---|
| `window.width` | Window width | Width of a new window, in pixels. Applies to the next window. |
| `window.height` | Window height | Height of a new window, in pixels. Applies to the next window. |
| `window.minWidth` | Minimum window width | The narrowest the window can be dragged, in pixels. Applies to the next window. |
| `window.minHeight` | Minimum window height | The shortest the window can be dragged, in pixels. Applies to the next window. |
| `theme` | Theme | A built-in theme or one from the themes folder. |
| `transparency` | Transparency | Whether glass shows through: follow the system, always, or never. |
| `fonts.ui` | UI font | A font family for the interface, in place of the theme's. |
| `fonts.mono` | Code font | A font family for code, paths and keys, in place of the theme's. |
| `fonts.uiSize` | UI font size | The interface text size, in pixels. |
| `fonts.monoSize` | Code font size | The code text size, in pixels. |
| `keySequenceTimeoutMs` | Key sequence timeout | How long a key sequence waits for its next key, in milliseconds. |
| `claude.command` | Claude command | The `claude` program sessions run; `~` is the home folder. Applies to the next session. |

Plugins:

| Path | Label | Description |
|---|---|---|
| `chat.profiles` | Profiles | The Claude profiles a new session can start in: a name and its config folder each. |
| `docs.scriptPath` | Docs index script | The path to `docs_index.py`; empty finds the installed wigley plugin's copy. `~` is the home folder. |
| `forms.autosaveDelayMs` | Autosave delay | How long after a change a round's draft is saved, in milliseconds. |
| `forms.deadlineSeconds` | Round deadline | How long an agent waits on a round before it gets a draft back, in seconds, when its session names no deadline. |
| `keys.whichKeyDelayMs` | Which-key delay | How long a pending key sequence waits before the which-key panel opens, in milliseconds. |
| `keys.whichKeyTimeoutMs` | Which-key timeout | How long the which-key panel waits before ending the sequence, in milliseconds; empty waits for a key. |

The two plugin meanings were checked at plan time against `locateScript` (`src/plugins/docs/main/script-locator.ts`)
and `deadlineSeconds` (`src/plugins/forms/main/forms-service.ts`).

## Tests

- `define-plugin.test.ts`: a `// @ts-expect-error` manifest missing a declaration and one with an extra path — each
  fails to compile; a nested-object and an array setting take exactly their leaf paths.
- `plugin-manifests.test.ts`:
  - `pluginSettingInfo_MissingDeclaration_Throws` — a manifest whose `settings` holds `{ a: 1 }` and declares nothing
    throws naming `"p"` and `a`
  - `pluginSettingInfo_ExtraDeclaration_Throws` — a declaration of `b` with no such leaf throws naming `b`
  - `pluginSettingInfo_ArrayLeaf_IsOnePath` — `{ list: [{ x: 1 }] }` declared as `list` returns `p.list` only
  - `pluginSettingInfo_Qualifies` — returns `{ 'p.a': <the declared info> }`

## Proof
