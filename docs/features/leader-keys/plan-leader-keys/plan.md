# Leader keys — plan

Feature: leader keys · Implements: none · Ticket: none
Target: main (wigley-ai-gui) · Written: 2026-11-08

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The leader tree is reorganized so every session action sits under one `Space b` group. The which-key popup becomes
the quiet glass shelf (A3) with a `Space /` search over every leader action. Settings mode's single Keymap section
becomes two: **Keybindings**, one row per action with its keys on the right, reassigned by recording the key pressed, and
**Leader menu**, the leader tree edited as groups beside items.

## Architecture

Systems touched, all in wigley-ai-gui:

- **Core page keys**: the page plugin API's `keys` (`src/contracts/plugin.ts`, `src/renderer/plugins/page-api.ts`)
  and the page key engine (`src/renderer/page-keys.ts`), which gains a one-shot key capture.
- **Default keymap**: `src/plugins/keymap.ts` (the tree and its `groups`), and every self-test step, test fixture and
  gallery sample that presses or prints a moved key.
- **keys plugin**: which-key's model, view and `default` layout (`src/plugins/keys/page/`,
  `src/plugins/keys/layouts/`), and a new `keys.searchLeader` command over `services.picker`.
- **settings plugin**: Settings mode's sections and keymap rows (`src/plugins/settings/page/`), its layout contract and
  `default` layout (`src/plugins/settings/layouts/`), and its self-test script.

## Preconditions

Re-run each before the first dispatch; a failing one stops the run for the lead.

- `main` matches `origin/main`: `git -C /Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui fetch origin && git -C
  /Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui status -sb` → `## main...origin/main`. At plan time `main` was
  `e9570be7` plus this plan's doc commit.
- **The keyboard-reach plan has landed and closed**: `ls docs/features/keyboard-reach/plan-every-pane` → no such
  folder. At plan time it held 10 unticked tasks, a worktree `wigley-ai-gui-keyboard-reach`, and it edits
  `src/plugins/keymap.ts`, `src/plugins/settings/page/settings-view.ts` and the keys help. This plan runs after it, on
  the code it leaves; every path and line here was read before it landed, so each task re-reads its files first.
- **The form-popup plan has landed**: `grep -n "togglePopup" src/plugins/keymap.ts` → one bind on `<Leader>vf`, and
  `ls docs/features/session-popups/plan-form-popup` → no such folder. Task 02 moves that bind to `<Leader>bp`. It had
  landed by the plan's commit (`e9570be7`).
- No user keymap needs moving keys: `ls ~/.config/wigley-ai-gui/keymap.json` → no such file (checked at plan time). A
  file found here is read for binds on the moved keys, and each is named to the user in the wrap-up, never edited.
- `<Leader>b` and `<Leader>/` bind nothing: `grep -nE "<Leader>(b|/)" src/plugins/keymap.ts` → no hit before Task 02.

## Docs written ahead

Commit `28751244` on `leader-keys` (merged to `main` with this plan):

- `docs/keymap.md` § Leader groups (the new table) and § Adding a bind step 5
- `docs/features/settings/design.md` § Scope (recording) and § Keybindings and Leader menu sections (replacing § Keymap
  section), and the side bar line in § The mode
- `docs/features/leader-keys/design.md` (new: the tree's reasons, the popup's look and search, `captureKey`, rejected
  options)
- moved keys in `AGENTS.md` (the session popup bullet's `<Leader>bp`, the key hints bullet's `Space /`, the settings
  plugin line), `DESIGN.md`, and the designs of agent-chat, chat-panes, chat-bar, session-log, session-titles,
  session-popups and workflow

## Mandatory Reads

- `AGENTS.md` (wigley-ai-gui root): § Intent, and § Architecture's bullets on a plugin, a command, a key, a key scope,
  key hints, a layout and the user config folder; § Running and testing's self-test bullet. Task 01 also reads the
  ambient service bullet.
- `DESIGN.md` § Keys and focus, § Primitives, and the Floating line of § Surfaces.
- `docs/keymap.md` whole.
- `docs/features/leader-keys/design.md` whole; `docs/features/settings/design.md` whole for Tasks 04 and 05.
- `docs/features/layouts/design.md` for Tasks 03, 04 and 05 (a layout contract change).
- Every `AGENTS*.md` under a touched folder: `find src -name 'AGENTS*.md'` (none at plan time; re-run).

## Design Overview

### After

```
keydown ─► page key engine ─┬─ a capture is armed? ─► captureKey's onKey(<vim notation>)   (Esc: onCancel)
                            └─ else binds / pending sequence as today
                                   │
              <Leader> pending ────┴─► which-key model ─► keys default layout: the shelf (A3)
              <Leader>/ ─────────────► keys.searchLeader ─► services.picker over leader actions ─► commands.run

Settings mode side bar:  Core · <plugins> · Keybindings · Leader menu
  Keybindings : keymap rows (one line per command) ─► reassign / add (captureKey) · clear · reset · f filter · ? find
  Leader menu : leaderTree(schema, layer) ─► groups pane | items pane ─► add / change / move / clear / rename group
  both        : keymap-edits (pure)        ─► userConfig.write('keymap', layer)
```

