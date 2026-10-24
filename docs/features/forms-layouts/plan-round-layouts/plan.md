# Round-chosen forms layouts — plan

Feature: forms layouts · Implements: none · Ticket: none
Target: main · Written: 2026-10-24

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

An agent controls how a forms round looks from inside the round: the round and each item may name a layout from
the user's layouts folder, a layout may define only the cards and panes it changes, and layouts draw the whole
forms view (cards, head, rail, review). Finding answers are grouped under their actions, so one pick sets choice and
action. The user keeps one layout of their own through a `forms.layout` setting (`chat.layout` for chat); cycling
and copying layouts are removed.

## Architecture

Systems touched:

- **Shared layout registry** (`src/shared/layouts/`) and **loader** (`src/shared/page/layout-loader.ts`), used by
  forms and chat: one active layout becomes a set of layouts, each with its own revision and stylesheet.
- **Forms main** (`src/plugins/forms/main/`): round parsing, the `ask_round` schema and text, layout-name checks,
  the finding answer model in the payload, the self-test and the preview round.
- **Forms page** (`src/plugins/forms/page/`): the layout resolver, the answer state, the rail and review built by
  layouts, the default layout, and the page exports and events.
- **Forms layout contract** (`src/plugins/forms/layouts/layout.d.ts`) and the built-in `default` layout.
- **Chat** (`src/plugins/chat/`): its layout comes from `chat.layout`; its cycle and copy keys go.
- **wigley-ai-marketplace**: the forms README (the tool contract), the review and make skills' round-building
  text, and retro's reading of a finding pick (`scripts/retro/answers.py`).

## Preconditions

Each is re-run by `wigley:make` before the first dispatch.

- The peer run `docs/features/keys-standards/plan-forms-scroll-keys/` has closed, so no other run edits forms in this
  tree: `test ! -d docs/features/keys-standards/plan-forms-scroll-keys && echo closed`. At plan time it was in its
  final verification, with uncommitted plan-folder edits that are that run's own.
- No peer's uncommitted edits sit in the files this plan changes: `git status --short src` prints nothing. At plan
  end a peer session had uncommitted edits in forms, chat, docs, gallery, keymap and `src/shared` (a scroll-keys
  change); they are that session's own, and the run waits for them to land or runs in a worktree the user asks for.
- The docs written ahead are at the target tip: `git merge-base --is-ancestor 8ff01a66 HEAD && echo ok`.
- `relay.py` forwards `ask_round` unchanged and holds no schema of its own (its stand-in is `{"type": "object"}`):
  `grep -n '"inputSchema"' ../wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py`. So no relay code
  changes; the contract change is the README's.
- No Python fingerprint exists any more: `grep -rln fingerprint ../wigley-ai-marketplace/plugins/wigley/scripts`
  lists only `forms/README.md` and `retro/tests/test_answers.py` (measured at plan time, re-verify).
- Retro's reader reads `choice`, `action` and `choices[].text` and ignores unknown keys
  (`../wigley-ai-marketplace/plugins/wigley/scripts/retro/answers.py`, `_choice_label`), so the new optional keys
  alone need no retro change. Its reading of a finding pick does change: `_action_pick` and `_action_label` read
  `choice` and `action` by the old rule (a `fix_now` or `follow_up` pick needs a solution; a one-solution finding's
  choice 0 reads as solution 1), so task 06 moves them onto the card's entries:
  `grep -n "def _action_pick\|def _action_label" ../wigley-ai-marketplace/plugins/wigley/scripts/retro/answers.py`.

## Docs written ahead

Commit `8ff01a66` (wigley-ai-gui): `AGENTS.md` (A layout, A forms layout, A finding origin, Debug and testing keys),
`docs/keymap.md` (`a`, `zl` rows; `zc` row removed), `docs/features/agent-chat/design.md` (Layouts),
`docs/features/followups.md` (partial forms layouts and forms page exports taken into this work; scoped CSS taken
out of the layouts-service item), `docs/features/master-plan.md` (item 15).

