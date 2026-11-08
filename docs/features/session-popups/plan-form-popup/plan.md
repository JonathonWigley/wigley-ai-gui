# Form popup — plan

Feature: Session popups · Implements: none · Ticket: none
Target: main (wigley-ai-gui) · Written: 2026-11-07

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Forms' rounds and the feature primer stop being session tabs: each shows in a popup that slides up over the
session's tabs, hides and shows with `<Leader>vf`, and leaves a hidden bar while hidden. The per-session Docs tab
moves out of `docs` into a new `docs-session-tab` plugin that `plugins.disabled` lists by default.

## Architecture

- **sessions** (page): a new surface, the session popup — `addPopup` export, popups in each session's frame, the
  hidden bar, the visible-surface rule in `checkVisible`, the close guard and row status, two new layout parts, the
  `sessions.togglePopup` command and key, one theme token.
- **shared page** (`src/shared/page/`): `session-form-tabs.ts` becomes `session-form-popups.ts`.
- **forms**, **primer** (page): build their per-session surface through the popup helper.
- **sessions** (page) again: the tab take-over leaves once forms and primer stop calling it.
- **docs** (page, contract, manifest) and the new **docs-session-tab** plugin; `src/config/settings.ts`,
  `src/plugins/manifests.ts`, `src/plugins/page.ts`.
- Self-test scripts of forms, chat and primer.
- **wigley-ai-marketplace**: two doc lines naming the Primer tab (task 05), landed in that repo's own worktree.

## Preconditions

- `takeOver()` on a tab handle has one production caller, `src/shared/page/session-form-tabs.ts`:
  `grep -rn "\.takeOver(" src --include='*.ts' | grep -v test` → one hit (measured at plan time, re-verify).
- `createSessionFormTabs` has two consumers: `grep -rln "createSessionFormTabs" src | grep -v test` →
  `forms/page/forms-view.ts`, `primer/page/primer-view.ts`, and the helper itself.
- `<Leader>vf` is unbound: `grep -n "<Leader>vf" src/plugins/keymap.ts` → no hit.
- The self-test starts every plugin, disabled ones included: `applySelfTestConfig` sets `plugins.disabled` to `[]`
  (`src/main/selftest-config.ts`), and `mainStartList` returns `[]` under the self-test.
- The user's `~/.config/wigley-ai-gui/settings.json` has no `plugins` key, so the default list applies with no edit.
- Default disabled list: `grep -n "disabled:" src/config/settings.ts` → `['agent-lines', 'usage-tab-line']`.

## Docs written ahead

Committed together on branch `form-popup` in 051e6b41:
`docs/features/session-popups/design.md` (the settled design — the source every task reads), and the sweep that
brought `AGENTS.md`, `DESIGN.md`, `docs/keymap.md` and the feature docs (`primer`, `agent-chat`, `chat-bar`,
`docs-browser`, `docs-wiki`, `ui-design`, `file-drop`, `usage`, `layouts`) in line with it.

## Mandatory Reads

- `AGENTS.md` (repo root) — § Architecture in full (plugins, registrations, slots, keys, layouts, the session tab,
  session part and session popup bullets), § Running and testing (self-test, drive)
- `DESIGN.md` — § Separation, § Motion, the Sessions and Forms view rules, the primitives list
- `docs/keymap.md` — § Leader groups, § Adding a bind
- `docs/features/session-popups/design.md` — whole
- `docs/features/layouts/design.md` — the sessions owner's parts
- `docs/features/chat-bar/design.md` § Optional plugins (task 02)

## Design Overview

```
                 sessions page part
  addTab ──▶ frame.tabs ──────────┐
  addPopup ─▶ frame.popups (stack)├─▶ checkVisible: focused session's top OPEN popup ? popup.shown()
                                  │                                                  : selected tab.shown()
  togglePopup (<Leader>vf) ───────┘   hidden popups ─▶ popupBar part (one entry each; click → open)

  forms / primer page ──▶ session-form-popups helper ──▶ addPopup on the session's first form (opens it),
                                                         open() on each later mount and from the close guard,
                                                         dispose when the session holds no form
  docs-session-tab page ──▶ docs.addView + sessions.addTab   (plugins.disabled by default)
```

Decisions (all from the interview, design doc § Decisions):

- The popup is a sessions surface beside tabs, not a chat part; forms and primer both move; every session uses it,
  terminal sessions included.
- A new round opens the popup over whatever tab shows; submit or cancel disposes it. No idle popup.
- `<Leader>vf` (`sessions.togglePopup`, scope `any`) hides or shows; a click on the hidden bar opens.
- An open popup in the focused pane holds the key scope; hidden or gone, the selected tab's `shown` runs.
- Look: L2 sheet, `radius-lg` top corners, no shadow, top at `sessions.popup-top` (`15%`), the strip above dimmed by
  the core `scrim`; slide over `duration-slow`, `ease-out` in, `ease-in` out.
- The Docs tab becomes `docs-session-tab`, disabled by default; the per-session index sources stay in docs main.

