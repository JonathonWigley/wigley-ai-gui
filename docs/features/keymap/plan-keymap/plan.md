# One-file keymap — plan

Feature: keymap · Implements: none · Ticket: none
Target: main · Written: 2026-10-22

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every default key of the app lives in one typed file, `src/plugins/keymap.ts`, as one vim-notation entry per bind,
with named which-key groups; the user's `keymap.json` takes the same entries. Three key changes bring the app in line
with the user's Rider, tmux, Ghostty and Neovim habits. `docs/keymap.md` (already committed) is the rule for future
keys.

## Architecture

Systems touched:

- **Keymap contract** (`src/contracts/keymap.ts`, `src/contracts/plugin.ts`): the authored bind entry `KeyBind`, the
  `DefaultKeymap` the file exports, the served `Keymap` gaining `groups`, the user's `UserKeymap` and `KeymapUnbind`
  in the new shape, a manifest's `keys` made optional and moved to the new shape.
- **Merge** (`src/shared/plugin-manifests.ts`, new `src/shared/key-notation.ts`): expands each `KeyBind` into the page
  bind and editor bind it stands for, then layers as today. The key engine, vim host and hints keep reading the served
  `Keymap` unchanged.
- **User keymap reader** (`src/main/config/user-keymap.ts`): reads the new format.
- **Default keymap file** (`src/plugins/keymap.ts`, `src/plugins/manifests.ts`): every built-in key, typed against the
  built-in manifests; built-in manifests lose `keys`.
- **ConfigStore wiring** (`src/main/config/config-store.ts`, `src/main/main.ts`, `src/config/keymap.ts`).
- **Keys plugin** (`which-key.ts`, `key-bar.ts`): group names, leader from the keymap.
- **Docs, chat, gallery**: new half-page scroll and page-up commands.

## Preconditions

Re-run each before the first dispatch.

| Claim | Command | Expected (2026-10-22) |
|---|---|---|
| Base suite green | `npm test 2>&1 \| grep -E "Test Files\|Tests  "` | 141 files, 1941 tests passed (measured at plan time, re-verify) |
| Typecheck green | `npm run typecheck` | no errors |
| No user keymap.json on this Mac to migrate | `test -e ~/.config/wigley-ai-gui/keymap.json && echo HAS \|\| echo NONE` | `NONE` |
| Baseline snapshot matches the tree | the snapshot recipe in task 01 § Proof run at the start of the run, diffed against `keymap-before.txt` | no diff |
| Docs written ahead are committed | `git log --oneline -1 -- docs/keymap.md` | `cc4145e` |

A peer session is editing `src/main/drive/*`, `scripts/drive*.mts` and `.agents/skills/drive/SKILL.md` in this working
tree. Task 01 may need to drop `keys` from a test fixture in `src/main/drive/drive-commands.test.ts`; touch only that
fixture, and commit only the paths this plan names.

## Docs written ahead

Commit `cc4145e`: `docs/keymap.md` (new — the key-assignment rule), `AGENTS.md` (keys paragraph, `src/config/` line,
pointer), `DESIGN.md` § Keys and focus, `docs/features/ui-design/design.md` (keymap.json), `docs/features/docs-browser/design.md`
(keys), `docs/features/ui-design/live-checks.md` (D2, D5, D13), `docs/features/followups.md` (page-leader item). Task 04
re-reads each against the landed code.

## Mandatory Reads

- `AGENTS.md` (§ Architecture: "A key", "A key scope", "Key hints", "The user config folder"; § Running and testing)
- `DESIGN.md` § Keys and focus
- `docs/keymap.md`
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in this repo (`git ls-files | grep -E 'CLAUDE|\.claude/rules'` is empty).

## Design Overview

```
src/plugins/keymap.ts ──────────────┐  DefaultKeymap: leader, groups, binds: KeyBind[], remaps, app, intercept, global
manifest.keys (out-of-tree only) ───┤  binds/groups in the same shape, short ids, qualified by the merge
~/.config/.../keymap.json ──────────┤  UserKeymap: same shape + unbind
                                    ▼
             mergeKeymap(defaults, manifests, user)      src/shared/plugin-manifests.ts
               each KeyBind ─ expandBind(leader) ─► PageBind (page keys) and/or EditorBind (vim keys)
               layers: defaults → manifests (dependency order) → user unbind → user binds
                                    ▼
             served Keymap { editor{leader,remaps,binds}, page, app, intercept, global, groups }
                                    ▼
   page keys · vim host · which-key (+ group names) · key bar · help · keysFor      (unchanged readers)
```

Decisions (interview rounds 1–2):

- One file for every built-in default key, typed so a wrong command or scope name fails the build (round 1). It sits
  at `src/plugins/keymap.ts`, since the layer check lets `src/config` import only contracts (round 2, Decided).
