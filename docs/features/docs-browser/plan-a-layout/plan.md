# Docs browser A — modes and the sessions sidebar — plan

Feature: docs browser (`../design.md`) · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui, `main` in wigley-ai-marketplace · Written: 2026-10-19

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The window shows one **mode** at a time. Sessions mode lists every connected agent session in a left sidebar
(Claude Code style) in place of today's tab strip, and each session holds **tabs** other plugins add: forms adds a Form
tab. Editor key binds carry a scope, so a second plugin's editor (plan B's docs editor) never runs forms commands.
The relay tells the app each session's harness. Plan B builds the Docs mode and each session's Docs tab on this.

## Architecture

Systems touched:

- **keymap contracts and merging** (`src/contracts/keymap.ts`, `src/contracts/plugin.ts` `PluginKeys`,
  `src/shared/plugin-manifests.ts`): an editor bind gains a scope.
- **editor adapter** (`src/renderer/codemirror-vim/codemirror-vim-host.ts`) and the page composition root
  (`src/renderer/renderer.ts`): one vim mapping per key, the command picked by the scope in force.
- **keys plugin** (`src/plugins/keys/page/`): help, which-key and the key bar list editor binds by scope.
- **modes** (new `src/renderer/shell/modes.ts`, `PageApi.modes` in `src/contracts/plugin.ts`,
  `src/renderer/plugins/page-api.ts`): the core's mode registry.
- **sessions plugin** (`src/plugins/sessions/`): rows for every connected session, harness, round marks, the sidebar,
  per-session tabs (`addTab`), Sessions mode, new keys.
- **forms plugin** (`src/plugins/forms/main/channel-presenter.ts`, `src/plugins/forms/page/start.ts`, the self-test
  script): the Form tab through `addTab`; `markRound` in place of `showTab`.
