# 04 — Modes: the core's one-at-a-time window layer

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/plugin.ts` (`Mode`, `ModeHandle`, `Modes`; `PageApi.modes`)
- create `src/renderer/shell/modes.ts` · test `src/renderer/shell/modes.test.ts`
- modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts`
- modify `src/renderer/renderer.ts`
- modify `src/renderer/shell/shell.css`

Consumes: members already in the tree — `Area.contribute` (`areas.main`), `qualify`, `Log`. Task 01 also edits
`plugin.ts` and `renderer.ts`; this task builds on its landed version.

Produces:
- in `src/contracts/plugin.ts` (one home; no new contracts file):
  ```ts
  // `shown` runs each time this mode becomes the shown one, the first mode's at its `add` included; the mode's
  // plugin sets its base key scope there, so a hidden view never keeps the scope.
  export interface Mode { id: string; title: string; element: HTMLElement; shown(): void; }
  export interface ModeHandle { show(): void; isShown(): boolean; }
  export interface Modes {
    add(mode: Mode): ModeHandle;
    shown(): string;
    onChanged(listener: (modeId: string) => void): void;
  }
  ```
  and `PageApi` gains `modes: Modes`.
- `export function createModes(attach: (element: HTMLElement) => void, log: Log): Modes` in
  `src/renderer/shell/modes.ts`.
- `PageApiDeps` (`page-api.ts`) gains `modes: Modes`.

Decisions:
- A mode fills the window above the status bar: its element lives in the shell's main area, and the side bar,
  activity bar and panel areas stay empty while no plugin contributes to them (none does). (plan.md File Structure:
  "the mode layer inside the main area"; design.md § Modes and layout.)
- `createModes` semantics, each pinned:
  - `add` calls `attach(mode.element)` once; the first mode added shows (`hidden = false`), every later one is
    added hidden. A second `add` with an id already added throws `Mode "<id>" is added twice`.
  - `handle.show()` on a hidden mode hides the shown one, shows this one, logs `('page', \`showed ${title} mode\`)`,
    calls the mode's own `shown()`, then each `onChanged` listener with the new id; on the shown mode it does
    nothing (no `shown()`, no listener).
  - The first `add` logs `showed <title> mode` too, calls that mode's `shown()` before `add` returns, and calls no
    listener (nothing changed from a shown mode). So a mode's `shown()` must not read the handle `add` is about to
    return; a plugin that needs "is my mode shown" keeps its own boolean, set in `shown()` and cleared in an
    `onChanged` listener hearing another id.
  - `shown()` is the seam that keeps a hidden view from holding the key scope (lead's ruling): the mode's plugin
    sets its base scope there. Plan B's Docs mode uses the same signal.
  - `shown()` is the shown mode's id; before any `add` it throws `No mode is added yet`.
  - Hiding sets `element.hidden = true` and nothing else: a hidden mode's DOM, focus-free state and editors stay.
  - Which command shows a mode, and what pressing it again does (Sessions toggles its sidebar), belong to the mode's
    plugin, never the registry. (plan.md File Structure.)
- Ids: the core registry takes qualified ids. `createPageApi` qualifies: `modes.add(mode)` passes
  `{ ...mode, id: qualify(manifest.id, mode.id) }` on to `deps.modes.add`; `shown` and `onChanged` pass through, so a
  plugin reads qualified ids (`sessions.sessions`), as `keys.scope()` reads qualified scopes. The contract comment
  on `PageApi.modes` says so.
- `renderer.ts` builds `const modes = createModes((element) => areas.main.contribute(element), log)` right after
  `mountShell` and hands it to every `createPageApi` call.
- CSS (`shell.css`): a rule `.shell-main > *` with `height: 100%` and `min-height: 0`, so a mode's root fills the
  main area; the `[hidden]` rule in `index.css` already beats a mode root's own `display`.
- Plan A registers one mode (Sessions, task 05), so a hidden mode first appears in plan B; this task's tests carry the
  hide/show proof.

GIVEN modes A then B added WHEN B's handle shows THEN A's element is hidden, B's shows, `shown()` is B's id and each
listener hears B's id once.

Tests (`src/renderer/shell/modes.test.ts`; the test environment is `node`, so each mode's element is a plain object
`{ hidden: false } as HTMLElement`, `attach` records what it is handed, and each mode's `shown` pushes `shown <id>`
onto one `calls` list that the `onChanged` listener also pushes `changed <id>` onto):
- `shows the first mode added and hides later ones` — add `a.one`, `b.two` → `one.hidden === false`,
  `two.hidden === true`, `shown() === 'a.one'`, `attach` received both in order, log
  `['[page] showed One mode']`, calls `['shown a.one']`.
- `shows a mode and hides the shown one, telling the mode, then listeners` — then `two.show()` →
  `one.hidden === true`, `two.hidden === false`, `shown() === 'b.two'`, calls
  `['shown a.one', 'shown b.two', 'changed b.two']`, log ends `[page] showed Two mode`, `two.isShown() === true`,
  `one.isShown() === false`.
- `does nothing when the shown mode shows again` — `one.show()` with `a.one` shown → calls and log unchanged.
- `rejects a mode id added twice` — add `a.one` twice → throws `Mode "a.one" is added twice`.
- `has no shown mode before the first is added` — `shown()` throws `No mode is added yet`.

`src/renderer/plugins/page-api.test.ts`:
- `qualifies a mode's id by the plugin` — fake `modes` recording `add` calls; plugin `p` adds
  `{ id: 'browse', title: 'Browse', element, shown }` → the fake received id `p.browse` and the same title, element
  and `shown`.

The mode layer's look (the mode filling the window above the status bar) is a live check in task 08.

Done when: `npm run typecheck`, `npm test`, `npm run lint` pass; `grep -n "modes: Modes" src/contracts/plugin.ts`
finds `PageApi`'s field.
Commit: one commit for the group.

## Proof