Out of scope: a popup for any other plugin; a per-pane (rather than per-session) popup; renaming docs' generic
`addView` session wording (`docs/features/followups.md` "Docs addView session wording" stays open).

## File Structure

Modified:
- `src/plugins/sessions/contract.ts` — `SessionPopupView`, `SessionPopupHandle`, `addPopup`; later `takeOver` removed
- `src/plugins/sessions/manifest.ts` — `togglePopup` command, `popup-top` theme token
- `src/plugins/sessions/page/session-tabs-view.ts`, `tabs.ts`, `start.ts`, `sessions-view.ts`, `consumer-view.ts`,
  `pane-sessions.ts` — popups in the frame, visible-surface rule, close guard, statuses, toggle, focus
- `src/plugins/sessions/layouts/layout.d.ts`, `layouts/default/layout.js`, `layouts/default/layout.css`,
  `page/layout/sessions-parts.ts`, `page/layout/read-sessions-layout.ts`, `page/sessions.css` — `popup`, `popupBar`
- `src/plugins/keymap.ts` — `<Leader>vf`
- `src/plugins/forms/page/forms-view.ts`, `start.ts`, `forms.css`; `src/plugins/primer/page/primer-view.ts`,
  `start.ts`, `primer.css`; `src/plugins/primer/main/tool-definitions.ts`, `primer/manifest.ts` (copy naming the tab)
- `src/plugins/docs/page/start.ts`, `docs/contract.ts`, `docs/manifest.ts`; `src/config/settings.ts`;
  `src/plugins/manifests.ts`, `src/plugins/page.ts`
- self-test scripts: `src/plugins/forms/main/selftest-script.ts`, `src/plugins/chat/main/selftest-script.ts`,
  `src/plugins/primer/main/selftest-script.ts`

New:
- `src/shared/page/session-form-popups.ts` (+ `.test.ts`) — replaces `session-form-tabs.ts` (+ test), deleted
- `src/plugins/docs-session-tab/manifest.ts`, `page/start.ts`, `page/start.test.ts` — the moved Docs tab, page part
  only, modelled on `usage-tab-line`

Boundary rules: the popup knows nothing of forms or chat; forms and primer reach sessions only through the
`sessions` page exports; `docs-session-tab` imports only `docs/contract.ts` and `sessions/contract.ts`
(`npm run lint` enforces both).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Session popup surface](01-session-popup-surface.md)
- [x] [Docs tab plugin](02-docs-session-tab-plugin.md)

### Wave 2
- [x] [Forms and primer in popups](03-forms-primer-popups.md) — after 01

### Wave 3
- [x] [Self-test scripts](04-selftest-scripts.md) — after 01, 02, 03

### Wave 4
- [x] [Final verification](06-final-verification.md) — after 04