- **relay** (wigley-ai-marketplace `plugins/wigley/scripts/forms/relay.py`, both plugin manifests): the hello's
  `harness`; no version bump while the unpushed 1.4.0 bump is in the same pushed series (task 03's rule).

## Preconditions

Each re-run by `wigley:make` before the first dispatch:

- Docs-ahead commits present: `git -C ~/Documents/dev/wigley-ai-gui log --oneline | grep -c -e 80f9941 -e 57feb26 -e a550cbd` → 3;
  `git -C ~/Documents/dev/personal/wigley-ai-marketplace log --oneline | grep -c 44bf63a` → 1.
- Both trees clean in the touched areas: `git -C ~/Documents/dev/wigley-ai-gui status --porcelain -- src scripts`
  → empty; `git -C ~/Documents/dev/personal/wigley-ai-marketplace status --porcelain -- plugins/wigley` → empty. On
  any output, stop and ask the user whose the changes are.
- Editor binds have no scope yet: `grep -c "scope" src/contracts/keymap.ts` → 5 at plan time (re-verify): three
  comment lines, the `PendingKeys` page variant and `PageBind.scope`; and `interface EditorBind` holds `keys` and
  `command` only.
- Marketplace version state: `git -C ~/Documents/dev/personal/wigley-ai-marketplace show
  origin/main:plugins/wigley/.claude-plugin/plugin.json | grep version` → `1.3.1` at plan time (local `1.4.0`
  unpushed); task 03 decides its bump from this.
- Sessions still has a tab strip: `grep -c "showTab" src/plugins/sessions/contract.ts` → ≥ 1;
  `grep -c "fill(" src/plugins/sessions/contract.ts` → ≥ 1.
- No bind starts with `Space k`: `grep -rn "' ', 'k'" src/plugins/*/manifest.ts src/config/keymap.ts` → empty;
  `<A-S-o>`, `<A-S-i>` unbound: `grep -rn "A-S-" src/plugins src/config` → empty.
- Relay hello has no harness: `grep -c harness ~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py`
  → 0.
- Plugin version 1.4.0 in both manifests: `grep -h '"version"'
  ~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/.claude-plugin/plugin.json
  ~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/.codex-plugin/plugin.json` → `1.4.0` twice. With
  origin at `1.3.1` (the line above), task 03 leaves `1.4.0` (one bump per pushed series); only when origin already
  holds the local version does task 03 bump to the next minor, and the run log says which held.

## Docs written ahead

- wigley-ai-gui `AGENTS.md` (intro, layout tree, the sessions paragraph, **A mode**, **A session tab**, **A key**'s
  editor-scope sentence, **An ambient service**, **A third-party tool**) — commits `80f9941`, `57feb26`, `a550cbd`. The lines about files,
  processes, the code highlighter and the docs plugin belong to plan B and are re-read there.
- wigley-ai-marketplace `plugins/wigley/scripts/forms/README.md` (Hello: `harness`) — commit `44bf63a`.
- `../design.md` (outside any repo) holds every settled decision for plans A, B and C.

## Mandatory Reads

- `~/Documents/dev/wigley-ai-gui/AGENTS.md`
- `~/Documents/dev/personal/wigley-ai-marketplace/AGENTS.md`, `~/Documents/dev/personal/wigley-ai-marketplace/CLAUDE.md`
  (task 03 only)
- `../design.md` § Modes and layout, § Core services and seams
- Skills: `wigley:codebase-design`, `wigley:writing-code`, `wigley:writing-tests`

## Design Overview

```
 window
 ┌──────────────────────────────────────────────────────────────┐
 │ mode: Sessions (shown)         │ mode: Docs (plan B, hidden)  │
 │ ┌──────────────┬─────────────┐ │                              │
 │ │ sidebar      │ [Form][Docs]│ │                              │
 │ │ ● wigley-ai… │  tab body   │ │                              │
 │ │   Claude     │             │ │                              │
 │ │   round 3 2/5│             │ │                              │
 │ │ proto  Codex │             │ │                              │
 │ └──────────────┴─────────────┘ │                              │
 ├──────────────────────────────────────────────────────────────┤
 │ status bar                                                   │
 └──────────────────────────────────────────────────────────────┘

 relay hello {session_id, project_dir, harness} ─▶ sessions main: row on connect
 forms main presenter ─ markRound(id) ─▶ row dot (unless selected; selects when none is)
 sessions main state ─▶ sessions page: sidebar rows + selected session's tabs
 forms page ─ addTab(id, Form) ─▶ sessions page        docs page (plan B) ─ addTab(id, Docs)
 key ─▶ command ─▶ modes.show / sidebar toggle / step session / step tab
 editor key ─▶ one vim mapping per key ─▶ the bind whose scope is in force ─▶ command
```

**Decisions**

- Modes are an extension point: `api.modes.add` registers one; the core shows one at a time and keeps hidden modes'
  DOM and state. The first registered mode shows at start. (`../design.md` § Modes and layout.)
- `Space k s` runs `sessions.showMode`: shows Sessions mode, or toggles the sidebar when Sessions already shows.
  `<Leader>ks` in a box runs the same command. Plan B binds `Space k d` the same way for Docs.
- `<A-S-o>` / `<A-S-i>` (scope `any`) step to the next / previous session, wrapping; `<A-o>` / `<A-i>` (scope `any`)
  step to the next / previous tab inside the selected session, wrapping. Stepping sessions from a hidden Sessions
  mode shows Sessions mode first.
- Cmd+W, `Space ;`, `<Leader>;` close the selected session's row, through the existing close guards (forms asks to
  cancel an open round). Tabs inside a session are not closable.
- Every connected session has a row from `connect` on; `markRound` replaces `showTab`: it marks the row with a dot
  unless the session is selected, and selects it when no session is (today's `showTab` rule, now on rows). The Form
  tab of a session is selected when its round shows. A notification click still activates the round's session.
- When main changes the selected session while Sessions mode is hidden (a round with no session selected, or a
  notification click), the page keeps the shown mode and toasts `Round from <label> — <keys> to answer`, `<keys>` the
  page keys bound to `sessions.showMode` as the keys plugin's `keysFor` formats them; with no bind,
  `Round from <label>`. A notification click is the exception: it shows Sessions mode, since the user clicked it.
- A row shows the session's label (numbered on a clash, as tabs are today), its harness dimmed (`Claude` / `Codex`,
  nothing when the relay sent none), a second line while any tab has a non-empty status (the last non-empty status in
  tab-add order, the rule `tabTitle` holds today), and an accent dot while marked. A row with no project folder reads
  `Codex session` when its harness is `codex`; otherwise it keeps today's label.