The marketplace docs (the forms README and the review and make skill text) are **not** written ahead: the
marketplace lands on `main`, any session's push ships it, and skills telling agents to send `layout`, a choice
`action` or `action_reasons` before the app accepts them would fail every such round. They land in task 06, after
the app code, in one commit with retro's new pick reading and the version bump.

## Mandatory Reads

- `AGENTS.md` (wigley-ai-gui), `DESIGN.md`, `docs/keymap.md`
- `../wigley-ai-marketplace/AGENTS.md`, `../wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md`
- `../wigley-ai-marketplace/CLAUDE.md` holds only `@AGENTS.md`; neither repo tracks `.claude/rules/*.md`.

## Design Overview

```
agent ── ask_round { layout?, items[].layout?, finding.choices[].action?, finding.action_reasons? }
            │
forms main  ├─ parseRound: unknown layout name ─► error listing layoutNames()
            │  layout fields stay out of the fingerprint
            ▼
registry ── watches every layouts/<name>/ folder; announces LayoutSet (each layout: name, revision, css)
            │
forms page  ├─ loader: one module + one <link data-layout> per layout in use, cached by name+revision
            ├─ resolver: item.layout → round.layout → forms.layout setting → default, per card kind / pane
            ▼
layout builders  question · finding · notice · head · rail · review     (default complete, user layouts partial)
            │    the root of every card and pane carries data-layout="<name>"
            ▼
finding card    Fix now                 a1…a9 number down the card; a group with no
                  1 Drop the short copy  choices takes one number on its header;
                  2 Add the missing line picking sets choice + action together
                Follow-up (3)  ← action_reasons.follow_up shown here when sent
                Leave it (4)     (a header's "(3)" sits in span.choice-number)
```

Decisions (from the interview):

- A round and each item may name a layout; the most specific wins, per card kind or pane: item, round,
  `forms.layout`, `default`.
- Layouts reach the whole forms view: cards, head, rail, review. The app keeps selection, keys, scrolling, the
  split width, the status bar line and the cancel dialog.
- `forms.layout` and `chat.layout` settings replace `layouts/active`; the next, previous and copy commands and keys
  go in both plugins; the preview key `Space z l o` stays and draws in the user's layout.
- Agent-written layouts: the agent writes the layout folder, names it in the round, and lists it in a notice.
- Finding choices carry an `action` (`fix_now` when left out). `action_reasons: { follow_up?, leave_it? }` is accepted
  only for actions the origin offers. `recommend` names a choice of the recommended action and is left out when
  that action has no choices.
