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

Plans: Waves 0, 2 and 3 have landed and their plan folders are gone. The settled design is
`plugin-framework/design.md` § Commands and state. Wave 4 steps 1 and 2 have landed and their plan folder is gone; the
design is `plugin-framework/design.md` § Hot reload (Wave 4). Wave 1's plan folder is gone too. Step 3, the runtime
loader, has landed and its plan folder is gone; its design is `plugin-framework/design.md` § Runtime loader
(Wave 4 step 3).

Side lanes: each lane is one plan, planned in its own `wigley:feature` session, in
`intent-alignment/plan-lane-h-harness-seams/`, `plan-lane-p-platform/`, `plan-lane-l-layouts/` and
`plan-lane-e-extension-points/`. The lanes run in parallel sessions except where they share files, in this order:

- Forms files (`src/plugins/forms/`, `src/shared/agent-forms/`): Lane H's Structured round results, then Lane E's
  forms chain, then Lane L's forms items (dialog confirms, forms and primer column chrome, layout hot reload's
  forms redraw).
- Claude adapter and `src/main/main.ts`: Lane H's AgentHarnessRegistry, Permission behind the harness and Harness
  settings with the harness, then Lane P's Per-platform program lookup and spawning.
- Every other item may run beside the other lanes.

## Order

```
 W1  Disposables ─► Typed dep keys ─► Derived layer rules
        │              └─ ∥ Disposable tool contributions · Plugin-scoped logs
        ▼
 W2  State registry ─► Runtime command API ∥ keysFor ∥ picker ─► Events for every state change
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

- [x] Platform record [ready]
- [x] Forms takes the timers service [ready]
- [x] Window plugin [ready]
- [x] Menu labels by label [ready]

## Wave 1: foundation sweeps

Run in order: each step touches every plugin.

1. [x] Disposable registrations, disposed per plugin [ready]
2. [x] Typed dependency keys [ready] (includes per-process `dependsOn`)
   - ∥ [x] Disposable tool contributions reach live sessions [ready] (sessions and forms main only)
   - ∥ [x] Plugin-scoped logs [ready]
3. [x] Derived layer rules [ready]: it reads the per-process `dependsOn` from step 2.

Gate: every registration returns a handle, and every dependency is typed.

## Wave 2: commands, state, events

1. [x] Plugin state registry [plan]. It lands first: the runtime command catalog is a core slot.
2. All ∥:
   - [x] Runtime command API [plan]. It gives commands an argument (row, index, href); Wave 3 needs it.
   - [x] keysFor and box focus in the core keys API [plan]
   - [x] Core picker and folder services [plan]
3. [x] Events for every state change [plan], after the registry, so backlog, workflow, agents and usage are converted
   once. Its AGENTS.md rule step moves to the Wave 3 checkpoint.

## Wave 3: consumers

All landed (∥):

- [x] Every click runs a command [plan]
- [x] Workflow stage actions as commands [ready]
- [x] Sessions queries and row decorations [plan], then [x] Sessions stops knowing forms [ready]: the same files,
  so run them in sequence or in one plan.
- [x] Page state survives a page reload [plan]: reuse the registry's core-held slot.

Checkpoint, after the items above:

- [x] Add the standing rule to the AGENTS.md Intent: every user action runs as a command, and every state change a
  plugin owns is published as an event or slot typed in its `contract.ts`.

## Wave 4: plugin hot reload

1. Decide both before plugins load from a user folder (∥):
   - [x] Layout access to the raw bridge [plan]
   - [x] Replaceable core services decision [plan]
2. [x] PluginHost stop and reload, with a live enable switch [plan]
3. [x] Runtime plugin loader [plan]

## Lane H: harness seams

Start after Wave 1 step 2: both edit the same dependency call sites. The chat pass edits chat files that Wave 2's
conversion of chat to slots and its chat events also edited; that conversion has landed.

1. [x] AgentHarnessRegistry [ready]
2. [x] AgentHarness grows what a second harness needs [ready]
3. Then ∥:
   - [x] Harness settings with the harness, then [ ] Docs reads harness config roots from the adapter
   - Chat pass, in sequence (all edit chat): [ ] Chat picks a harness → [ ] Control roles → [ ] Clear aliases from
     the adapter → [ ] Harness-neutral UI copy → [ ] Open chat entry kinds and entry renderers
   - [ ] Permission behind the harness
   - [x] Sessions stops naming Claude
   - [x] Structured round results
   - [ ] Owned sessions join by an adapter key [plan]
4. [ ] Codex harness adapter [plan]: the proof; a second harness shows what the seams missed. It is planned in its
   own session once the steps above land, outside the lane's plan.

## Lane P: platform

All ∥, any time, except Per-platform chord matching and Per-platform program lookup, which wait for the Platform
record (Wave 0) because they read it:

- [ ] Per-platform program lookup and spawning [ready]
- [ ] Round store through Files [ready]
- [ ] Per-source alert descriptions [ready]
- [ ] Per-platform chord matching [ready]

## Lane L: layouts everywhere

All ∥, any time. Its forms items run after Lane E's forms chain (§ Intent, Side lanes): they rewrite the same
forms files. A layout
item draws a button through `kit.button`, which runs a command, and no closure button.

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
- Forms chain, in order; after Lane H's Structured round results and before Lane L's forms items:
  1. [ ] Forms item kinds as registrations
  2. [ ] Finding origin specs and open layout unions, with [ ] A finding's proof becomes optional off a Nit (the
     same origins table; its marketplace and `~/wigley-agents/forms.md` text lands in the same run)
  3. [ ] Split form-state.ts and rename the FormsView union
- [ ] Command palette and fuzzy finders [plan], last and outside the lane's plan: it builds on the runtime command
  API, the core picker and the `FuzzyMatcher` service, all landed.

## Left out

Adapter-shaped, but features rather than alignment: Agent settings through an adapter, Agent plugin management and
sync, Native window vibrancy, Packaging and installers, and the wigley-harness adapter (after Codex).