- The relay's `harness` is `claude` when `CLAUDECODE` is `1`, else `codex`. The app accepts the hello with `harness`
  absent, `null`, `"claude"` or `"codex"`; another string reads as no harness; a non-string refuses the hello naming
  the field, as other fields do.
- Editor binds carry a scope (`S | 'any'` in a manifest, qualified on merge like page binds). The editor host maps
  each distinct key sequence once; on fire, the composition root runs the bind for those keys whose scope is in force,
  by the same match rule page keys use (`src/renderer/page-keys.ts`); none in force → nothing runs. Forms' editor
  binds keep firing in every scope a forms box can hold focus in today (forms, review, and any other the self-test
  shows); the self-test proves it.
- The sidebar's width and shown state: width 16rem as the shell's side bar today; shown at start; hidden state lives
  only for the page load. The window's minimum width stays 420 px (the user's choice): while the window is narrower
  than 680 px the sidebar hides itself, and `Space k s` (Sessions showing) opens it over the content rather than
  beside it, until pressed again or the window widens past 680 px; a user who hid it while wide still finds it
  hidden when the window widens again.

**Out of scope**: Docs mode and Docs tabs (plan B), plugin-source status (plan C), fuzzy finders, a user key config
file, resizing the sidebar by drag.

## File Structure

Existing files modified:

- `src/contracts/keymap.ts` — `EditorBind.scope: ViewScope`; the `PendingKeys` editor variant gains `scope` (01).
- `src/contracts/plugin.ts` — `PluginKeys.editor` entries gain `scope: S | 'any'` (01); `Mode`, `ModeHandle`,
  `Modes`, `PageApi.modes: Modes` (04), one home.
- `src/contracts/editor.ts` — `CreateEditorHost`'s `run` takes the binds on the fired keys (01).
- `src/shared/plugin-manifests.ts` (+ test) — qualifies editor bind scopes as page bind scopes are (01).
- `src/shared/key-hints.test.ts` — its editor bind fixtures gain `scope: 'any'` (01).
- `src/config/keymap.ts` — no edit: `binds: []` stays valid with the new field.
- `src/renderer/codemirror-vim/codemirror-vim-host.ts`, `ex-command-name.ts` (+ test) — one ex command per distinct
  key sequence, named by `exBindName(index)`; the host hands the composition root every bind on those keys (01).
- `src/renderer/key-sequences.ts` — exports `firesIn`, the page keys' match rule (01).
- `src/renderer/pending-keys.ts` (+ test) — reports the scope with pending editor keys (01).
- `src/renderer/renderer.ts` — checks and picks the in-force editor bind (01); builds modes and passes them to page
  APIs (04).
- `src/renderer/plugins/page-api.ts` (+ test) — `modes` on the page API, ids qualified (04).
- `src/renderer/shell/shell.css` — the mode layer fills the main area (04).
- `src/plugins/keys/page/help-sections.ts`, `key-bar.ts`, `which-key.ts` (+ tests) — editor binds shown by scope (01).
- `src/plugins/keys/manifest.ts` — `<Leader>?` scope `any` (01).
- `src/plugins/sessions/contract.ts` (02 main side, 05 page side), `manifest.ts` (01 scope, 05 commands, keys and the
  `idle` scope), `main/session-list.ts` (+ test), `main/start.ts`, `main/relay/relay-server.ts` (+ test) (02);
  `page/start.ts`, `page/sessions-view.ts`, `page/tabs.ts` (+ test) (02 compile-only, 05 rewrite);
  `page/sessions.css` (05).
