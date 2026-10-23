# Settings mode — plan

Feature: settings · Implements: none · Ticket: none
Target: main · Written: 2026-10-23

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user changes any setting and any key bind from a Settings mode in the app (`Space k ,`, `Cmd+,`), in place of
hand-editing `~/.config/wigley-ai-gui/settings.json` and `keymap.json`. Each row shows a label, a description, the
value in force and whether the user set it. A commit writes only what the user changed, through the same check a hand
edit meets, and the app hot reloads it.

## Architecture

Systems touched:

- **Setting declarations** (`src/contracts/`, `src/shared/define-plugin.ts`, `src/config/settings.ts`, every built-in
  manifest): each setting declares a label and a description by its dotted path, checked by the compiler.
- **Core main service** `userConfig` (`src/contracts/user-config.ts`, `src/main/config/`, `src/main/main.ts`): reads
  the user's layers of `settings.json` and `keymap.json` and writes new ones through the ConfigStore's checks.
- **The `settings` plugin** (`src/plugins/settings/`): main relays userConfig over its channel and answers `Cmd+,`;
  page draws Settings mode: the sections side bar, setting rows, keymap rows, boxes and pickers.
- **Keys** (`src/plugins/keymap.ts`): `<Leader>k,`, the `Cmd+,` app accelerator, the mode's scoped keys.

No repository, submodule or package boundary is crossed, and no package is added.

## Preconditions

Each was run at plan time; `wigley:make` re-runs them before the first dispatch.

- `git merge-base --is-ancestor e02b5f0 HEAD && echo ancestor` → `ancestor` (the docs written ahead).
- `command grep -n "PUNCTUATION = " src/shared/accelerator.ts` → the list holds `,`, so `CommandOrControl+,` passes
  `acceleratorProblem`.
- `command grep -n "Menu.setApplicationMenu(buildMenu(keymap.app" src/main/keybindings.ts` → app accelerators build
  the app menu from `keymap.app` (empty in `src/plugins/keymap.ts` at plan time).
- `command grep -n "writeDoc" src/plugins/docs/contract.ts` → docs' write takes `expectedText` and returns
  `changedOnDisk`; userConfig's stale-write check follows that shape.
- `ls src/plugins` → `chat docs forms gallery keys sessions` plus the list files: no `settings` folder yet.
- Settings leaves (measured at plan time, re-verify): core 12 — `window.width`, `window.height`, `window.minWidth`,
  `window.minHeight`, `theme`, `transparency`, `fonts.ui`, `fonts.mono`, `fonts.uiSize`, `fonts.monoSize`,
  `keySequenceTimeoutMs`, `claude.command`; plugins 6 — `chat.profiles`, `docs.scriptPath`, `forms.autosaveDelayMs`,
  `forms.deadlineSeconds`, `keys.whichKeyDelayMs`, `keys.whichKeyTimeoutMs`. No boolean setting exists.
- **Peer plan.** `docs/features/agent-chat/plan-chat-usability/` (chat plan C) is open on the same branch and also
  edits `src/main/main.ts`, `src/plugins/chat/manifest.ts` and `src/plugins/keymap.ts` (its
  `MainServices.tempFolders` is already in HEAD). Run this plan after plan C closes, or expect to merge those three
  files by hand;
  `ls docs/features/agent-chat/` shows whether `plan-chat-usability/` still stands.

## Docs written ahead

Commit `e02b5f0`:

- `docs/features/settings/design.md` — the settled design; every task reads it.
- `AGENTS.md` — the `config/` and `settings/` lines of the source tree, **A setting** (declarations), **The user
  config folder** (writes go through `userConfig`).
- `DESIGN.md` — the **Settings** surface.
- `docs/keymap.md` — `k,` in the `k` row; `Cmd+,` in the Cmd layer.
- `docs/features/followups.md` — the settings window follow-up replaced by a theme editor follow-up.

## Mandatory Reads

- `AGENTS.md` (repo root) — architecture, layers, plugins, settings, the user config folder, running and testing.
- `docs/features/settings/design.md` — every task.
- `DESIGN.md` — tasks 05 and 08 (every view and its CSS).
- `docs/keymap.md` — task 03 (every new bind).
- `.agents/skills/drive/SKILL.md` — task 08.
- No `CLAUDE*.md`, `AGENTS.local.md` or `.claude/rules/*.md` exists in the repo at plan time
  (`find . \( -name 'CLAUDE*.md' -o -name 'AGENTS*.md' \) -not -path './node_modules/*'` → `./AGENTS.md`;
  re-verify).

## Design Overview

```
 settings.json / keymap.json  (~/.config/wigley-ai-gui/)
        ▲ atomic write                    │ watch
        │                                 ▼
 ┌──────┴───────────────┐   checks   ┌──────────────┐  onChanged  ┌──────────────┐
 │ userConfig (main)    │◄──────────►│ config-checks│◄────────────│ ConfigStore  │──► page config (hot reload)
 │ schema · read ·      │  (shared)  └──────────────┘             └──────┬───────┘
 │ writeSettings/Keymap │◄───────────────────── onChanged ──────────────┘
 └──────▲───────────────┘
        │ services.userConfig
 ┌──────┴───────────────┐  channel: schema, read, write*, `changed`, `show`
 │ settings main part   │◄──────────────────────────────────────────┐
 │ Cmd+, → settings.show│                                           │
 └──────────────────────┘                              ┌────────────┴─────────────┐
                                                       │ settings page part       │
                                                       │ Settings mode            │
                                                       │  side bar: sections      │
                                                       │  rows ← setting-rows.ts  │
                                                       │       ← keymap-rows.ts   │
                                                       │  commit → *-edits.ts     │
                                                       │  → write(layer, expected)│
                                                       └──────────────────────────┘
```

