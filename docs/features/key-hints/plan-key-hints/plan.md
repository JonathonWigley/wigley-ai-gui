# Key hints in place — plan

Feature: key-hints · Implements: none · Ticket: none
Target: main · Written: 2026-10-27

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Move every key hint from the bottom status bar onto the screen element the key acts on, as a game
puts a button prompt beside the thing it moves. Remove the key list from the status bar. The status
bar shows only while a plugin contributes to it, and no built-in plugin contributes to it.

## Architecture

Systems touched:

- **keys plugin** (`src/plugins/keys/`): a new `anchor` page export. The plugin draws a KeyPrompt
  into each anchor, redraws it on a keymap change, and shows or hides it by the scope in force and the
  `keys.showHints` setting. A prompt shows the command's first bind in the scope whose keys are not
  vim's own keys, or the first bind when every bind is a vim key. The plugin keeps a history of every
  anchor named in the page load and every scope that was in force. At the end of a self-test run it
  logs each bind of those scopes that no anchor in the history placed, once per scope and bind. It contributes the Keys button to the title
  bar. The key bar is deleted.
- **Shared page UI** (`src/shared/page/`): a new KeyPrompt primitive and the `ui-key-chevron` class
  in `ui/`. `status-line.ts` draws the save state only. `confirm-prompt.ts` takes `anchor` in place
  of `keysFor`, and its `onBaseChanged` becomes optional. `list-picker.ts` gains two request slots,
  `headerEnd` and `cursorEnd`.
- **Shell and renderer** (`src/renderer/`): the status bar takes no height while it holds nothing
  shown. The config-problem item moves to the title bar.
- **Self-test runner** (`src/main/selftest.ts`, `src/main/selftest-runner.ts`): after the last
  script, the runner asks the page to check every scope that was in force, and each
  `[keys] unplaced` line of the page load fails the run.
- **Every page plugin that shows keys**: sessions, forms, primer, chat, docs, settings, gallery,
  backlog, and notes when its page part exists. Each names anchors in the four placement kinds.

## Preconditions

`wigley:make` re-runs each command before the first dispatch.

- The docs written ahead are on the target: `git merge-base --is-ancestor 83e0733 HEAD` exits 0.
- The backlog plan run is closed, so no peer edits `src/plugins/backlog/` or `keymap.ts` during
  wave 2: `test ! -d docs/features/backlog/plan-backlog` exits 0. At plan time the folder exists
  (task 10 of 12 open). When it still exists, ask the user before the run starts.
- The notes plan run is closed: `test ! -d docs/features/notes/plan-notes` exits 0. At plan time
  a peer session runs it, and it edits `src/renderer/renderer.ts`, `src/contracts/plugin.ts`,
  `src/plugins/chat/`, `src/plugins/sessions/` and adds `src/plugins/notes/page/`. The peer agreed to
  close it before this run starts. When the folder still exists, wait for it to close. After it
  closes, re-read the files this plan names in those folders, because their line numbers moved.
  Task 09 covers notes binds when `src/plugins/notes/page/` exists, which it will after that run.
- `createConfirmPrompt` (`src/shared/page/confirm-prompt.ts`) has three callers, measured at plan
  time, re-verify: `grep -rln "confirm-prompt'" src --include='*.ts' | grep -v test` prints
  `primer-view.ts`, `forms-view.ts` and `backlog-view.ts`.
- The suite is green on the base: `npm test` exits 0, and `npm run lint` exits 0.
- The keys plugin draws the bar today: `grep -c mountKeyBarView src/plugins/keys/page/start.ts`
  prints `2` (the import and the call).

## Docs written ahead

Commit `83e0733` holds them:

- `AGENTS.md` — § Architecture: the keys plugin line in the layer tree, the **Key hints** bullet
  (anchors, placement kinds, vim's own keys, the unplaced log), the user config folder bullet
  (config problem as a title bar badge), the forms layout bullet (rail header status).
- `DESIGN.md` — the Layers diagram, § Keys and focus (placement kinds, visibility, vim keys),
  § Primitives (KeyPrompt), § Surfaces (title bar, status bar, forms rail header).
- `docs/features/ui-design/design.md` — the broken-config line and the key hints row.
- `docs/features/key-hints/design.md` — the settled decisions and the rejected alternatives.

## Mandatory Reads

Every task reads these before it writes code:

- `AGENTS.md` — the whole file; § Architecture, Key hints, is this plan's contract.
- `DESIGN.md` — § Keys and focus, § Primitives, § Surfaces.
- `docs/keymap.md` — the key rule and every scope's binds.
- `docs/features/key-hints/design.md` — why each decision was taken.
- Task 12 also reads `.agents/skills/drive/SKILL.md`.

## Design Overview

```
 view (sessions, forms, primer, chat, docs, settings, gallery, backlog, notes)
   │  places and styles an element by placement kind (edge, cursor, control, box)
   │  keys.anchor(element, command, { scope, where, label }) ──► Disposable
   ▼
 keys plugin ─ anchor registry (page/anchors.ts)
   │  draws keyPrompt(keys, platform, label?) into the element
   │    keys = first bind in scope that is not a vim key, else the first bind
   │  keymap changed ───────────────► redraw every anchor
   │  scope changed / showHints changed ► toggle `is-hint-hidden` (space kept)
   │  scope changed ─► record the scope as seen (logs nothing)
   │  checkSeen() ─► for each scope seen: unplacedBinds(keymap, A, placedIn(A)) ─► log once per (scope, bind)
   │    placedIn = every anchor named in the page load, disposed ones included
   │                     "[keys] unplaced <keys> <command> in <scope>"
   ▼
 self-test runner ─ after the last script: dispatch `keys-check-placement` (checks every
                    scope seen) ─ any "[keys] unplaced" line in the page log ─► FAIL

 title bar (end track): [config problem badge] [Keys Space ?]
 status bar: no height while no shown contribution
 help (Space ?) and which-key: unchanged
```

**Decisions** (from the interview of 2026-10-27; `docs/features/key-hints/design.md` holds the
reasons):

- Four placement kinds: edge prompt, cursor prompt, control hint, box hint (`DESIGN.md` § Keys and focus).
- No key list anywhere. The status bar shows only while a plugin contributes a shown element.
- A hint shows only while its scope is the scope in force. An anchor with no scope always shows.
  A hidden hint keeps its space (`visibility: hidden`), so the layout does not move.
- Vim's own keys need no anchor. The list is key sequences, held in the keys plugin. A prompt shows
  the first bind that is not a vim key, so `forms.nextItem` shows `⌃L`, not `j`.
- KeyPrompt draws the keys, then the label. A chevron or arrow beside a prompt is a view element
  (`span.ui-key-chevron`) next to the anchor element, before it or after it.
- A command counts as placed once the page load names an anchor for it in its scope, on the element
  that draws its target in some state the self-test reaches. That element may be hidden by its scope, by
  a background view or by a closed dialog. A target that shows only in some states is placed by a
  self-test fixture state that builds it, never by a stand-in element made only to satisfy the gate.
- The anchor API is a `keys` page export, beside `keysFor`.
- The view places and styles the anchor element. The keys plugin owns only what goes inside it.
  The interview named a `kind` option; the design review removed it, because the keys plugin does
  nothing different per kind. The kinds stay as the view's placement vocabulary.
- An edge prompt pair hides when there is no other target to move to (one session, one tab, one item).
- `keys.showHints` (boolean, default `true`) hides every anchored hint. Help and which-key ignore it.
- Forms and chat layout kits keep the shape of `keyHint(parent, command)` and `keysFor`. The kit's
  `keyHint` names an anchor underneath.
- The three follow-ups in `docs/features/followups.md` that this work closes are removed in task 10:
  "Key hint on/off setting", "Docs prints keys as plain text inside three sentences", and "One
  `keyHint` helper in place of four copies". Task 10 also removes "One vim-mode status item": each
  box shows its vim mode in CodeMirror's vim status panel, and after task 02 the status bar item it
  describes no longer exists.

**Out of scope:**

- New binds or moved binds. No entry in `src/plugins/keymap.ts` changes.
- Which-key and the help overlay.
- The follow-up "keysFor in the core keys API". The user chose the keys plugin as the home.

## File Structure

**Shared names.** More than one task uses each of these. Write each exactly as here.

```ts
// src/plugins/keys/contract.ts — task 01
export interface AnchorOptions {
  // The qualified scope the hint shows in; left out, the hint shows in every scope.
  // The keys come from the first bind of `command` in this scope (`any` binds included) whose keys
  // are not vim's own keys; when every bind is a vim key, from the first bind.
  scope?: ViewScope;
  // 'page' (default) reads page binds; 'box' reads binds inside a text box.
  where?: HintWhere;
  // Draws the command's label after the keys (cursor prompts, edge prompts with words).
  // A string draws that text in place of the command's label.
  label?: boolean | string;
}
export interface KeysPageExports {
  keysFor(command: CommandId, scope?: ViewScope, where?: HintWhere): string | null; // unchanged
  onChanged(listener: () => void): Disposable;                                        // unchanged
  anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable; // new
}

// src/shared/page/ui/key-prompt.ts — task 01
export function keyPrompt(keys: string, platform: Platform, label?: string): HTMLElement;
// root class `ui-key-prompt`, parts `ui-key-prompt-label`

// The class the keys plugin sets on an anchor element while its hint is hidden — task 01
// `is-hint-hidden` (rule in src/shared/page/ui/key-prompt.css: `visibility: hidden`)

// A view's chevron or arrow beside an anchor element; hides with that anchor — task 01
// `ui-key-chevron` (rules in src/shared/page/ui/key-prompt.css)

// src/shared/page/list-picker.ts — task 01; tasks 06 and 09 (notes) use them
export interface ListPickerRequest<T> {
  // …the existing fields…
  headerEnd?: HTMLElement | null;           // drawn at the title line's end while this request is open
  cursorEnd?(item: T): HTMLElement | null;  // drawn at the cursor row's trailing end, on each draw
}

// src/shared/page/confirm-prompt.ts — task 01
// `ConfirmPromptDeps.onBaseChanged?(): void` (optional); tasks 04, 05 and 09 omit it

// src/shared/page/status-line.ts — task 02; tasks 04 and 05 call `update(true, …)` in their rail headers
export interface StatusLineContent { save: string; saveState: string }
export interface StatusLine { element: HTMLElement; update(isShown: boolean, content: StatusLineContent): void }

// The unplaced log line — task 01 writes it, task 10 fails the self-test on it
// `[keys] unplaced <keys> <command> in <scope>`

// The page event that asks the keys plugin to check every scope seen — task 10, in
// src/plugins/keys/page/unplaced-log.ts and src/main/selftest-runner.ts
// `keys-check-placement`
```

**Existing files modified:**

- `src/plugins/keys/contract.ts`, `manifest.ts`, `page/start.ts`, `page/keys.css` — 01, 10
- `src/plugins/keys/page/keys-for.ts` — 01 (`promptKeysFor`), 10 (comment)
- `src/shared/page/confirm-prompt.ts` — 01, 10. Its three callers are not edited in 01: they compile
  unedited. 04, 05 and 09 drop their `onBaseChanged`; 10 drops their `platform:` line.
- `src/shared/page/list-picker.ts`, `list-picker.css` — 01. Its four callers are not edited in 01.
- `src/plugins/gallery/page/gallery-view.ts` — 01 (KeyPrompt), 08 (gallery anchor)
- `src/shared/page/status-line.ts`, `status-line.css` — 02
- `src/plugins/forms/page/forms-view.ts`, `src/plugins/primer/page/primer-view.ts` — 02 (the
  `statusContent` lines only), then 04 and 05, then 10 (one line each)
- `src/renderer/config-push.ts`, `src/renderer/renderer.ts`, `src/renderer/shell/shell.css` — 02
- `src/plugins/sessions/page/*` — 03
- `src/plugins/forms/page/**`, `src/plugins/forms/layouts/**` — 04
- `src/plugins/primer/page/*` — 05
- `src/plugins/chat/page/*`, `src/plugins/chat/layouts/**` — 06
- `src/plugins/docs/page/*` — 07
- `src/plugins/settings/page/*`, `src/plugins/gallery/manifest.ts`, `src/plugins/gallery/page/*` — 08
- `src/plugins/backlog/page/*`, `src/plugins/notes/page/*` — 09
- `src/main/selftest-runner.ts`, `src/main/selftest.ts`, `src/plugins/forms/main/selftest-script.ts`
  (one fixture question), and any other plugin's `main/selftest-script.ts` that needs a fixture state — 10
- `docs/features/followups.md` — 10

**New files:**

- `src/plugins/keys/page/anchors.ts` — the anchor registry: one place that draws, redraws and hides hints.
- `src/plugins/keys/page/vim-keys.ts` — the list of vim's own key sequences and `isVimKeys(keys)`.
- `src/plugins/keys/page/unplaced.ts` — the pure function that lists binds firing in a scope with no
  anchor. Pure, so a unit test covers it.
- `src/plugins/keys/page/unplaced-log.ts` — records each scope that comes in force; `checkSeen`
  checks every scope seen and logs each unplaced bind once per page load (task 10 triggers it).
- `src/shared/page/ui/key-prompt.ts`, `key-prompt.css` — the KeyPrompt primitive (`DESIGN.md` § Primitives)
  and the `ui-key-chevron` rules.
- `src/shared/page/list-picker.test.ts` — the list picker's slots (task 01).
- `src/shared/page/status-line.test.ts` — the save-state line (task 02).
- `src/plugins/settings/page/row-prompt.ts` — which actions the settings cursor prompt shows (task 08).
- Tests beside each new module.

**Files deleted (task 10):** `src/plugins/keys/page/key-bar.ts`, `key-bar-view.ts`, `key-bar.test.ts`,
`src/shared/page/key-hint.ts` (once no caller is left). Task 06 deletes `src/plugins/chat/page/key-hint.ts`.

**Boundary rules:**

- A page plugin that names anchors lists `keys` in its manifest's `dependsOn`, and imports only
  `src/plugins/keys/contract.ts` from it.
- `src/shared/page/` code cannot import a plugin. It declares the `anchor` dependency it takes as a
  structural type in its own deps interface.
- A new core theme token is added only in task 01 or 02, because the token registry and
  `src/config/themes/catppuccin-mocha.json` are shared files. Tasks 03–09 use existing tokens, or a
  plugin token in their own manifest's `themeTokens`.
- No task in wave 2 edits a file another wave-2 task names. A wave-2 task that needs a change in a
  shared file reports it as a concern and does not make it.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Anchors, KeyPrompt and the hint setting](01-anchors.md)
- [ ] [Status bar collapse, config badge, save-state line](02-shell-chrome.md)

### Wave 2
- [ ] [Sessions: list and tab strip prompts](03-sessions.md) — after 01
- [ ] [Form tab and review](04-forms.md) — after 01, 02
- [ ] [Primer](05-primer.md) — after 01, 02
- [ ] [Chat](06-chat.md) — after 01
- [ ] [Docs](07-docs.md) — after 01
- [ ] [Settings and Gallery](08-settings-gallery.md) — after 01
- [ ] [Backlog and Notes](09-backlog-notes.md) — after 01

### Wave 3
- [ ] [Retire the key bar](10-retire-key-bar.md) — after 01–09

### Wave 4
- [ ] [Doc re-read](11-doc-reread.md) — after 10

### Wave 5
- [ ] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: 268c38a4a1b8e0a49c34ff796705ec6c21417894

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