### Decisions

From the interview (mockup rounds, then one form round; all on the recommendation, and the user's round note
"go with your suggestion the rest of the session"):

- The tree as `docs/keymap.md` § Leader groups now states: `b` session (`n r d s X p h`), `k` go to, `x` → `ax`,
  `rr` → `br`, `kn` → `bn`, `vs` → `bh`, `vf` → `bp`; `;` and `'` stay, `:` goes.
- Popup look A3, and `Space /` search through the list picker.
- Keybindings section: grouped by plugin, the manifest `group` as a dim detail; one key or chord recorded on press, Tab to
  type a sequence; `?` finds by key.
- Leader menu: L2, groups beside items; a leader item's label is always its command's.

Decided by the agent (each reported in the hand-off reply):

- `api.keys.captureKey` is a core page capability, so a plugin records a key with no DOM listener of its own; the
  engine already turns a keydown into a key.
- The popup has no step-back key: the engine holds no back step; Esc cancels as today.
- `f` cycles the Keybindings filter chips; the Leader menu owns `groups`, so the Advanced box drops it.
- The leader tree for the editor is a pure module in the settings plugin, apart from which-key's model: the editor
  needs every scope and each bind's origin, which-key only the scope in force.
- This plan runs after keyboard-reach and form-popup land (Preconditions).
- The new section is titled "Keybindings", since the keys plugin's own settings section is already "Keys".
- The Leader menu lists only binds that fire, as which-key does; a removed default is restored from Keybindings. Reset
  on an item resets its command's binds. Adding a command that already has a leader bind, or changing an item's action onto one, moves that bind: one leader path per command. Default-named
  groups with no binds are hidden; groups the user added show empty. Uppercase keys are left off the free-key list.