Decisions (the interview, `design.md`):

- A Settings mode from a new `settings` plugin, not a second window (round 1).
- It covers `settings.json` and `keymap.json`; themes stay hand-edited (round 1, the user's note "settings +
  keymap").
- A form, one row per leaf setting, controls by kind, arrays as a JSON box; every change writes the file (round 1).
- Every setting declares a label and a description, compiler-checked (round 2).
- A core `userConfig` main service owns reads and writes through the ConfigStore's checks (round 2).
- A side bar of sections; `j`/`k`, `/` filters (round 2).
- Keymap: command rows, add by typed vim notation, delete, reset, a leader field, an advanced JSON box (round 2).
- Commit on Enter or a pick; Esc reverts; a failed check keeps the box open with its message (round 2).
- Decided by the agent: the plugin name and icon, `<Leader>k,` and the `CommandOrControl+,` accelerator, broken files
  shown and not overwritten, minimal 2-space writes, stale writes refused by expected text (docs' `writeDoc` shape),
  booleans through the list picker (no toggle primitive: no boolean setting exists), `theme` choices from the served
  theme names, a runtime check of every outside plugin's declarations at start.

Out of scope: a theme editor (follow-up), the key-hints setting (follow-up), moving `claude.command` to the harness
plugin (extensibility follow-up), recording key presses, a nested object inside an array element
(`checkElements` follow-up).

Architecture:

- `userConfig` is a deep module: four calls (`schema`, `read`, `writeSettings`, `writeKeymap`) and `onChanged` in
  front of the merge, the keymap parse, the theme resolve, atomic writes and the stale check. Its two adapters are
  the live one and the plain-object fakes the settings main part's tests build.
- The checks move out of `config-store.ts` into `config-checks.ts` and both callers use them, so a form edit and a
  hand edit pass or fail alike (locality).
- The page's row and edit logic is pure (`setting-rows.ts`, `setting-edits.ts`, `keymap-rows.ts`, `keymap-edits.ts`),
  tested by inputs and outputs; the views only draw rows and route keys.

## File Structure

**Modified**

- `src/contracts/plugin.ts` — `SettingInfo`, `SettingInfos<T>`, `PluginManifest.settingInfo` (01);
  `MainServices.userConfig` (02, beside its filling in `main.ts`).
- `src/shared/define-plugin.ts` (+ test) — requires `settingInfo: SettingInfos<T>`.
- `src/shared/plugin-manifests.ts` (+ test) — `pluginSettingInfo(manifests)`.
- `src/config/settings.ts` — core `settingInfo`.
- `src/plugins/{chat,docs,forms,keys,gallery,sessions}/manifest.ts` — `settingInfo`.
- Test manifest literals: `src/renderer/plugins/page-api.test.ts`, `src/shared/plugin-host.test.ts`,
  `src/shared/plugin-manifests.test.ts`, `src/shared/define-plugin.test.ts`, `src/main/config/config-store.test.ts`,
  `src/main/plugins/main-api.test.ts` — `settingInfo: {}`.
- `src/main/config/config-store.ts` — its file checks move to `config-checks.ts`.
- `src/main/main.ts` — builds `userConfig` and hands it to the main parts.
- `src/plugins/keymap.ts` (03: the app accelerator; 05: the page keys), `src/plugins/manifests.ts`,
  `src/plugins/main.ts` (03), `src/plugins/page.ts` (05) — the new plugin.
- `scripts/check-layers.mts` — `src/plugins/settings*` entries, and the composition roots listing them.

**New**

- `src/contracts/user-config.ts` — the userConfig contract and the records crossing it.
- `src/main/config/config-checks.ts` — one check per file, shared by the ConfigStore and userConfig (a move; the
  ConfigStore's tests keep covering it).
- `src/main/config/user-config.ts` (+ test) — the live userConfig.
- `src/plugins/settings/manifest.ts`, `contract.ts` — the plugin and its channel.
- `src/plugins/settings/main/start.ts`, `main/selftest-script.ts` — the relay, `settings.show`, the self-test.
- `src/plugins/settings/page/setting-rows.ts`, `setting-edits.ts`, `keymap-rows.ts`, `keymap-edits.ts`,
  `row-filter.ts` (+ tests each) — pure row and edit logic.
- `src/plugins/settings/page/start.ts`, `settings-view.ts`, `sections-view.ts`, `setting-rows-view.ts`,
  `keymap-view.ts`, `row-box.ts`, `settings.css` — the mode and its views.
- `src/shared/page/text-box.ts` — docs' `textBoxInput` moved here so docs and settings share one small box
  (`src/plugins/docs/page/text-box.ts` removed; `docs-dialogs.ts` and `tree-view.ts` import the new path).

**Boundary rules**: `src/contracts/` imports nothing; only `src/main/config/` reads or writes the user config files;
the settings plugin imports only `src/contracts`, `src/shared`, its own folder and `src/plugins/keys/contract.ts`
(`scripts/check-layers.mts` enforces it); no `process.platform` in the plugin.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Setting declarations and the userConfig contract](01-declarations-and-contract.md)

### Wave 2
- [ ] [userConfig service](02-user-config-service.md) — after 01
- [ ] [Row and edit logic](04-row-and-edit-logic.md) — after 01

### Wave 3
- [ ] [Settings plugin skeleton](03-plugin-skeleton.md) — after 01, 02

### Wave 4
- [ ] [Settings mode views](05-settings-views.md) — after 03, 04

### Wave 5
- [ ] [Settings self-test](06-self-test.md) — after 02, 05

### Wave 6
- [ ] [Doc re-read](07-doc-re-read.md) — after 06

### Wave 7
- [ ] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: bb7ccc2 (peer session on the tree, chat plan C: review range is this run's commit list)

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