- One vim notation, written once; a leader bind fires on page and in a box, any other bind on the page; `where`
  narrows (round 1). Bind expansion happens once, in the merge (round 2, Decided — locality).
- Banner sections by area, commands and scopes named in full (round 2, Decided).
- `groups` names leader prefixes for which-key; an unnamed prefix keeps today's label from command groups (round 1, 2).
- `keymap.json` takes the same format; an old-format file fails to load with a message (round 2, Decided).
- Every key keeps today's behaviour apart from the three changes below (round 2, Decided); box-only leader routes are
  marked `where: 'box'`.
- Accelerator binds (app, intercept, global) keep Electron spelling (round 2, Decided).
- Key changes (round 1): docs focus tree/doc `<C-l>`/`<C-h>` → `<A-l>`/`<A-h>`; `<C-j>`/`<C-k>` half-page scroll in
  the doc view and the chat transcript; gallery page down `d` → `<C-j>`, page up `<C-k>` added.
- The rule lives in `docs/keymap.md` (round 1, the user's choice over DESIGN.md).

Design review (Decided):

- The layered merge, "a later layer replaces the same keys in the same scope", and the keymap checks hold up and stay.
- One conversion seam (`expandBind`) serves defaults, manifests, user binds and unbinds alike — depth: one rule for
  where a bind fires, tested once.
- Command and scope names are checked by the compiler through the built-in manifests' literal types, not by a test
  (`wigley:writing-tests` § What earns neither).
- `groups` travels in the served `Keymap`, so which-key reads one source on both sides (locality).

Out of scope (tracked in `docs/features/followups.md`): the portable primary modifier (`<M-w>`), one `keyHint`
helper, plugin editor remaps, command palette and fuzzy finders (keys reserved in `docs/keymap.md`), commands that
take a count.

## File Structure

Modified:

- `src/contracts/keymap.ts` — `BindWhere`, `KeyBind`, `KeyGroups`, `DefaultKeymap`; `Keymap.groups`; new
  `UserKeymap`, `KeymapUnbind`.
- `src/contracts/plugin.ts` — `PluginKeys` in the new shape, `PluginManifest.keys` optional, `QualifiedCommandId` and
  `QualifiedScopeId` helper types.
- `src/shared/define-plugin.ts` — captures the literal plugin id; `keys` optional.
- `src/shared/plugin-manifests.ts` — `mergeKeymap(defaults: DefaultKeymap, manifests, user)` expanding binds.
- `src/main/config/user-keymap.ts` — reads the new format.
- `src/main/config/config-store.ts`, `src/main/main.ts` — take `defaultKeymap` in place of `coreKeymap`.
- `src/config/keymap.ts` — keeps `coreCommands` and `coreScopes`; `coreKeymap` leaves.
- `src/plugins/manifests.ts` — a typed tuple of the built-in manifests beside the existing list.
- `src/plugins/{chat,docs,forms,gallery,keys,sessions}/manifest.ts` — `keys` removed; docs, chat and gallery gain
  commands in task 03.
- `src/plugins/keys/page/which-key.ts`, `key-bar.ts` — group names; leader from the keymap.
- `src/plugins/docs/page/{doc-view,docs-view,start}.ts`, `src/plugins/chat/page/{entry-list,start}.ts` (or the file
  holding chat's command handlers), `src/plugins/gallery/page/start.ts` — handlers for the new commands.
- `src/plugins/docs/main/selftest-script.ts`, `src/plugins/chat/main/selftest-script.ts` — steps for the moved and new keys.
- `src/plugins/forms/main/selftest-script.ts` — its user keymaps in the new format (01); its gallery `d` steps (03).
- `scripts/check-layers.mts` — entries for `src/plugins/keymap.ts` and its test; `main.ts` may import it.

New:

- `src/plugins/keymap.ts` — the default keymap; the user's one place to read and edit every key.
- `src/shared/key-notation.ts` (+ test) — vim tokens ↔ page key names; both the merge and which-key need it, and
  `key-hints.ts` is about printing hints, not converting binds.
- `src/plugins/keymap.test.ts` — the built-in keymap merges with no clash.

Boundary rules: `src/plugins/keymap.ts` is a layer of its own in `scripts/check-layers.mts`, importing only
contracts, shared and `src/plugins/manifests.ts`; `src/main/main.ts` gains it; `src/config` keeps importing only
contracts (`npm run lint` runs the layer check, type-only imports included).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [One-notation keymap in one file](01-one-notation-keymap.md)

### Wave 2
- [x] [Which-key group names and the key bar's leader](02-which-key-groups.md) — after 01
- [x] [Key changes: Alt focus, Ctrl half-page scroll, gallery paging](03-key-changes.md) — after 01

### Wave 3
- [x] [Doc re-read](04-doc-re-read.md) — after 01, 02, 03

### Wave 4
- [ ] [Final verification](05-final-verification.md) — after 04

## Run log

Review base: dd75a8ebcf51bcb1e2073700abd614f8543886e8

### Groups
- 01 · dd4eba3 · proved: snapshot diff empty, typecheck + lint clean, Produces present · concerns: served editor-bind order shifts where a page+box entry merged into one (box half now sits at the merged entry's place); installedConfig serves pushed `groups` beside old applied binds on a refused push; reader validates unknown-leader files with a stand-in `<Space>`
- 02 · 53431db · proved: diff read, typecheck clean with 03 landed (tree did not compile until 03's commands existed), lint clean, keys plugin tests 32/32 · concerns: group keys match vim tokens case-sensitively (`<space>` ≠ `<Space>`); a leader the page cannot bind makes barHints throw on every render rather than at keymap load
- 03 · d53ef47 · proved: snapshot diff exactly the 3 removed + 8 added pinned rows, typecheck + lint clean · concerns: in docs edit mode `<C-j>`/`<C-k>` scroll the pane, which is `overflow: hidden` while editing, so they do nothing yet still take Ctrl+j/k from vim (DocumentEditor has no scroll); chat `<C-k>` while following snaps back to the bottom on the next entry
- 04 · 954503d + 38327eb · proved: diff read against code; first pass claimed the gallery scrolls half a page (it pages a whole page), fixed in a second dispatch; lint clean · concerns: docs/keymap.md Leader groups table names ("windows and modes", "debug and testing") differ from the which-key names in `groups` ("windows", "debug"); DESIGN.md needed no change
### Contract changes
- typed manifest tuple: as planned → `builtInManifests` (`as const`) in src/plugins/manifests.ts; `BuiltInKeymap` module-private · why: naming · consumers: none · group 01
- ConfigStore deps: `coreKeymap: Keymap` → `defaultKeymap: DefaultKeymap` · why: File Structure wording · consumers: none · group 01
- `QualifiedCommandId<M, P>`, `QualifiedScopeId<M>` added to src/contracts/plugin.ts · why: named by File Structure · consumers: none · group 01
### Rulings
- src/plugins/forms/manifest.test.ts deleted whole: its one case merged formsManifest's keys, which no longer exist; the snapshot diff pins every forms bind — task doc asks for it — none · group 01
- every `<Leader>z…` bind sits in Debug and testing with `where: 'page'`; Gallery section holds only gallery.gallery binds — `z` group is debug — entries move between banners, no behaviour change · group 01
- user keymap reader checks bind/unbind keys through expandBind, error prefixed with the entry path; a file with no leader checks against a stand-in `<Space>` — one rule source — error wording only · group 01
- reader error noun is now "a bind" (was "a page bind"/"an editor bind") — one bind kind — error wording only · group 01
- docs/keymap.md oxfmt-formatted (whitespace) — committed file failed lint, which task 01's done-when needs — none · lead
- group-name match compares token arrays, not joined strings; a named prefix's `+<name>` replaces the command-group label; barHints_Page_LeavesOutSpaceKeysWhateverTheEditorLeader replaced by barHints_UserLeader_LeavesOutLeaderSequences — spec reading — label wording only · group 02
- src/plugins/chat/page/chat-view.ts widened (`ChatSession.entries` Pick gains `scrollHalfPage`), outside the Files list — handlers could not reach it otherwise — none, type-only · group 03
- half-page handlers log nothing of their own; self-test expects the page engine's `[page] <C-j> ran <command>` line — matches scrollDown/Up — expects need a plugin line if wrong · group 03
- test gate and review run before task 05's live checks, so review fixes are inside what the live run checks — order only · lead
### Review rounds
- round 1 · 7526fd5 · NEEDS FIXES · 10 findings, 2 follow-ups · lead-applied 8510f64 · fixes b362ef6 (4), 8fba8f0 (7), a409766 (10), f6e5fb9 (3), 486595f (8), 473f691 (9), 1ce541a (6), 0d85b5c (5, F2), de86dd7 (2), c62a431 (1) · user chose: doc editor scrolls itself; chat Ctrl+k off the bottom stops following, Ctrl+j/G at the bottom resumes (Enter is chat.toggleEntry, not free); pushed groups kept, comment corrected; ⌘↩ everywhere
### Test gate
- picked: every test the range added or edited except the peer's drive tests (config-store, user-keymap, main-api, selftest-config, plugins/keymap, keys' help-sections/key-bar/keys-for/which-key, config-push, installed-config, page-api, define-plugin, key-hints, key-notation, plugin-host, plugin-manifests); chat-commands (new half-page handlers); keymap-checks (fed by the new merge); page-keys (reads the expanded page binds and chords). Self-test steps and scroll behaviour left to task 05's live run · 20 files, 264 tests passed
