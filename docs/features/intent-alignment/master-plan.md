# Intent alignment: master plan

**Contents**

- **Intent** — what this checklist is for and how to work it.
- **Order** — the waves and side lanes at a glance.
- **Wave 0: quick wins** — small items to start any time.
- **Wave 1: foundation sweeps** — disposables and typed dependency keys.
- **Wave 2: commands, state, events** — the command API, the state registry, events.
- **Wave 3: consumers** — work built on commands and state, and the AGENTS.md rule.
- **Wave 4: plugin hot reload** — the two decisions, PluginHost reload, the loader.
- **Lane H: harness seams** — harness knowledge behind the adapter.
- **Lane P: platform** — platform knowledge behind adapters.
- **Lane L: layouts everywhere** — the surfaces that do not draw through a layout yet.
- **Lane E: extension points** — closed lists that become registrations.
- **Left out** — adapter-shaped items that are features, not alignment.

## Intent

This checklist orders every follow-up that brings the app in line with the AGENTS.md Intent: everything is a
plugin, a command, an event or a layout; everything hot reloads; harness and platform knowledge sits behind
adapters. Each line names an item in `docs/features/followups.md` exactly; that item holds the detail. Work one
item per feature session.

- **[plan]**: the item needs a `wigley:feature` session first, then `wigley:make`.
- **[ready]**: an implementer can take the item as it stands.
- **∥**: the items can run in parallel sessions; they edit different files. Numbered steps run in order.

When an item lands, tick its box here and remove it from `followups.md`, in the same commit.

## Order

```
 W1  Disposables ─► Typed dep keys ─► Derived layer rules
        │              └─ ∥ Disposable tool contributions · Plugin-scoped logs
        ▼
 W2  Runtime command API  ∥  State registry (plan) ─► Events for every state change
        │                        │
 W3  Every click (plan) · Workflow actions · Sessions queries · Page state survives reload
        ▼
     AGENTS.md standing rule
 W4  Bridge + core-services decisions ─► PluginHost stop/reload (plan) ─► Runtime plugin loader (plan)

 Side lanes, beside the waves:
   H  Harness    registry → grows → settings→docs roots ∥ chat pass ∥ permission ∥ … → Codex adapter
   P  Platform   all ∥
   L  Layouts    all ∥, except the two that edit the forms and primer views
   E  Extension  md blocks ∥ defineEx ∥ remaps ∥ setting kinds→layout picker · forms kinds chain
```

The critical path is Wave 1 → the state registry → PluginHost reload → the runtime loader.

## Wave 0: quick wins

Start any time; all ∥.

- [ ] Platform record [ready]
- [ ] Forms takes the timers service [ready]
- [ ] Window plugin [ready]
- [ ] Menu labels by label [ready]

## Wave 1: foundation sweeps

Run in order: each step touches every plugin.

1. [ ] Disposable registrations, disposed per plugin [ready]
2. [ ] Typed dependency keys [ready] (includes per-process `dependsOn`)
   - ∥ [ ] Disposable tool contributions reach live sessions [ready] (sessions and forms main only)
   - ∥ [ ] Plugin-scoped logs [ready]
3. [ ] Derived layer rules [ready]: it reads the per-process `dependsOn` from step 2.

Gate: every registration returns a handle, and every dependency is typed.

## Wave 2: commands, state, events

1. All ∥:
   - [ ] Runtime command API [ready]. Give commands a target (row, index, href) here; Wave 3 needs it.
   - [ ] Plugin state registry [plan]. Reuse the typed-key pattern from Wave 1. The plan settles: which state
     changes are slots and which are events, deltas or whole values for chat entries, and how a reloaded owner
     re-attaches to its slot.
   - [ ] keysFor and box focus in the core keys API [ready]
   - [ ] Core picker and folder services [ready]
2. [ ] Events for every state change [ready]. Start it after the registry lands, so backlog, workflow, agents and
   usage are converted once. Its AGENTS.md rule step moves to the Wave 3 checkpoint.

## Wave 3: consumers

All ∥:

- [ ] Every click runs a command [plan]
- [ ] Workflow stage actions as commands [ready]
- [ ] Sessions queries and row decorations [plan], then [ ] Sessions stops knowing forms [ready]: the same files,
  so run them in sequence or in one plan.
- [ ] Page state survives a page reload [plan]: reuse the registry's core-held slot.

Checkpoint, after the items above:

- [ ] Add the standing rule to the AGENTS.md Intent: every user action runs as a command, and every state change a
  plugin owns is published as an event or slot typed in its `contract.ts`.

## Wave 4: plugin hot reload

1. Decide both before plugins load from a user folder (∥):
   - [ ] Layout access to the raw bridge [plan]
   - [ ] Replaceable core services decision [plan]
2. [ ] PluginHost stop and reload, with a live enable switch [plan]
3. [ ] Runtime plugin loader [plan]

## Lane H: harness seams

Start after Wave 1 step 2: both edit the same dependency call sites.

1. [ ] AgentHarnessRegistry [ready]
2. [ ] AgentHarness grows what a second harness needs [ready]
3. Then ∥:
   - [ ] Harness settings with the harness, then [ ] Docs reads harness config roots from the adapter
   - Chat pass, in sequence (all edit chat): [ ] Chat picks a harness → [ ] Control roles → [ ] Clear aliases from
     the adapter → [ ] Harness-neutral UI copy → [ ] Open chat entry kinds and entry renderers
   - [ ] Permission behind the harness
   - [ ] Sessions stops naming Claude
   - [ ] Structured round results
   - [ ] Owned sessions join by an adapter key [plan]
4. [ ] Codex harness adapter [plan]: the proof; a second harness shows what the seams missed.

## Lane P: platform

All ∥, any time:

- [ ] Per-platform program lookup and spawning [ready]
- [ ] Round store through Files [ready]
- [ ] Per-source alert descriptions [ready]
- [ ] Per-platform chord matching [ready]

## Lane L: layouts everywhere

All ∥, any time. Keep this lane apart from Forms item kinds (Lane E) and Every click runs a command (Wave 3): they
rewrite the same forms files.

- [ ] Toasts through the shell layout, with Shell layout swap failure tests (the same contract)
- [ ] Dialog frames and confirms through the opener's layout, then [ ] Forms and primer column chrome through their
  layouts: both edit the forms and primer views. Each drops its carve-out from AGENTS.md or
  `docs/features/layouts/design.md`.
- [ ] Fixed texts in layout slots
- [ ] Sessions split picker rows through the sessions layout
- [ ] Layout hot reload keeps the user's place

## Lane E: extension points

Start after Wave 1 step 1.

- ∥:
  - [ ] Markdown block contributions
  - [ ] EditorHost.defineEx
  - [ ] Plugin editor remaps
  - [ ] Setting control kinds as registrations, then [ ] Layout name picker in Settings mode
- Forms chain, in order; after Disposable tool contributions, and apart from Lane L's forms items and Every click:
  1. [ ] Forms item kinds as registrations
  2. [ ] Finding origin specs and open layout unions
  3. [ ] Split form-state.ts and rename the FormsView union
- [ ] Command palette and fuzzy finders [plan], last: it needs the runtime command API, the core picker and the
  fuzzy matcher from the slash-completion plan.

## Left out

Adapter-shaped, but features rather than alignment: Agent settings through an adapter, Agent plugin management and
sync, Native window vibrancy, Packaging and installers, and the wigley-harness adapter (after Codex).