- The default layout draws action groups; the separate action row is removed everywhere.
- Keys: `a1`…`a9` (and the raw `choose1`…`choose9`) pick the numbered entry down the card — a choice, or the header
  of an action with no choices. The `af` / `au` / `as` keys and their commands (`fixNow`, `followUp`, `leaveIt` —
  check the manifest's names) are removed.
- An unknown layout name fails `ask_round`, listing the folder's layouts. Layout names stay out of the fingerprint;
  a re-send keeps the layouts the round opened with.
- Every layout folder is watched; each layout has its own revision and stylesheet link; `data-layout` scopes CSS.
- `readLayout` requires every card and pane only of `default`.
- The forms page exports and events follow-up lands here: `activeRound()`, `answers(roundId)`, card parts and review
  columns, the events `roundShown` / `answerChanged` / `roundFinished` / `viewChanged`, and `kit.command(qualifiedId)`
  / `kit.keysFor(qualifiedId)`.

Design review (Decided): one pure resolver module (depth); the registry announces a set with per-layout revisions
(seam); `FormsService` receives `layoutNames()` from the composition root (seam); the payload keeps `choice` (0 for no
choice or a header pick) and `action`, so retro reads the same keys, and only its reading of a finding pick changes, in task 06.

Out of scope: keeping the user's place across a layout hot reload (follow-up "A layout hot reload keeps the user's
place"); partial chat layouts and string-typed kinds (follow-ups); layouts as a core service (master-plan 15).

## File Structure

Shared names every part uses. A task document gives each one's full signature where it produces it.

- `src/contracts/layouts.ts` — `LayoutChoice` is replaced by:
  - `interface LayoutEntry { name: string; revision: number; hasCss: boolean; builtIn: boolean }`
  - `interface LayoutSet { layouts: LayoutEntry[]; changed: string | null }` — `changed` names the layout a reload
    touched, `null` at start.
- `src/shared/layouts/layout-registry.ts` — `LayoutRegistry` becomes `{ current(): LayoutSet; names(): string[]; … }`
  with `cycle` and `copy` removed; `start`, the watch and the queue as today.
- Forms and chat channel contracts: the `layout` request returns `LayoutSet`; the `layoutChanged` message carries
  `LayoutSet`; `cycleLayout` and `copyLayout` are removed (`openPreview` stays in forms).
- Settings: forms' manifest `settings.layout` (string, default `'default'`, read as `forms.layout`) and chat's
  `settings.layout` (`chat.layout`), each with its `settingInfo` label and description. The page reads its plugin's
  setting through `settings()` and `onSettingsChanged` (`src/contracts/plugin.ts`); a name missing from the set falls back to `default` and logs
  `layout <name> not found, drawing default`.
- Forms contract (`src/plugins/forms/contract.ts`):
  - `Round.layout: string | null`; `Question.layout`, `Notice.layout` and `FindingFields.layout`: `string | null`
  - `FindingChoice { text: string; reason: string; action: FindingAction }` — the wire `action` is optional and
    parses to `fix_now`
  - `FindingFields.actionReasons: Partial<Record<'follow_up' | 'leave_it', string>>` — wire key `action_reasons`
  - `FindingFields.recommend: number | null` — `null` only when the recommended action has no choices
- `FormsService` deps gain `layoutNames: () => readonly string[]`, filled from the registry's `names()` in
  `src/plugins/forms/main/start.ts`.
- Page: `src/plugins/forms/page/layout/layout-resolver.ts` (new) —
  `type LayoutPart = 'question' | 'finding' | 'notice' | 'head' | 'rail' | 'review'`,
  `layoutChain(itemLayout: string | null, roundLayout: string | null, userLayout: string): string[]`,
  `pickLayout(part: LayoutPart, chain: readonly string[], loaded: ReadonlyMap<string, Layout>): { name: string; layout: Layout }`
  — always returns, ending at `default`.
- Page finding answer: a pick is `{ choice: number; action: FindingAction }`, `choice` 0 for a header pick; the
  numbering helper `findingEntries(finding)` (in `src/plugins/forms/finding-pick.ts`) lists the card's entries in
  draw order, each a choice or a bare action header, so keys, the kit and the review read one order.
- Layout contract (`layout.d.ts`): `Layout { cards?: Partial<{ question; finding; notice }>; head?; rail?; review? }`;
  `FindingCard.choices` items gain `action`; `FindingCard` gains `actionReasons` and `entries`; the finding kit's
  `choiceList` + `actionRow` are replaced by `choiceGroups(parent, reasons)`. Rail and review inputs and kits are
  task 05's.

Boundary rules: forms imports only `src/contracts`, `src/shared`, its own folder and the contracts of plugins it
depends on; `npm run lint` checks it. No new plugin, adapter or layer.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Layout sets and the layout settings](01-layout-sets-and-settings.md)

### Wave 2
- [x] [Round data: layout names, choice actions, deferral reasons](02-round-data.md) — after 01

### Wave 3
- [x] [Page loader and layout resolver](03-loader-and-resolver.md) — after 01, 02

### Wave 4
- [x] [Finding answer model on the page](04-finding-answer-model.md) — after 02, 03

### Wave 5
- [ ] [Layout contract: panes, grouped choices, default layout](05-layout-contract-and-default.md) — after 03, 04
- [x] [Marketplace contract and skills](06-marketplace-contract-and-skills.md) — after 02, 04

