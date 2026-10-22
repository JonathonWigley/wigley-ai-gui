# 01 — One-notation keymap in one file

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

One system, kept in one group because the contract change breaks every consumer at compile time: the bind contract,
its expansion in the merge, the user keymap reader, the default keymap file, and the built-in manifests losing `keys`.

Files:     modify `src/contracts/keymap.ts` · `src/contracts/plugin.ts` · `src/shared/define-plugin.ts` ·
           `src/shared/plugin-manifests.ts` · `src/main/config/user-keymap.ts` · `src/main/config/config-store.ts` ·
           `src/main/main.ts` · `src/config/keymap.ts` · `src/plugins/manifests.ts` ·
           `src/plugins/{chat,docs,forms,gallery,keys,sessions}/manifest.ts`
           create `src/shared/key-notation.ts` · `src/plugins/keymap.ts`
           test `src/shared/key-notation.test.ts` · `src/shared/plugin-manifests.test.ts` ·
           `src/main/config/user-keymap.test.ts` · `src/main/config/config-store.test.ts` ·
           `src/plugins/keymap.test.ts` (create) · `src/plugins/forms/manifest.test.ts` ·
           `src/shared/define-plugin.test.ts`, plus each test fixture that builds a manifest with `keys`
           (`grep -rln "keys: {" src --include='*.test.ts'` — measured at plan time: page-api, plugin-host,
           define-plugin, plugin-manifests, selftest-config, main-api, config-store, drive-commands; re-verify), and
           each typed `Keymap` literal the new required `groups` breaks (`grep -rln 'intercept: \[\]' src` — at plan
           time also installed-config, config-push, key-hints, and keys' key-bar, help-sections, keys-for, which-key
           tests; re-verify)
           modify `scripts/check-layers.mts` · `src/plugins/forms/main/selftest-script.ts`
Consumes:  nothing
Produces:  in `src/contracts/keymap.ts`:
           `export type BindWhere = 'page' | 'box' | 'both';`
           `export interface KeyBind { keys: string; scope: ViewScope; command: CommandId; where?: BindWhere; mode?: EditorMode }`
           `export type KeyGroups = Record<string, string>;`
           `export interface DefaultKeymap { leader: string; groups: KeyGroups; binds: KeyBind[]; remaps: EditorRemap[]; app: AcceleratorBind[]; intercept: InterceptBind[]; global: AcceleratorBind[] }`
           `Keymap` gains `groups: KeyGroups`
           `export interface UserKeymap { leader?: string; groups?: KeyGroups; binds?: KeyBind[]; remaps?: EditorRemap[]; app?: AcceleratorBind[]; intercept?: InterceptBind[]; global?: AcceleratorBind[]; unbind?: KeymapUnbind[] }`
           `export type KeymapUnbind = { keys: string; scope: ViewScope; where?: BindWhere; mode?: EditorMode } | { app: string } | { global: string } | { intercept: Omit<InterceptBind, 'command'> }`
           in `src/shared/key-notation.ts`:
           `export function pageKeysFor(keys: string, leader: string): string[]`
           `export function vimTokenForPageKey(key: string): string`
           in `src/shared/plugin-manifests.ts`:
           `export function expandBind(bind: KeyBind, leader: string): { page: PageBind | null; editor: EditorBind | null }`
           `export function mergeKeymap(defaults: DefaultKeymap, manifests: readonly PluginManifest[], user: UserKeymap): Keymap`
           in `src/contracts/plugin.ts`:
           `export interface PluginKeys<PageC extends string, MainC extends string, S extends string> {`
           `  binds?: (Omit<KeyBind, 'scope' | 'command'> & { scope: S | 'any'; command: PageC })[];`
           `  groups?: KeyGroups;`
           `  app?: { accelerator: string; command: MainC }[];`
           `  global?: { accelerator: string; command: MainC }[];`
           `  intercept?: (Omit<InterceptBind, 'command'> & { command: MainC })[]; }`
           (no `remaps`: plugin editor remaps stay a follow-up) · `PluginManifest.keys?: PluginKeys<C, C, S>`
           in `src/plugins/keymap.ts`:
           `export const defaultKeymap = { … } satisfies BuiltInKeymap`, where `BuiltInKeymap` is `DefaultKeymap`
           narrowed so `binds[].command` is a qualified page command of a built-in manifest, `binds[].scope` a
           qualified built-in scope or `'any'`, and accelerator binds' `command` a qualified built-in main command or
           the literal `'window.summon'`
