# 03 — Settings plugin skeleton

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     create `src/plugins/settings/manifest.ts` · `src/plugins/settings/contract.ts` ·
           `src/plugins/settings/main/start.ts` ·
           modify `src/plugins/manifests.ts` · `src/plugins/main.ts` · `src/plugins/keymap.ts` · `scripts/check-layers.mts`
Consumes:  `UserConfig`, `UserConfigSchema`, `UserConfigRead`, `ConfigWriteResult` ← 01 ·
           `MainServices.userConfig` ← 02 · `settingInfo` on `definePlugin` ← 01
Produces:  `export const settingsManifest` in `src/plugins/settings/manifest.ts`
           `export interface SettingsChannel extends ChannelShape` in `src/plugins/settings/contract.ts`
           `export const settingsMainPart: MainPart` in `src/plugins/settings/main/start.ts`
Decisions: plugin `settings` (Decided) · `Cmd+,` as app accelerator `CommandOrControl+,` on main command
           `settings.show` (Decided; a page chord cannot hold `,`) · the page part, its binds and `src/plugins/page.ts`
           land in task 05, so this task adds no page keys
Done when: compiles; `npm run lint` passes (layer check included)
Commit:    one commit for the group

## Manifest

`id: 'settings'`, `dependsOn: ['keys']`, `settings: {}`, `settingInfo: {}`, `themeTokens: {}`.

Commands (label, group, process):

| Short id | Label | Group | Runs in |
|---|---|---|---|
| `show` | `settings` | `modes` | main |
| `showMode` | `settings (again: toggle the sections)` | `modes` | page |
| `down` | `next row` | `settings` | page |
| `up` | `previous row` | `settings` | page |
| `top` | `first row` | `settings` | page |
| `bottom` | `last row` | `settings` | page |
| `open` | `open the section or edit the row` | `settings` | page |
| `edit` | `edit the row` | `settings` | page |
| `reset` | `reset to the default` | `settings` | page |
| `addBind` | `add a key` | `settings` | page |
| `removeBind` | `remove a key` | `settings` | page |
| `filter` | `filter the rows` | `settings` | page |
| `clearFilter` | `clear the filter` | `settings` | page |
| `focusSections` | `focus the sections` | `focus` | page |
| `focusRows` | `focus the rows` | `focus` | page |
| `boxAccept` | `save the value` | `box` | page |
| `boxCancel` | `cancel the edit` | `box` | page |
| `pickerDown` | `next choice` | `picker` | page |
| `pickerUp` | `previous choice` | `picker` | page |
| `pickerChoose` | `choose` | `picker` | page |
| `pickerCancel` | `cancel` | `picker` | page |

Scopes: `sections: 'In settings sections'`, `rows: 'In settings'`, `box: 'In a settings box'`,
`picker: 'In a settings list'`. The table is final: the picker rows already take docs' picker labels.

## Channel (`contract.ts`)

```ts
export interface SettingsChannel extends ChannelShape {
  invoke: {
    schema(): UserConfigSchema;
    read(): Promise<UserConfigRead>;
    writeSettings(layer: Record<string, unknown>, expectedText: string | null): Promise<ConfigWriteResult>;
    writeKeymap(layer: UserKeymap, expectedText: string | null): Promise<ConfigWriteResult>;
  };
  messages: {
    // The ConfigStore served a new config: read again.
    changed: null;
    // Show Settings mode (`Cmd+,`).
    show: null;
  };
}
```

## Main part

`start` hands each invoke straight to `services.userConfig`, sends `changed` from `userConfig.onChanged`, and returns
the `show` handler: `services.window.show()`, then `channel.send('show', null)`. `dispose` disposes the
`onChanged` registration. It holds no state and no logic of its own, so it takes no test (`wigley:writing-tests` §
What earns neither); the self-test drives it (task 06).

## Lists and keys

- `settingsManifest` joins `builtInManifests` last, and `settingsMainPart` joins `mainParts` last.
- `src/plugins/keymap.ts` `app`: `{ accelerator: 'CommandOrControl+,', command: 'settings.show' }`.
- `scripts/check-layers.mts`: entries for `src/plugins/settings`, `src/plugins/settings/contract.ts`,
  `src/plugins/settings/main` and `src/plugins/settings/page` shaped as docs' entries are (the plugin depends on
  `keys`, so its page may import `src/plugins/keys/contract.ts`; its page layer also takes `src/shared/page` and
  `src/shared/page/ui`), and the main and page composition roots' lists gain them as they list docs'.

## Proof