### Wave 6
- [ ] [Forms page exports and events](07-page-exports-and-events.md) — after 05
- [ ] [Self-test and preview round](08-selftest-and-preview.md) — after 05

### Wave 7
- [ ] [Doc re-read](09-doc-re-read.md) — after 06, 07, 08

### Wave 8
- [ ] [Final verification](10-final-verification.md) — after 09

## Run log

Review base: 092ace4b241cdae4b0c66ce5933c8a1387c59c61

### Groups
- 01 · e44a22ec · diff read: every Produces signature present; typecheck passes; worker ran lint and the three test files (90 tests) green · concerns: REVIEW_STEPS <C-k> why still names the layout cycle (08 rewords); both pages drop the onSettingsChanged disposable (brief's verbatim wiring); registry's 'not reloaded' catch now covers any folder's re-listing
- 02 · b8661bcd · diff read: every Produces signature present; typecheck passes; worker ran lint and the full suite (2783 tests) green · concerns: AGENTS.md's per-kind records list lacks ROUND_ITEM_LISTS (doc re-read 09); page test-rounds decision()/nit() fixtures no longer parse (04); holdsRecommendedPick wrong while recommend is null (04); selftest fixture finding 3 breaks recommend rule (08, planned)
- 03 · d6537cad · diff read: every Produces signature present; typecheck passes; worker ran lint and the full suite (2803 tests) green · concerns: forms page calls refresh() on every store dispatch, keystrokes included (cheap); layout.d.ts comments are read by layout authors (doc wording check); feature design docs may still describe the single-layout loader (09); DOM paths have no unit tests (08, 10 live checks)
- 04 · 731a30c3 · diff read: every Produces signature present; typecheck passes; worker ran lint and the full suite (2782 tests) green; Done-when grep empty · concerns: forms.css keeps dead .choices.is-dimmed, .finding-actions and .action-picks rules (05 restyles; review); selftest still presses f/u/s until 08; test builder decision() recommends a pick that is no entry
- 06 · f402c1eb (marketplace) · diff read; retro suite 162 tests OK; check_manifests passes (worker); forms Python suite's 12 relay/nvm failures pre-exist on this machine, fingerprint test passes · concerns: README now states the app's at-least-one fix_now choice rule, which the plan never named; nit plain-label test's claim moved to no-pick since no valid pick reaches the fallback; other marketplace suites fail identically at HEAD on Windows/Git Bash
### Contract changes
- completeFindingPick(finding: Finding, …): Finding → PickableFinding (Pick<Finding, 'origin' | 'choices'>) · why: rewritten on findingEntries, which needs only origin and choices · consumers: 02's main/round.ts (unchanged call) · group 04
- form-state.ts: new export pickNumber(round: RoundState, item: AnswerableItem): number — a question's choice or a finding's entry number · why: one source for the log line, ReviewRow.entry and the kit's selected state · consumers: 05, 07 · group 04
### Rulings
- a layout first listed by a change report starts at revision 1; each later report adds 1, removal included — matches the plan's never-reset rule — a page could reload once more than needed · group 01 · group 01
- showLayouts falls back to the set's builtIn entry and throws if the set has none — only reachable if the registry breaks its contract — a broken registry stops the page drawing · group 01 · group 01
- ROUND_ITEM_LISTS per-kind record added in main/round.ts so requireKnownLayouts walks each kind — matches the per-kind record pattern — none · group 02 · group 02
- an explicit recommend: null counts as present, not absent — the wire rule says leave it out — a null-sending agent gets a type error rather than the absent path · group 02 · group 02
- form-state.ts's private ROUND_ITEMS exported for the resolver rather than copied — widen-don't-copy — one file outside 03's Files list · group 03 · group 03
- showLayouts' queues-nothing check also compares the listed setting name, so a setting that moves from a listed layout to a missing one while a round still uses the old one still reloads — the plan's check missed that case — none · group 03 · group 03
- README Layouts sub-part placed before Outcomes — nearest the ask_round contract — none · group 06 · group 06
### Review rounds
### Test gate