- `src/plugins/forms/manifest.ts` (+ test) — editor bind scopes `forms` and `review` (01).
- `src/plugins/forms/main/channel-presenter.ts` (+ test) — `markRound` (02); `main/selftest-script.ts` (02 the
  `harness` field, 06 the steps); `main/forms-service.test.ts` (02 the fixture's `harness`).
- `src/plugins/forms/page/start.ts`, `page/forms-view.ts`, `page/forms.css`, `page/forms-commands.ts` (+ test),
  `page/form-state.ts` (+ test; `confirmClosesTab` → `confirmClosesSession`) — the Form tab and its scope (05).
- `scripts/check-layers.mts` — sessions page may import the keys contract (05).
- wigley-ai-marketplace `plugins/wigley/scripts/forms/relay.py` and its tests (03); both `plugin.json` manifests
  touched only if origin already holds 1.4.0 (03).

New files:

- `src/renderer/editor-binds.ts` + test — checks editor binds for ambiguity and picks the one in force (01).
- `src/renderer/shell/modes.ts` + `modes.test.ts` — the mode registry: one shown, order of registration, `shown()`
  on each change; show and toggle-sidebar semantics belong to each mode's own command, not the registry (04).
- `src/plugins/sessions/page/sidebar-view.ts` — the rows; `src/plugins/sessions/page/session-tabs-view.ts` — the tab
  strip and bodies; `sessions-view.ts` stays as the mode's root that composes them (05).

Interfaces every task shares (exact names; the task documents spell them the same):

```ts
// src/contracts/keymap.ts
export interface EditorBind { keys: string; scope: ViewScope; command: CommandId; }
export type PendingKeys =
  | { where: 'page'; keys: string[]; scope: ViewScope }
  | { where: 'editor'; keys: string[]; scope: ViewScope };

// src/contracts/editor.ts
export type CreateEditorHost = (
  keymap: EditorKeymap,
  run: (binds: EditorBind[], editor: TextEditor) => void,
) => EditorHost;

// src/renderer/editor-binds.ts, src/renderer/key-sequences.ts
export function requireUnambiguousEditorBinds(binds: EditorBind[], leader: string): void;
export type EditorBindChoice = { kind: 'run'; bind: EditorBind } | { kind: 'none'; message: string };
export function editorBindInForce(binds: EditorBind[], scope: ViewScope): EditorBindChoice;
export function firesIn(bind: { scope: ViewScope }, scope: ViewScope): boolean;

// src/contracts/plugin.ts — PageApi.modes
// `shown` runs each time the mode becomes the shown one (the first at its `add`); its plugin sets its base key
// scope there, so a hidden view never keeps the scope.
export interface Mode { id: string; title: string; element: HTMLElement; shown(): void; }
export interface ModeHandle { show(): void; isShown(): boolean; }
export interface Modes {
  // Registers a mode whose root fills the window above the status bar; the first one added shows.
  add(mode: Mode): ModeHandle;
  shown(): string;                                  // the shown mode's qualified id
  onChanged(listener: (modeId: string) => void): void;
}
// src/renderer/shell/modes.ts
export function createModes(attach: (element: HTMLElement) => void, log: Log): Modes;

// sessions contract
export type Harness = 'claude' | 'codex';
export interface SessionInfo { sessionId: string | null; projectDir: string | null;
  deadlineSeconds: number | null; harness: Harness | null; }
export interface SessionRow { sessionId: string; label: string; harness: Harness | null; marked: boolean;
  projectDir: string | null; hostSessionId: string | null; }
export interface SessionsState { rows: SessionRow[]; selectedSessionId: string | null; }
// SessionsMainExports: markRound(sessionId) replaces showTab; activate, addCloseGuard, connect, contributeTools stay.
// SessionsChannel.invoke: state(), activate(sessionId), closeSession(sessionId): boolean.
// SessionsChannel.messages: stateChanged: SessionsState; activated: { sessionId: string } (sent before the state
// it changes). SessionListDeps gains activated(sessionId: string): void.
// `shown` runs each time the tab becomes the visible tab: the selected tab of the selected session while Sessions
// mode shows. Its plugin sets its base scope there; with no visible tab, sessions sets `sessions.idle`.
export interface SessionTabView { id: string; title: string; element: HTMLElement; beforeClose(): boolean;
  shown(): void; }
export interface SessionTabHandle { setStatus(status: string): void; select(): void; remove(): void;
  isVisible(): boolean; }
export interface SessionsPageExports {
  addTab(sessionId: string, tab: SessionTabView): SessionTabHandle;
  selectedSessionId(): string | null;
  activate(sessionId: string): void;
  closeSession(sessionId: string): void;
}
export interface SessionsPageEvents extends EventShape {
  activeChanged: { sessionId: string | null };
  sessionAdded: { sessionId: string; projectDir: string | null; harness: Harness | null; hostSessionId: string | null };
  sessionRemoved: { sessionId: string };
}
```

Boundary rules: `modes.ts` sits in `src/renderer/shell/` (no new LAYERS entry); sessions page imports the keys
contract for `keysFor` (sessions' manifest gains `dependsOn: ['keys']`, and `LAYERS` lets `src/plugins/sessions/page`
import `src/plugins/keys/contract.ts`); no plugin imports `src/renderer`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Scoped editor binds](01-scoped-editor-binds.md)
- [x] [Sessions main: rows, harness, markRound](02-sessions-main-rows.md)
- [x] [Relay harness](03-relay-harness.md)