Decisions: one file for every built-in key, typed (round 1) · lands in `src/plugins/` for the layer check (round 2) ·
           one vim notation written once (round 1) · expansion once, in the merge (round 2) · banner sections by area,
           full names (round 2) · keymap.json in the same format, old format rejected (round 2) · today's binds kept
           exactly; box-only leader routes marked `where: 'box'` (round 2) · accelerators keep Electron spelling (round 2) ·
           manifest `keys` optional, for out-of-tree plugins (round 1)

## Pinned rules

**Where a bind fires** (`expandBind`):

| Entry | Page bind | Editor bind |
|---|---|---|
| first token `<Leader>`, no `where` | yes | yes |
| any other keys, no `where` | yes | no |
| `where: 'page'` | yes | no |
| `where: 'box'` | no | yes |
| `where: 'both'` | yes | yes |
| `mode` set | no | yes, in that mode |

- An entry with `mode` takes no `where` or `where: 'box'`; any other `where` is an error.
- A chord — a token for which `parseChord(token) !== null` (`src/shared/chord-notation.ts`; not `isChordToken`, which
  is true for every `<…>` token) — alone in `keys` takes no `where` or `where: 'page'`: a chord page bind already fires
  inside a box. Any other `where` is an error. A chord must match `CHORD_NOTATION` exactly (uppercase modifiers, as
  today).
- The editor bind keeps `keys` as written (`<Leader>` stays literal, as today); the page bind's keys are
  `pageKeysFor(keys, leader)`, called only for an entry that makes a page bind, so a box-only entry's keys stay as
  free as editor keys are today.
- `<Leader>` is matched case-sensitively, as `withLeader` does today.

**Token conversion** (`pageKeysFor`; `<Leader>` is spelled as `leader` first; the named-key rows match
case-insensitively, `<cr>` as `<CR>`; chords do not case-fold):

| Vim token | Page key |
|---|---|
| `<Space>` | `' '` |
| `<CR>`, `<Enter>` | `'Enter'` |
| `<Esc>` | `'Escape'` |
| `<Tab>` | `'Tab'` |
| `<BS>` | `'Backspace'` |
| `<lt>` | `'<'` |
| `<Bslash>` | `'\\'` |
| a chord token (`<A-o>`, `<D-Enter>`, `<A-S-o>`) | the token unchanged |
| one character | itself |

Any other `<…>` token throws `Error('<token> is not a key the page can bind.')`. `vimTokenForPageKey` is the inverse
for the first seven rows (`'Enter'` → `<CR>`), and returns a chord or one character unchanged.

**Merge** — today's layering, with binds expanded first:

1. leader = `user.leader ?? defaults.leader`.
2. Layer 1: `defaults` expanded. Layer 2..n: each manifest's `keys` in `dependencyOrder`, commands and scopes qualified
   as today (`any` unqualified), expanded. Then `user.unbind`, then the user layer expanded.
3. An unbind `{ keys, scope, where?, mode? }` is expanded by the same table and removes each page and editor bind it
   matches by today's identities (`bindIdentities`).
4. `groups`: defaults, then each manifest's `groups`, then the user's; a later key equal after `withLeader` replaces
   the earlier name.

**User keymap reader** (`parseUserKeymap(text, names)`, same signature):

- Sections: `leader`, `groups`, `binds`, `remaps`, `app`, `intercept`, `global`, `unbind`.
- `leader` must be one token that `pageKeysFor` converts and that is not a chord; otherwise it throws
  `"leader" must be one key, such as "<Space>" or ",".`
- `page` or `editor` at the top level throws
  `"<section>" is an old keymap section: write its binds under "binds" in vim notation.`
