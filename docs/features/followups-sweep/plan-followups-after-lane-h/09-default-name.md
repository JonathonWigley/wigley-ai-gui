# 09 — One DEFAULT_NAME

Status: not started
Type: Task
Rung: standard · one exported constant replacing nine private copies, after the exported constants `src/contracts/core-state.ts` already holds; behaviour unchanged
Wave: 4 · Depends on: 08
Plan: [plan.md](plan.md)

Fixes follow-up L559 (`docs/features/followups.md`, main at 9b671bd16), **One `DEFAULT_NAME` for the layout host**:
`const DEFAULT_NAME = 'default'` has nine private copies. Export one from `src/contracts/layouts.ts` and import it at
every site.

Files:
- modify `src/contracts/layouts.ts`
- modify `src/shared/layout-url.ts`
- modify `src/shared/layouts/layout-registry.ts`
- modify `src/main/layouts/layout-service.ts`
- modify `src/plugins/forms/page/layout/layout-resolver.ts`
- modify `src/shared/page/layout-host/draw-part.ts`
- modify `src/shared/page/layout-host/layout-parts.ts`
- modify `src/shared/page/layout-host/pick.ts`
- modify `src/shared/page/layout-host/layout-loader.ts`
- modify `src/shared/page/layout-host/show-layouts.ts`

Preconditions (run from the `wigley-ai-gui/` folder of the merged `main`):

| Claim | Command | Expected |
|---|---|---|
| Nine private copies | `grep -rln "^const DEFAULT_NAME = 'default';" src` | the nine files above besides `contracts/layouts.ts` |
| The contract module holds no constant yet, and contracts may export runtime constants | `grep -c 'export const' src/contracts/layouts.ts src/contracts/core-state.ts` | `layouts.ts:0`, `core-state.ts` above 0 |
| Every site may import `src/contracts` | `grep -n "'src/contracts'" scripts/layer-rules.mts \| head -3` | `src/contracts` in the rules every layer shares |

Consumes: nothing. Follows 08 in `draw-part.ts` (same file).

Produces: `export const DEFAULT_LAYOUT_NAME = 'default';` in `src/contracts/layouts.ts`.

Decisions:
- **The name** is `DEFAULT_LAYOUT_NAME`, not the copies' `DEFAULT_NAME`: in the contracts module, imported into files
  that also name default settings and default layouts' objects, the bare name says less than the job it does.
- **Its comment**: "The name of an owner's built-in layout, drawn when no other is picked or loaded, and served from the
  owner's default folder." Each copy's own comment that explains its local use (`layout-url.ts`: "The name served from
  the owner's default folder rather than `layoutsRoot`") moves to the use site or goes when the export's comment says it.
- Each site imports it (`import { DEFAULT_LAYOUT_NAME } from '…/contracts/layouts'`, merged into an existing
  `import type` from that module as a value import where one exists) and drops its own `const`. Every use keeps its
  meaning; no error or log text changes (`layout default has no …`, `layout default is not loaded`,
  `layout <name> not found, drawing default`).
- **Left out**: the bare `'default'` literals that name a layout in a view's first `ShownLayouts`
  (`primer-view.ts`, `forms-view.ts`, `docs/page/start.ts`, `audio-picker/page/picker-view.ts`), chat's
  `DEFAULT_ENTRY_PICK` (`chat-layouts.ts`), the shell's `chromeLayout` (`shell.ts`) and the manifests' `layout:
  'default'` settings. The follow-up names the nine `const` copies; the literals are a separate sweep (task 10 holds
  `primer-view.ts`, `docs/page/start.ts` and `shell.ts` in this wave, and Lane L rewrites forms' views).

GIVEN the change WHEN the suite runs THEN every layout-host, layout-registry, layout-service, layout-url and forms
layout-resolver test passes unchanged: the constant's value and every message are the same.

Tests: none added; a rename of a private constant to a shared one changes no behaviour, and the existing suites of the
ten files cover each use (`layout-url.test.ts`, `layout-registry.test.ts`, `layout-service.test.ts`,
`layout-resolver.test.ts`, `draw-part.test.ts`, `layout-parts.test.ts`, `pick.test.ts`,
`layout-loader.test.ts`, `show-layouts.test.ts`).

Done when: compiles (`npm run typecheck`); `npm run lint` passes (the layer check); `npm test` runs those suites
green; `grep -rn "const DEFAULT_NAME" src` prints nothing.

Commit: one commit, "Layout host: one exported DEFAULT_LAYOUT_NAME in contracts/layouts.ts in place of nine private
copies (follow-up L559)".

## Proof