- A group's label and its `›` draw in `accent` on the shelf; an action's in `fg-secondary` (design.md's "no accent
  until a row is a group").
- `Space /` opens with its filter focused, since a search is typed; Esc leaves INSERT, a second Esc returns to the
  list and a third closes.
  The other list pickers keep opening on the list.
- The search lists page leader binds only: a box-only bind is left out, since the picker takes focus from the box.

### Out of scope

- A command palette (`Space f a`): `Space /` searches leader actions only.
- Custom labels on leader items.
- A text-outline editor of the tree.
- Recording a whole key sequence.

## File Structure

Existing files modified (measured at plan time, before keyboard-reach landed; re-verify):

- `src/contracts/plugin.ts` — the page `keys` API gains `captureKey` (01)
- `src/renderer/page-keys.ts`, `src/renderer/plugins/page-api.ts` and its test, `src/renderer/key-sequences.ts`
  (`chordTokenFor`, the reverse of `chordCode`), `src/renderer/renderer.ts` (passes `keyCapture`),
  `src/shared/plugin-part-harness.test-support.ts` (the capture test hooks) — the capture (01)
- `src/plugins/keymap.ts` — the tree (02), the `<Leader>/` bind (03), Settings' new scope binds (04, 05)
- `src/plugins/chat/main/selftest-script.ts`, `src/plugins/sessions/main/selftest-script.ts`,
  `src/plugins/forms/main/selftest-script.ts`, `src/plugins/gallery/page/gallery-view.ts` — moved keys (02)
- `src/plugins/keys/manifest.ts`, `src/plugins/keys/page/{which-key.ts,which-key-view.ts,start.ts,keys.css}`,
  `src/plugins/keys/page/layout/{keys-parts.ts,read-keys-layout.ts}`,
  `src/plugins/keys/layouts/{layout.d.ts,default/layout.js,default/layout.css}`, `src/plugins/forms/main/selftest-script.ts`
  (a `leader search` group), `docs/features/layouts/design.md` (the `keys` row of § Adopters) — the shelf and search (03)
- `src/plugins/settings/manifest.ts`, `src/plugins/settings/page/{settings-view.ts,keymap-view.ts,keymap-rows.ts,
  keymap-edits.ts,row-filter.ts}`, `src/plugins/settings/layouts/{layout.d.ts,default/layout.js,default/layout.css}`,
  `src/plugins/settings/main/selftest-script.ts`, `src/plugins/settings/page/layout/settings-kit.ts` (`buildLeaderPanes`) —
  Keybindings (04) and Leader menu (05)
- `src/contracts/user-config.ts`, `src/main/config/user-config.ts`, `src/shared/key-hints.ts`, and
  `src/plugins/keys/page/which-key.ts` again — `defaultGroups` and `unnamedGroupName` (05)

New files:

- `src/plugins/keys/page/leader-search.ts` and its test — `leaderActions(...)`, the leader actions the search lists (03)
- `src/plugins/settings/page/key-recorder.ts` and its test — recording a key on a row over `captureKey` (04)
- `src/plugins/settings/page/leader-tree.ts` and its test — the leader tree from the schema and the user layer (05)
- `src/plugins/settings/page/leader-menu-view.ts` and its test — the Leader menu section's panes and actions (05)

Shared names, signatures and types (every task that uses one matches it word for word):

- `captureKey(onKey: (keys: string) => void, onCancel: () => void): Disposable` on the page plugin API's `keys`, in
  `src/contracts/plugin.ts`. `keys` is one key or chord in the keymap's vim notation, written as a bind's `keys` would
  be (`t`, `T`, `<C-t>`, `<A-S-o>`, `<CR>`, `;`): the same spelling `keymap.json` takes, so a caller writes it into a
  bind unchanged. One capture is armed at a time; arming a second cancels the first (its `onCancel` runs). The capture
  takes the next keydown ahead of every bind and of a pending sequence, then disarms. Esc runs `onCancel` and is never
  captured. A bare modifier press is not a key: the capture waits past it. Disposing an armed capture disarms it with
  no callback.
- Capture test hooks (01 produces; 04 and 05's tests consume): the part harness's `pressCapture(keys)`,
  `cancelCapture()` and `isCapturing()`; `capturedKeys(press)` and `keyCapture` on `PageApiDeps`.
- `WhichKeyModel` and `WhichKeyInput` gain `name: string | null`; a group entry's label loses its `+` (the layout draws
  `›`) (03).
- `keys.searchLeader` — page command in the keys manifest, no argument, group `help`, label "Search leader actions";
  bound `<Leader>/`, scope `any` (03).
- `withMovedBind(layer: UserKeymap | null, line: BindLine, to: KeyBind, schema: UserConfigSchema): UserKeymap` in
  `keymap-edits.ts` — the one edit behind reassign, change action, change key and move to group: a user bind's entry
  is replaced by `to`; a default's half or halves become `unbind` entries and `to` joins `binds`; `to` replaces any
  user bind on its keys in its scope, as `withAddedBind` does (04 produces, 05 consumes). `UserKeymap`
  (`src/contracts/keymap.ts`), `UserConfigSchema` (`src/contracts/user-config.ts`) and `BindLine` (`keymap-rows.ts`)
  are the tree's names at plan time.
- `withGroupName(layer: UserKeymap | null, prefix: string, name: string | null): UserKeymap` in `keymap-edits.ts` —
  sets or removes one `groups` entry; `prefix` in vim notation starting `<Leader>` (05).
- Settings sections: `KEYS_SECTION = { id: 'keymap', title: 'Keybindings' }` renames `KEYMAP_SECTION` in
  `settings-view.ts` (04); the id stays `keymap`, since the keys plugin's settings already hold a schema section `keys`
  titled "Keys", and so `keymap.json` routing and the self-test's `section keymap` lines hold. `LEADER_SECTION = { id:
  'leader', title: 'Leader menu' }` is added after it (05). Both are `ConfigFile` `'keymap'`.
- From 04 for 05: `buildRow` takes a scope argument; `keymap-view.ts` exports `scopeTitle`, `openScopePicker` and
  `ScopePickRequest`; `key-recorder.ts` exports `RecordRequest`, `Judgement`, `Recording` and `createKeyRecorder`.
- Contract change (05): `UserConfigSchema.defaultGroups: KeyGroups` (`src/contracts/user-config.ts`, filled in
  `src/main/config/user-config.ts`), so the Leader menu shows default group names; every schema fixture with
  `defaultLeader:` gains `defaultGroups: {}`. `src/shared/key-hints.ts` gains `unnamedGroupName`, which which-key calls.

Boundary rules: the settings plugin records keys only through `api.keys.captureKey`, never a `keydown` listener of
its own; every keymap write goes through `keymap-edits.ts` and `ctx.commitKeymap`; every new look draws through the
owner's layout (`AGENTS.md` § Intent).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Key capture](01-key-capture.md)
- [ ] [The new leader tree](02-leader-tree.md)

### Wave 2
- [ ] [Which-key shelf and leader search](03-which-key-shelf.md) — after 02

### Wave 3
- [ ] [Settings Keybindings section](04-settings-keys.md) — after 01, 03 (both edit `keymap.ts`)

### Wave 4
- [ ] [Settings Leader menu](05-settings-leader-menu.md) — after 01, 04

### Wave 5
- [ ] [Doc re-read](06-doc-re-read.md) — after 01–05
- [ ] [Final verification](07-final-verification.md) — after 01–05

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
