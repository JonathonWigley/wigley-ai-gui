# 03 — Wire the wake into forms and the primer

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/manifest.ts` · modify `src/plugins/primer/manifest.ts` ·
           modify `src/plugins/forms/main/start.ts` · modify `src/plugins/primer/main/start.ts` ·
           test `src/shared/plugin-manifests.test.ts` only if a case there pins the built-in start order or dependency lists
Consumes:  `createChatFormWake`, `NO_FORM_WAKE`, `AgentFormServiceDeps.wake` ← 01; `ChatMainExports` (tree, `src/plugins/chat/contract.ts`)
Produces:  forms' and primer's `dependsOn` read `['sessions', 'chat', 'keys']`; each main part's live service built with
           `wake: createChatFormWake(chat, services.log, '<forms|primer>')`

Decisions:
- `const chat = api.dependency<ChatMainExports>('chat');` in each `start`, beside the `sessions` lookup. Forms passes
  it into `createForms`.
- The live service (the one `sessions.contributeTools` serves) gets the chat wake, with log source `'forms'` or
  `'primer'`. The preview service (the memory-store one behind `presenter.quiet`) gets `NO_FORM_WAKE`.
- Update each part's summary comment (`// Serves its two tools …`, `// Serves open_primer and collect_last_primer …`)
  to say that a form finished with no call waiting wakes its chat session.
- **The start order changes.** `dependencyOrder` (`src/shared/plugin-manifests.ts`) starts the first listed part whose
  dependencies have started. Today the order is keys, sessions, forms, primer, chat, …; after this task it is keys,
  sessions, chat, forms, primer, …. That moves:
  - the self-test script order: chat's script now runs before forms', and forms' script hosts the keys and gallery
    steps and the start-width rule (AGENTS.md, Running and testing)
  - the default key-layer order (`defaultKeyLayers`): forms' and primer's layers now merge after chat's
  Compare both for a bind chat shares with forms or primer in one scope. Scopes are plugin-qualified, so none is
  expected. Update any AGENTS.md line that states the old start order. If a self-test step or a bind breaks, report
  it back as a ruling; do not reorder scripts or move binds on your own.

GIVEN the app's plugins load WHEN forms and the primer start THEN each resolves `chat` and starts with no error — pinned by the self-test run in Done when, since no unit test starts the real main parts
Tests:     no new unit test: the start is pinned by the self-test, and the wake's delivery by 05.
Done when: `npm run typecheck` passes; the test gate runs `plugin-manifests.test.ts`; `npm run selftest -- --plugin chat --plugin forms --plugin primer` passes.
Commit:    one commit for the group

## Proof