### Wave 2
- [x] [Modes](04-modes.md) — after 01

### Wave 3
- [x] [Sessions mode, sidebar and tabs](05-sessions-sidebar-tabs.md) — after 01, 02, 04

### Wave 4
- [x] [Self-test](06-selftest.md) — after 05

### Wave 5
- [x] [Doc re-read](07-doc-re-read.md) — after 06

### Wave 6
- [ ] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: a550cbd (wigley-ai-gui) · 96ce948 (wigley-ai-marketplace)

Peers on the tree at preflight: wigley-ai-gui-cc, wigley-ai-gui-1c — commits pathspec-scoped, review range an explicit commit list.

### Groups
- 03 · wigley-ai-marketplace a02ecb4 · proved (diff read, forms unittest OK, manifest checks pass) · concerns: none
- 02 · c802d7b · proved (diff read, typecheck, sessions + forms main suites) · concerns: selftest timing may differ now rows exist from connect (selftest pending 01); connect sends state before emitting `connected`; HARNESSES list in relay-server.ts kept in step with the Harness union by hand
- 01 · 07dd24a · proved (diff read, typecheck, suite 847 pass, selftest all passed with 02) · concerns: check (b) compares keys with the leader spelled; editorBindInForce reads binds[0] unguarded; host vim wiring untested by unit tests (selftest covers it)
- 04 · 639039c · proved (diff read, typecheck, suite 853 pass) · concerns: one `Modes` type serves short ids (plugin) and qualified ids (core); page-api test pins identity of element and shown
- 05 · b8ce743 · proved (diff read, typecheck, suite 858 pass, Done-when grep empty) · concerns: no live or DOM check of the sidebar width/overlay, start.ts, tabs view or Form tab wiring; a tab's `shown()` may run inside `addTab` before its handle returns; a dropped row's still-open round view stays detached; selftest-script.ts still expected `closing the tab asks to cancel` (fixed in 06)
- 06 · 1d811e3 · proved (diff read, typecheck; worker's selftest all passed, no code fix needed) · concerns: none
- 07 · 75382f5 · proved (diff read: AGENTS.md items 7 and 8 fixed, the rest and the marketplace README current, no marketplace commit) · concerns: plan B's lines describe code not yet present
### Contract changes
- `scopesOverlap` in src/renderer/key-sequences.ts: private → exported · why: requireUnambiguousEditorBinds reuses the page keys' overlap rule · consumers: none beyond editor-binds.ts · group 01
- `Mode`: gains `hidden(): void`, called on the old mode when another mode's show hides it, before the new mode's `shown` and listeners · consumers: sessions page, plan B's Docs mode · review fix
- `Harness`: hand-written union → derived from exported `HARNESSES` in the sessions contract · consumers: relay-server.ts · review fix
### Rulings
- `connect` sends the state before it emits `connected` (the row exists first) — a `connected` listener reading state sees the row — cost if wrong: flip one ordering · group 02
- Plan folder moved mid-wave-1 by a peer run (wigley-ai-gui 6c52ae5) from ~/wigley-features/wigley-ai-gui/ to docs/features/; the run continues from the in-repo folder, commits each plan change, and leaves 6c52ae5 out of the review range — lead
- Task 03 version: origin/main holds 1.3.1, local 1.4.0 unpushed → version left at 1.4.0 (one bump per pushed series) — preflight · lead
- mergeKeymap's `qualifiedPageBinds` generalised to `qualifiedScopedBinds(manifests, select)` for page and editor binds — one qualifying rule — cost if wrong: code shape only · group 01
- Two existing keys tests re-fixtured: help-sections' editor case binds `any` and expects `Everywhere, in a text box`; key-bar's leader test binds scope `s` — old expectations cannot hold under the scoped rule · group 01
- New tests use the plan's prose names where the keys plugin's tests use `fn_Case_Result` · group 01
- `npm run lint` fails only on oxfmt formatting of markdown under docs/features/ that 6c52ae5 (peer run) added, and later on a peer run's uncommitted files; every file this run touched passes; the run counts lint met on its own files and raises the rest to the user at close — lead
- The first `add` reveals in the same order as `show`: unhide, log, then `shown()` · group 04
- One `.sessions-empty` section whose title and text change per case; it and the session bodies share one explicit grid cell · group 05
- Session and tab steps call `mode.show()` unconditionally (a no-op while shown) · group 05
- A Form tab's status is the session's first round in forms' state, as `guardClose` reads it · group 05
- A round whose session's Form tab was forgotten (row dropped, round still open) keeps a detached view until it closes, since a render finding an existing view never adds a tab — cost if wrong: such a round has no visible home · group 05
- Self-test's `connect` helper takes `(sessionId, projectDir, harness)`; the third session takes no round, so `shownLine` stays the second round's · group 06
- A peer run (Forms layouts, ca465b1, review base b8ce743) began work in this tree during wave 5; its uncommitted files (scripts/check-layers.mts, src/main/files/, src/contracts/files.ts, src/shared/*-files.ts) are left alone, and this run's review range is its own commit list — lead
- plan.md was emptied by the lead's tick script in d028ebf (a write opened before the read) and restored from 4c8a778 with every later entry re-applied; the task documents were never affected — lead
- User ruling during review: take every review suggestion for the rest of the session; open findings take the lead's recommended option — user
- Review choices: #1 cancel prompt — closing a session through forms' guard selects its Form tab first; #3 HARNESSES exported from the sessions contract, Harness derived from it; #7 AGENTS.md marks the Docs tab as coming with the docs plugin; #8 plugins' PageApi.areas drops `main` (modes own it); #9 Mode gains `hidden()` so a plugin never compares mode ids; #10 bindGroups/vimrcLines move to a pure tested module; #11 per-session tab rules move to pure tested functions in tabs.ts; #12 forgetSession also destroys the session's round views; #13 narrow overlay stays open on a row click, as the plan's Decisions pin, left to task 08; F1 dead markRound removed; F2 one shared first-round helper — lead
- Forms page fixes (#1, #8's forms-view half, #12, F2) wait for the Forms layouts run's group 05, by agreement with that session (wigley-ai-gui-79) — lead
### Review rounds
- 1 · 6126427 · NEEDS FIXES (2 Important, 13 Minor, 2 optional follow-ups; report at scratchpad review-6126427.md); lead-applied prose da4da2a; fixes 26519d2 and in flight
- 2 · cc17c5d · PASS (correctness re-review of 26519d2 8e78067 cc17c5d; every prior finding closed, none new; typecheck clean and `npm run selftest` all passed at cc17c5d)
### Test gate
- Range: this run's commits c802d7b 07dd24a 639039c b8ce743 1d811e3 75382f5 (wigley-ai-gui) and a02ecb4 (marketplace, proved at 03: forms unittest 38 OK). Pass 1, tests the range wrote or edited (18); pass 2, tests with a runtime import of a changed module (6; type-only imports left to typecheck): plugins/forms/main/channel-presenter.test.ts, plugins/forms/main/forms-service.test.ts, plugins/forms/manifest.test.ts, plugins/forms/page/autosave.test.ts, plugins/forms/page/boxes.test.ts, plugins/forms/page/form-state.test.ts, plugins/forms/page/forms-commands.test.ts, plugins/forms/page/forms-store.test.ts, plugins/forms/page/view-model.test.ts, plugins/keys/page/help-sections.test.ts, plugins/keys/page/key-bar.test.ts, plugins/keys/page/which-key.test.ts, plugins/sessions/main/relay/relay-server.test.ts, plugins/sessions/main/session-list.test.ts, plugins/sessions/page/tabs.test.ts, renderer/codemirror-vim/ex-command-name.test.ts, renderer/editor-binds.test.ts, renderer/key-sequences.test.ts, renderer/page-keys.test.ts, renderer/pending-keys.test.ts, renderer/plugins/page-api.test.ts, renderer/shell/modes.test.ts, shared/key-hints.test.ts, shared/plugin-manifests.test.ts · 24 files / 476 tests pass; typecheck clean; `npm run selftest` all passed (97 steps), log clean · lint: layers pass; oxlint/oxfmt flag only docs/features markdown and a peer run's uncommitted files
