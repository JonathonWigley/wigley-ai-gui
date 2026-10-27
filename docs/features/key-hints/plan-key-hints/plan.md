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
- [x] [Anchors, KeyPrompt and the hint setting](01-anchors.md)
- [x] [Status bar collapse, config badge, save-state line](02-shell-chrome.md)

### Wave 2
- [x] [Sessions: list and tab strip prompts](03-sessions.md) — after 01
- [x] [Form tab and review](04-forms.md) — after 01, 02
- [x] [Primer](05-primer.md) — after 01, 02
- [x] [Chat](06-chat.md) — after 01
- [x] [Docs](07-docs.md) — after 01
- [x] [Settings and Gallery](08-settings-gallery.md) — after 01
- [x] [Backlog and Notes](09-backlog-notes.md) — after 01

### Wave 3
- [x] [Retire the key bar](10-retire-key-bar.md) — after 01–09

### Wave 4
- [x] [Doc re-read](11-doc-reread.md) — after 10

### Wave 5
- [x] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: 268c38a4a1b8e0a49c34ff796705ec6c21417894

### Groups
- 01 · 627512e · diff read, every Produces present; typecheck and lint clean with 02 · concerns: ui-confirm-hint has no CSS rule (container only); plugin-framework/design.md § Keys plugin is stale, left for task 11
- 02 · ae65f16 · diff read, every Produces present; typecheck and lint clean once 01 landed · concerns: forms-view.test.ts and primer-view.test.ts edited per the Tests section though Files omits them
- 06 · 7a58a86 · diff read, Produces present (layout.d.ts kit keyHint shape kept, key-hint.ts deleted); typecheck clean in chat files · concerns: fake agent declares only Mode and Effort controls, so the chat.pickControl (c) and chat.pickModel (o) chip anchors are named but never attached in the self-test
- 07 · 504589a · diff read, Produces present; typecheck clean in docs files · concerns: tree pane grid auto-placement: hidden children drop out, so the rows list may miss its minmax(0,1fr) track (pre-existing)
- 05 · 50be002 · diff read, Produces present; typecheck clean in primer files · concerns: textButton doc comment in shared button.ts still says the hint is a kbd (left for 10/11); selected row label may be cut short by the prompt in the 240px rail (task 12 visual)
- 09 · 01e08a9 · diff read, Produces present; typecheck clean in backlog and notes; notes bind table below · concerns: backlog cursor prompt is detached while the detail has focus (no is-cursor row) instead of hidden-keeping-space as the spec's scenario says; Add follow-up ⌘↩ anchor has no scope so it shows while a notes picker is open
- 03 · 51ea834 · diff read, Produces present (hasOtherSession, hasOtherTab); typecheck clean in sessions files · concerns: check-styles not run by the worker (lint stopped on task 08's in-flight gallery layer error); the gate's lint covers it
- 04 · eff5f37 · diff read, Produces present; whole-tree typecheck clean; forms tests 628 pass (worker run) · concerns: .box-keys on the frame's bottom edge is a guess for task 12; a layout card or pane that throws and falls back to default keeps its anchors until the next rebuild
- 08 · aeac5ad · diff read, Produces present; whole-tree typecheck and lint clean after wave 2 · concerns: scripts/check-layers.mts edited (gallery page layer gains keys/contract.ts), outside the Files list; settings rows gain one line for the cursor prompt (task 12 visual)
- 10 · 7754ee3 · diff read, every Produces present; typecheck and lint clean; after-edit grep's one hit is a false positive (key-hints.ts:331 'key listed'); worker self-test 683 PASS 0 FAIL, every key placed · concerns: chat selftest-script o step edited (outside Files) to expect the Model picker; gate passed with and without the c/o fixture, so it is unproven whether it flags a detached anchor; primer and backlog views' platform dep now unread (kept per Decisions); agent-chat/design.md:161 still says key bar (task 11)
- 11 · a356269 · diff read; step 3 grep finds no stale hit outside the plan folder · concerns: followups 'keysFor in the core keys API' reason (sessions depends on keys only for its toast) is weaker now views depend on keys for anchors; plugin-framework design's settled bar-split bullet rewritten as history
- 12 · ad66140 · drive run checks 3.1-3.13 + E1-E5: 3.5, 3.13@680 and the docs screenshot failed, fixed in b0b0af2 and ad66140 and re-driven (fit 0 problems 640-900); final suite 3699 pass, selftest all passed · concerns: none
### Contract changes
- start.ts keeps the UnplacedLog: `const unplacedLog = startUnplacedLog(...)` → `startUnplacedLog(...)` unbound · why: oxlint no-unused-vars warns on an unread binding; scope recording still runs · consumers: 10 (binds it back when it wires checkSeen) · group 01
- PrimerViewDeps.keys: Pick<KeysPageExports, 'keysFor' | 'onChanged' | 'anchor'> → Pick<KeysPageExports, 'anchor'> · why: the view reads no keys itself now · consumers: none · group 05
- forms internals: buildChoiceList deps drop platform (keep markdown); buildField gains optional labelKeys; card-parts.ts gains PartAnchor, appendBoxKeys(field, anchor), appendPickKeys · why: anchors replace kbd hints · consumers: none outside 04 · group 04
### Rulings
- keys-for.ts: firesIn becomes a module-level predicate shared by keysFor and promptKeysFor — one copy of the scope rule — none, keysFor tests unchanged · group 01 · group 01
- anchors.placedIn returns a fresh Set per call — cold path, checkSeen only — allocations if a later caller polls it · group 01 · group 01
- config badge adds config-problem-badge via classList.add on tag('', 'error'), no new tag() parameter — leaves the shared primitive alone — none · group 02 · group 02
- running indicator and the four chip anchors are named in chat.chat, as the task's table says, not the tab scope as its prose says; an ended tab hides them by scope — the table is the finer spec — a hint shows in the wrong scope if wrong · group 06 · group 06
- resume picker headerEnd is one span.chat-picker-keys wrapping the / filter and . archived anchors — headerEnd takes a single element — none · group 06 · group 06
- chat c/o chip anchors detached in the self-test: per the plan's placement decision (a target placed by a fixture state that builds it, never a stand-in), task 10 adds a fake-agent fixture control so the Controls and Model chips draw, rather than counting a detached anchor — a detached anchor proves no prompt is on screen — task 10 scope grows by one fixture · lead
- ‹ tree ⌥H edge absolutely positioned in the doc pane's top start corner, scrolling with content; doc pane top padding space-3 → space-6 (space-2 → space-6 under 800px) — room for the edge — visual check in task 12 · group 07 · group 07
- Trash dialog builds its own two buttons rather than reusing createConfirmPrompt, whose deps are forms-shaped — none · group 07 · group 07
- saveStatus(primer) replaces statusContent — rail header owns it — none · group 05 · group 05
- row prompt appended to the selected row node; its D key hides via hidden — none · group 05 · group 05
- .box-keys rules scoped to primer so forms' same-named class is untouched; box keys overlap the frame's bottom border by grid — visual check task 12 · group 05 · group 05
- backlog detail header sticky with top: calc(space-3 * -1) and matching negative margin, not top: 0 — sticky stays inside the scroll padding, text would scroll through the band — none · group 09 · group 09
- notes title box hint reads ⌃P ⇥, not ⌃P ⌃N — keymap order gives <CR>, <Tab>, <C-n> and the prompt takes the first non-vim bind — per the plan's prompt rule · group 09 · group 09
- notes ⌘↩ (sendFollowup) anchored with no scope — it fires in both notes.popup and notes.title — hint shows while a picker is open · group 09 · group 09
- leader-only buttons (Discard, Append, Start session) keep their key inside the button — none · group 09 · group 09
- session edge pair hidden before main's first state arrives — none · group 03 · group 03
- the tab bar's 1fr gap is a grid column, not a spacer element; the bar takes over the strip's margin; is-no-target scoped to sessions selectors — visual check task 12 · group 03 · group 03
- the head's anchor list lives in each build's parts, so a rebuild disposes the old head's anchors — none · group 04 · group 04
- Clear click focuses the item then dispatches clearChoice directly, as Accept does, so no log line — a reviewer may want the log · group 04 · group 04
- settings cursor prompt is one fixed element (edit, add, remove, reset, unused ones hidden), the li's last child on its own line; stays on the cursor row and hides by scope while sections have focus — hidden-keeps-space decision — row is a line taller even hidden · group 08 · group 08
- sections pane end edge ⌥L rows › at the pane's bottom-end corner — keeps the list from moving — visual check task 12 · group 08 · group 08
- Space ? prompt beside the Keys button hides under 640px via keys.css — the title bar's end track is 53px at the 420px minimum width and the item needs 75px; the alternative was a shell.css track change outside the files — the prompt is absent on narrow windows; check in task 12 · group 10 · group 10
- fake agent gains model and verbosity controls so the Model (o) and Controls (c) chips draw in the self-test — fixture state per the placement rule — none · group 10 · group 10
- Rebind check: user binds now precede default binds in mergeKeymap, so a rebind shows without unbinding the default · group 12
- Forms split gains endMin and stacks when the end pane would drop below 224px · group 12
### Review rounds
- 1 · d209821 · NEEDS FIXES — 22 findings; determined 1-5, 7, 8, 22 dispatched; 6 contradiction and 9-21 open to triage
- 2 · 37e29b7 (re-review of round-1 fixes) · NEEDS FIXES — 2 minor (stacked-hint gap repeat → one shared rule; docs empty hint wrap); fixed in 563adf8
- 3 · 563adf8 (re-review cycle 2 of bba771a, 563adf8) · NEEDS FIXES — 1 important (sticky docs edge covers top line) + 3 determined; fixed in 2f328bc under the user's standing pick-the-recommendation; cycle cap reached, closed by the gate
### Test gate
- whole vitest suite (the range touches every page plugin, the keys plugin, shared page code and the self-test runner; the suite runs in 5s) · 235 files, 3685 tests pass; npm run selftest (task 10's placement gate and every plugin script reach the changed views) · 683 PASS, 0 FAIL, every key placed, all passed; typecheck and lint clean
- after fixes at 2f328bc: lint clean; vitest 237 files / 3697 tests pass; npm run selftest 683 PASS, 0 FAIL, every key placed, all passed
