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
- [ ] [Session popup surface](01-session-popup-surface.md)
- [ ] [Docs tab plugin](02-docs-session-tab-plugin.md)

### Wave 2
- [ ] [Forms and primer in popups](03-forms-primer-popups.md) — after 01

### Wave 3
- [ ] [Self-test scripts](04-selftest-scripts.md) — after 01, 02, 03

### Wave 4
- [ ] [Final verification](06-final-verification.md) — after 04

### Wave 5
- [ ] [Doc re-read](05-doc-re-read.md) — after 04, 06 (both repos: the marketplace's two "Primer tab" lines too)

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
