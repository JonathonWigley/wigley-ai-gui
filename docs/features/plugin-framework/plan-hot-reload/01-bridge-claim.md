# 01 — Close the raw bridge

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/preload/bridge-claim.ts` · test `src/preload/bridge-claim.test.ts`
- modify `src/preload/preload.ts` · test `src/preload/preload.test.ts` (its top-level read of the exposed Bridge)
- modify `src/contracts/bridge.ts` (the comment above `interface Bridge` only)
- modify `src/declarations.d.ts`
- modify `src/main/window.ts`
- modify `src/renderer/renderer.ts` (the one read of `window.wigley`, in `start()`)

Consumes:
- `interface Bridge` in `src/contracts/bridge.ts` (the tree holds it).
- `src/renderer/renderer.ts` as Wave 3 leaves it ← Wave 3 (re-verify). Wave 3 tasks 01 and 04 edit this file, but not the line `const bridge = window.wigley;` at the top of `start()`. Find that line by text, not by line number.

Produces:
- `src/preload/bridge-claim.ts`: `export function bridgeClaim(bridge: Bridge): { claim(): Bridge }`
- `window.wigley` is `{ claim(): Bridge }`. `src/declarations.d.ts` types it as `wigley: { claim(): import('./contracts/bridge').Bridge };`.
- The thrown text `the bridge was already claimed`.

Decisions:
- The core claims the Bridge once at start. No global holds it after. Layouts and later folder plugins reach the app only through the kit and the plugin API (user, design.md § Hot reload).
- `bridgeClaim` holds the once-rule, so a Vitest test pins it without Electron. Its home is `src/preload/`: only the preload uses it, and `scripts/check-layers.mts` lets `src/preload` import `src/contracts` and `src/shared` (agent).
- The first `claim()` returns the Bridge. Every later `claim()` throws `new Error('the bridge was already claimed')`. After the first claim, the claim object sets its own reference to `null`, so it holds the Bridge no longer (agent).
- `preload.ts` exposes `bridgeClaim(bridge)` in place of `bridge`: `contextBridge.exposeInMainWorld('wigley', bridgeClaim(bridge))`. The name `wigley` stays.
- `renderer.ts`: `const bridge = window.wigley.claim();` replaces `const bridge = window.wigley;`, at the same place. It is the first statement of `start()`, so it runs before any layout loads. Nothing else in `src` reads `window.wigley`.
- `bridge.ts`: the comment `What the preload exposes to the renderer as \`window.wigley\`.` becomes `What the core claims once at start through \`window.wigley.claim()\`.`
- `window.ts`: `webPreferences` gains `contextIsolation: true` and `sandbox: true`, beside `preload` and `offscreen`. Electron 44 defaults both to `true` already, so no behaviour changes. The code states them so a changed default cannot open the page (agent, design.md).
- The preload test mock keeps working: it reads `electron.exposed.wigley` as `{ claim(): Bridge }` and calls `claim()` once, at module level, in place of the cast to `Bridge`.
- This task does not touch `AGENTS.md`. Task 11 updates its `src/preload/` line.

GIVEN the preload has exposed `window.wigley` WHEN the core calls `claim()` THEN it gets the Bridge
GIVEN the core has claimed the Bridge WHEN a layout calls `window.wigley.claim()` THEN it throws `the bridge was already claimed`

Tests:
- `bridgeClaim_SecondClaim_Throws` in `src/preload/bridge-claim.test.ts` — build a stand-in object cast to `Bridge`. The first `claim()` returns that same object (`toBe`). The second `claim()` throws `/^the bridge was already claimed$/`.
- `src/preload/preload.test.ts` runs with its read changed to `(electron.exposed.wigley as { claim(): Bridge }).claim()`. Every existing test there passes unchanged.

Done when:
- `npm run typecheck` and `npm run lint` pass (`lint` runs `scripts/check-layers.mts`).
- `grep -rn "window\.wigley" src --include='*.ts' --include='*.js'` prints the `claim()` line in `src/renderer/renderer.ts` and the comment on `Bridge` in `src/contracts/bridge.ts` alone (the type in `src/declarations.d.ts` reads `wigley:`, which the grep does not match).
- `grep -n "contextIsolation: true\|sandbox: true" src/main/window.ts` prints both lines.
- The test gate runs the two test files above.
- The live check (the app starts, and a layout cannot claim the Bridge) is checked in 13.

Commit: one commit for the group

## Proof

Commit 2c61751d · proof: diff read; worker typecheck 0, lint 0, bridge-claim + preload tests 10 pass; window.wigley grep prints the claim line and the bridge.ts comment alone · concerns: none
