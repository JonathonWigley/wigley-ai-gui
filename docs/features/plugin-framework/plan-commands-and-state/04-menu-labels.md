# 04 — Menu labels by label

Status: in progress
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:

- modify `src/main/keybindings.ts`
- modify `src/main/main.ts`
- create `src/main/keybindings.test.ts`

Consumes: `AppConfig.commands` and `CommandInfo.label`, in the tree. Nothing from 03 is consumed. This task waits for 03 because both edit `src/main/main.ts`.

Produces:

```ts
// src/main/keybindings.ts
export function installWindowKeybindings(
  window: BrowserWindow,
  keymap: Keymap,
  commands: MainCommands,
  labelOf: (id: CommandId) => string,
): WindowKeybindings;
```

Pinned values: a menu item's text is `${labelOf(bind.command)} (${bind.accelerator})`. With the default keymap, the Commands menu item reads `settings (CommandOrControl+,)`. It reads `settings.show (CommandOrControl+,)` today.

Decisions:

- **`labelOf` is a function.** `buildMenu` runs at install and again at each `setKeymap`, so it reads the label when it builds. Task 07 adds runtime commands to the served config, and this read sees them.
- **The menu rebuilds only on a keymap change.** `main.ts` calls `setKeymap` only when the served keymap's JSON changes. A runtime command gets a menu item only through a bind, and a new bind changes the keymap, so the rebuild reads its label. A label that changes with no keymap change shows at the next rebuild. Accept this, and keep the one rebuild trigger.
- **`buildMenu(binds, commands, labelOf)`** holds the only change to the item. `accelerator` and `click` do not change.
- **The call in `src/main/main.ts:932`** passes `(id) => served().commands[id]?.label ?? id`. This is the same fallback as `src/renderer/plugins/page-api.ts:139`. `served` is defined at line 913, above that call.
- **The accelerator text stays in the item,** since the follow-up changes only the id to the label. Electron also draws the accelerator at the item's right, so the text shows it twice, as it does today. Labels keep their manifest case: `settings`, with no capital.
- **`registerGlobalShortcuts` does not change.** It builds no menu.

GIVEN an app bind for `settings.show` with label `settings` WHEN the window keybindings install THEN the Commands submenu item's label is `settings (CommandOrControl+,)`.

GIVEN a new keymap with another app bind WHEN `setKeymap` runs THEN the rebuilt menu labels that bind by its label.

GIVEN a command with no served label WHEN the menu builds THEN `main.ts`'s `labelOf` gives the id, and the item reads `<id> (<accelerator>)`.

Tests:

- `src/main/keybindings.test.ts`, `menu_InstallAndSetKeymap_LabelsEachBindByLabel`: mock `electron` so `Menu.buildFromTemplate` records its template and `setApplicationMenu` does nothing. Use a real `CommandRegistry<string>` with the commands registered and a fake window with `webContents.on`. Call `installWindowKeybindings`, then `setKeymap`. In each template, assert the `Commands` submenu labels with a `labelOf` over a table of labels. Catches: an item going back to the id, or `setKeymap` building its menu without the labels.

The fallback in `main.ts` runs only in the app, so it has no test. Runtime checks collect in [Final verification](16-final-verification.md).

Done when:

- `npm run typecheck` and `npm run lint` pass.
- `grep -n 'bind.command} (' src/main/keybindings.ts` prints nothing.
- The test gate runs the test above.

Commit: one commit for the group.

## Proof

