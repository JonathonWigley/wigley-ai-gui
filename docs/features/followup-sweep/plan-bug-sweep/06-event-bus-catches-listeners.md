# 06 — A plugin's throwing event listener is logged, and the rest still run

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/event-bus.ts` · modify `src/main/plugins/main-api.ts` ·
           modify `src/renderer/plugins/page-api.ts` · modify `src/contracts/plugin.ts` (the `PluginEvents` comment only) ·
           test `src/shared/event-bus.test.ts`
Consumes:  `Log` in `src/contracts/log.ts`, `errorText` in `src/shared/error-text.ts` (both in the tree)
Produces:  `export function pluginEvents<Ev extends EventShape = UntypedEvents, Heard extends EventShape = UntypedEvents>(bus: EventBus, pluginId: string, log: Log): PluginEvents<Ev, Heard>` in `src/shared/event-bus.ts`
Decisions: the catch and the log live in `pluginEvents`, which knows the listening plugin; `createEventBus` stays bare
           (plan.md, Decided notices)

## Behaviour

- `pluginEvents(bus, pluginId, log).on(qualifiedEvent, listener)` registers on `bus` a wrapper that calls `listener`
  in a `try`; a throw is caught and logged as `log(pluginId, \`${qualifiedEvent} listener failed: ${errorText(error)}\`)`
  — `pluginId` is the listening plugin's id, not the emitter's. The wrapper never throws, so `emit` goes on to the
  listeners after it and returns normally. The catch-and-log shape matches `config-store.ts`'s `publish`.
- `createEventBus` is unchanged: on the bare bus a listener's throw still leaves `emit` and skips the listeners after
  it. Only the core holds a bare bus; every plugin listener goes through `pluginEvents`.
- `log` is required. Callers:
  - `src/main/plugins/main-api.ts` `createMainApi`: `pluginEvents(deps.bus, manifest.id, deps.services.log)`.
  - `src/renderer/plugins/page-api.ts` `createPageApi`: `pluginEvents(deps.bus, manifest.id, deps.services.log)`.
  `main-api.test.ts` and `page-api.test.ts` build `services` without `log`; the log is read only when a listener
  throws, so they need no change.

## Comments

- `event-bus.ts`, the `EventBus` comment keeps its bare-bus statement (a listener's throw leaves `emit` and skips the
  listeners after it) and the `pluginEvents` comment adds: each listener `on` adds is wrapped, so its throw is logged
  under the listening plugin's id as `<qualifiedEvent> listener failed: <error>` and the other listeners still run.
- `contracts/plugin.ts`, the `PluginEvents` comment: its closing `Listeners run before \`emit\` returns, and a
  listener's throw reaches the emitter.` becomes: listeners run before `emit` returns; a listener's throw is logged
  under the listening plugin's id and never reaches the emitter or the other listeners. Task 10 (wave 2) also edits
  this file; this task touches only that comment.

GIVEN two plugins listening to one event, the first throwing WHEN a third plugin emits it THEN `emit` returns, the
second listener hears the data, and the log holds one line under the first listener's plugin id
GIVEN the bare bus WHEN a listener throws THEN the throw still reaches `emit`'s caller

Tests (`event-bus.test.ts`, sentence names as the file uses):

- Every existing `pluginEvents(bus, '<id>')` call gains a third argument, a `log` that pushes `[source, message]` into
  an array the test owns (a small `logInto(lines)` helper beside `TestEvents` serves them all).
- New, in `describe('pluginEvents')`: `logs a listener's throw under the listening plugin and runs the rest` —
  `pluginEvents<EventShape, { 'sessions.connected': number }>(bus, 'forms', log).on('sessions.connected', () => { throw
  new Error('boom'); })`, then a second listener from `pluginEvents(..., 'docs', log)` that pushes the data; emitting
  `connected` with `1` through `pluginEvents(bus, 'sessions', log)` does not throw; heard equals `[1]`; lines equal
  `[['forms', 'sessions.connected listener failed: boom']]`.
- `lets a listener's throw reach the emitter` in `describe('createEventBus')` stays: it pins the bare bus, which this
  task leaves unchanged. The plugin-facing claim it was read as, that a throw reaches the emitter, is replaced by the
  new test above.

Done when: `npm run typecheck` (the file's `@ts-expect-error` lines included) and `npm run lint` pass; the test gate
           runs the tests above
Commit:    one commit for the group

## Proof

e223013 · diff read, pluginEvents signature as planned; typecheck clean in its files · concerns: worker ran npx prettier (cached, not a dependency) on its five files and restored them with oxfmt — hard-gate breach reported to the user