### Wave 5
- [x] [Doc re-read](05-doc-re-read.md) — after 04, 06 (both repos: the marketplace's two "Primer tab" lines too)

## Run log

Review base: aed38a35

### Groups
- 02 · e79f0073 · diff read; tsc --noEmit and npm run lint clean after wave 1; worker's targeted tests green · concerns: none beyond rulings; docs' own test no longer covers addView teardown when an anchor dispose throws (moved to docs-session-tab)
- 01 · 23a30128 · diff read; tsc --noEmit and npm run lint clean; worker ran npm test green (10099) · concerns: command label capitalised as pinned while sibling sessions labels are lower-case; look (slide, scrim, bar spacing) unchecked on screen until 04/06; DESIGN.md and docs/keymap.md oxfmt padding fixed (pre-existing lint failure from the docs-ahead commit)
- 03 · 616576b6 · diff read; tsc --noEmit and npm run lint clean; worker ran npm test green (10093); takeOver grep only chat's takeOverSkipped · concerns: plan's 'scope after registration' premise did not hold (render's trailing confirm.setBaseScope covers it); enterFrame cancel has no direct sessions test; usage-tab-line manifest still names '(Chat, Form, Primer)' session kinds
- 04 · b91a040e · diff read; worker ran selftest --plugin forms, chat, docs, sessions PASS and forms,primer PASS; typecheck and lint clean; screenshots read · concerns: chat's floating composer draws over the open popup (z-order; fix dispatched); primer alone fails on a pre-existing cross-script wait; screenshot corners/scrim not measurable (06 queries them)
- 06 · 09ac737d · drive run fp1: checks 1,3,4,5,6,7,9 pass; 2 failed (bar click logged nothing) and is fixed in 09ac737d, unit row + live click log; 8 failed only in a session whose default round was already submitted (form-service replaysLastSubmitted, already in aed38a35); fresh session passes · concerns: SIDE_BAR_OVER_QUERY is 679px in src/renderer/shell/modes.ts, not 640 (fit at 640 clean); Alt+; is written <A-;>
- 05 · 8647d68b (marketplace 0e0fc50) · task grep shows only true or unrelated hits; npm run lint clean; marketplace check_manifests and check_pointers pass · concerns: none
### Contract changes
- SessionPopupView.beforeClose: boolean → boolean | Promise<boolean> · why: forms' guardSessionClose answers through a promise while its cancel prompt asks · consumers: 03 · group 03
- FormPopupHandle: setStatus, open, isVisible, dispose (no hide) · why: the helper calls only these · consumers: none outside 03 · group 03
### Rulings
- defaults row in settings.test.ts rather than manifests.test.ts — settings test owns defaultSettingsFor — the row moves if wrong · group 02
- docs' internal addView returns the DocsViewHandle directly — sourceReplaced on the handle left {handle, view} with no reader — none · group 02
- docs-session-tab test fakes not filed with consumer.track — so a skipped dispose is caught — fakes less like the real exports · group 02
- tabs view gains popupsOf, openPopupOf and togglePopup(sessionId) returning {popup,isOpen}|null; start.ts only shows the mode and logs — the toggle needs open/hidden state — one method moves if wrong · group 01
- a session's popups are one list ordered by last open/hide; statusesOf follows it, so the row shows the most recently acted popup's status — plan named no order among popups — row shows another popup's status when two have one · group 01
- hide() on a covered open popup hides it into the bar; open() on a covered popup lifts it to the top; only open() on the top popup is a no-op — plan pinned only the top case — none seen · group 01
- blur on any popup becoming top open, in any pane, before changed — so the popup's shown can take focus after — none seen · group 01
- enter frame uses global requestAnimationFrame; tests stub it — as docs/start.ts does — future tests must stub it · group 01
- dim strip is an app-owned div.session-popup-scrim under the popup; layer/scrim CSS in sessions.css, popup look and slide in default layout.css — a user layout without the transition still gets inert and clipping · group 01
- default popup part draws a frame only (aria-label title, body); title/icon only in bar entries — not asked for · group 01
- SessionPopupView.beforeClose widened to boolean | Promise<boolean>, as SessionTabView's — forms' close guard answers through a promise while its cancel prompt asks, and mayClose already awaits — none (type-only) · lead, on 03's BLOCKED
- no extra setBaseScope/setScopeFor after a view registers — the render's trailing confirm.setBaseScope runs after registration; single-session view tests prove it — one render with a null target if wrong · group 03
- 01's addPopup now stores and cancels its enter animation frame on remove/drop — a disposed popup's frame stayed live and failed forms/primer stop tests — revert re-reds those cases · group 03
- forms-view formClosed row expecting idle scope replaced by 'forms sets no further scope or target' — no idle surface remains; the tab under sets its own scope — forms would need an idle scope otherwise · group 03
- PrimerTab/mountPrimerTab renamed PrimerPopups/mountPrimerPopups — no name calls the surface a tab; PrimerView taken — none · group 03
- chat-scope key while hidden is G (following the latest entry) — the next group sets following itself — none · group 04
- primer proved by --plugin forms,primer rather than primer alone — its 'review and cancel' alsoExpect on 'activated Layout preview' (eb6f544b8, before this plan) needs forms' Layout preview session — goes to follow-ups · group 04
- Lead fix 2dfe42b0 (after 04): chat's floating composer drew over the popup layer; .session-body sets isolation: isolate so tab z-indexes stay under the popup layer and pane edges.
- Drive fix 09ac737d: hidden-bar click logs 'opened <title> popup in <label>' via popupOpenedFromBar, as the toggle does · group 06
- Pre-existing, to follow-ups: re-opening an already-submitted default round in a session replays its answers and shows nothing, silently (form-service replaysLastSubmitted); forms.openRound with no sessionId connects a row without selecting it (sessions.mark); drive skill could say to pass a different round for a second open in one session · group 06
### Review rounds
- Round 1, aed38a35..3346ecbd, 5 lanes: NEEDS FIXES. 3 Important (press focus outside pane under popup; first-open slide/inert via rAF; other plans built on removed interfaces), 7 Minor. Recommended picks taken per AGENTS § Review; all dispatched in 3 workers by file. Report /tmp/claude-form-popup/review-3346ecbd.md
- Round 1 fixes: 08740a92 (docs), bb40db59 (sessions), 0102fa19 (forms, primer, docs). Re-review cycle 1 (correctness) over those: PASS with 3 Minor (comment widths, stale inset comment, untested let-go wiring), fixed in 6a2b5100.
- Re-review cycle 2 (correctness) over 6a2b5100: NEEDS FIXES, 2 Minor. Orphaned harness comment lead-applied in bd7f195c; harness test name and missing rule rows dispatched as fix now (recommended pick, last cycle, no further re-review).
### Test gate
- Picked per writing-tests § Picking tests for a gate over aed38a35..HEAD (sessions, forms, primer, chat, docs, docs-session-tab, settings, shared/page): npm test 10094 passed, no type errors; npm run selftest -- --plugin sessions,forms,primer,chat,docs all passed (docs-session-tab has no self-test script; its unit tests ran in npm test).