- A `binds` entry: fields `keys`, `scope`, `command` required, `where`, `mode` optional; `keys` non-empty and every
  token convertible (the conversion's own error, prefixed with the entry's path); `command` a page command;
  `where`/`mode` checks as above, each error naming the path; an insert-mode entry's keys one of `UNBOUND_INSERT_KEYS`
  (today's check).
- `groups`: an object whose every key starts with `<Leader>` and every value is a non-empty string.
- `remaps`, `app`, `intercept`, `global` read as today; `unbind` takes the new keys form beside the three accelerator
  forms.

**The default keymap file** (`src/plugins/keymap.ts`):

- Opens with a comment pointing at `docs/keymap.md`, then banner sections, in this order: Windows and modes, Tabs and
  sessions, Help, Forms, Chat, Docs, Gallery, Debug and testing, App chords.
- Within a section, entries keep today's served order: the manifest's page-bind order, then its box-only entries in
  their editor-bind order. The served order drives which-key, help, the key bar and `mergeHints`' neighbour merging,
  which the sorted snapshot cannot see.
- Checked with `satisfies BuiltInKeymap` (Produces), never annotated `: DefaultKeymap`, which would widen command
  names to `string`. Derive the unions from a typed tuple of the built-in manifests in `src/plugins/manifests.ts`;
  `definePlugin` captures the literal `id` (`const Id extends string`) so the qualified names can be built.
- Layer check (`scripts/check-layers.mts`, which reads type-only imports too): add `'src/plugins/keymap.ts'` with
  layers contracts, shared and `src/plugins/manifests.ts`; add `'src/plugins/keymap.test.ts'` with the same plus
  `src/plugins/keymap.ts`, following the `src/main/built-in-themes.test.ts` entry; add `src/plugins/keymap.ts` to
  `src/main/main.ts`'s list.
- `leader: '<Space>'`, `remaps: []`, `intercept: []`,
  `global: [{ accelerator: 'Control+Alt+Command+W', command: 'window.summon' }]` (moved from `coreKeymap`).
- `groups` (pinned): `'<Leader>k': 'windows'`, `'<Leader>z': 'debug'`, `'<Leader>zl': 'forms layouts'`,
  `'<Leader>zc': 'chat layouts'`, `'<Leader>c': 'chat controls'`, `'<Leader>a': 'answer'`.
- Every bind today's manifests declare, written once each: a page bind and an editor bind with the same command,
  scope and leader keys become one entry; a box-only leader route takes `where: 'box'`; a page-only leader route takes
  `where: 'page'`. Forms' `<Leader><Leader>` is a page bind in `forms.forms` and an editor bind in `forms.forms` and
  `forms.review`: one entry `both` for `forms.forms`, one `box` for `forms.review`. Forms' digit choices and chat's and
  docs' list binds may be built with `map` as the manifests do today.
- No key changes in this task; task 03 makes them.

## Tests

GIVEN / WHEN / THEN for `expandBind` and `mergeKeymap` (`src/shared/plugin-manifests.test.ts`):

- GIVEN `{ keys: '<Leader>ks', scope: 'any' }` and leader `<Space>` WHEN merged THEN page keys `[' ', 'k', 's']` and
  editor keys `'<Leader>ks'` — `mergeKeymap_LeaderBind_FiresOnPageAndInBox`
- GIVEN `gg` WHEN merged THEN page `['g', 'g']`, no editor bind — `mergeKeymap_RawKeys_FirePageOnly`
- GIVEN `<Esc>` scope `x` THEN page `['Escape']` — `mergeKeymap_NamedKey_ConvertsToPageKeyName`
- GIVEN `<CR>` `where: 'box'` THEN editor `'<CR>'` only — `mergeKeymap_WhereBox_FiresInBoxOnly`
- GIVEN `<CR>` `mode: 'insert'` THEN one editor bind in insert mode — `mergeKeymap_InsertMode_IsEditorOnly`
- GIVEN `<A-o>` THEN page `['<A-o>']` only — `mergeKeymap_Chord_IsPageBindOnly`
- GIVEN `<A-o>` `where: 'box'` THEN throws naming the chord — `expandBind_ChordInBox_Throws`
- GIVEN user leader `,` THEN the default `<Leader>ks` page keys are `[',', 'k', 's']` —
  `mergeKeymap_UserLeader_RespellsPageLeader`
- GIVEN a default `<Leader>ks` and a user bind on `<Leader>ks` scope `any` with another command THEN both halves name
  the user's command — `mergeKeymap_UserBind_ReplacesBothHalves`
- GIVEN unbind `{ keys: '<Leader>ks', scope: 'any' }` THEN neither half remains — `mergeKeymap_Unbind_RemovesBothHalves`
- GIVEN unbind with `where: 'box'` THEN only the page half remains — `mergeKeymap_UnbindWhereBox_KeepsPageHalf`
- GIVEN default group `<Leader>k` `windows` and user `<Leader>k` `panes` THEN served `groups['<Leader>k']` is `panes` —
  `mergeKeymap_UserGroup_ReplacesDefaultName`
- GIVEN a manifest with `keys.binds` `{ keys: 'x', scope: 's', command: 'c' }` id `p` THEN page bind scope `p.s`,
  command `p.c` — `mergeKeymap_ManifestKeys_AreQualified`

`src/shared/key-notation.test.ts`: each row of the conversion table both ways; `<F5>` throws naming `<F5>`;
`<cr>` converts as `<CR>`.

`src/main/config/user-keymap.test.ts`: replace today's page/editor cases with the new sections; add
`parseUserKeymap_OldPageSection_NamesTheNewSection`, `parseUserKeymap_ModeWithWherePage_Throws`,
`parseUserKeymap_GroupKeyWithoutLeader_Throws`, `parseUserKeymap_UnknownToken_NamesEntryPath`.

`src/plugins/keymap.test.ts`: `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` —
`mergeKeymap(defaultKeymap, manifests, {})` passes `requireUnambiguousKeymap` and `requireWellFormedChords`.

Existing tests that built manifests with `keys` or called `mergeKeymap(core, …)` move to the new shapes with the
same claims. The case in `src/plugins/forms/manifest.test.ts` that merges `formsManifest`'s keys is deleted, with a
Run log line: the snapshot diff pins every forms bind, and `formsManifest` no longer has keys.

`src/main/config/user-keymap.test.ts` also gets `parseUserKeymap_ChordLeader_Throws`.

## Forms self-test

`src/plugins/forms/main/selftest-script.ts` writes user keymaps in the old format; rewrite them in the new one, same
behaviour:

- `userKeymap(command)`: `{ binds: [{ keys: 'Q', scope: 'any', command }] }`; the step expecting
  `"page[0].command" names no command …` expects `"binds[0].command" names no command "keys.noSuchCommand".`
- `MOVED_NOT_APPLICABLE_KEYMAP`: `binds: [{ keys: '<Leader>q', scope: 'forms.forms', command:
  'forms.toggleNotApplicable', where: 'box' }]`, `unbind: [{ keys: '<Leader>x', scope: 'forms.forms', where: 'box' }]`.
- `COMMA_LEADER_KEYMAP`: `{ leader: ',' }`. It now respells the page leader too; the steps run under it press no page
  leader (checked at plan time; re-verify).

## Proof

Migration snapshot: before the first edit the run's preconditions confirm `keymap-before.txt` matches the tree. After
this task, write a temporary vitest file (not committed) that runs `mergeKeymap(defaultKeymap, manifests, {})` and
prints one sorted line per bind in exactly this shape, then diff against `keymap-before.txt`:

```
page  <scope>  <JSON of keys>  <command>
box   <scope>  <keys>  <mode or normal>  <command>
remap <mode> <keys> <to>
app   <accelerator>  <command>
icpt  <JSON of bind>
glob  <accelerator>  <command>
leader <leader>
```

(For the baseline run at preflight, the same file calls `mergeKeymap(coreKeymap, manifests, {})` before task 01.)

Done when: `npm run typecheck`, `npm run lint` and the test gate pass; the snapshot diff is empty; no built-in
manifest declares `keys`; `coreKeymap` no longer exists.
Commit:    one commit for the group

Landed in dd4eba3. Snapshot diff against keymap-before.txt empty; typecheck and lint clean; every Produces signature present; no built-in manifest declares `keys`; `coreKeymap` gone. Concerns: see plan.md Run log, group 01.
