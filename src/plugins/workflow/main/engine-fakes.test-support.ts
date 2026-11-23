import type { FeatureKey } from '../../../contracts/contributions';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import { harnessInfo } from '../../../shared/agent-harness-registry.test-support';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type ContributionsMainExports,
  contributionsMainKey,
  type Strategy,
} from '../../contributions/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import { type WorkflowMainExports, workflowMainKey } from '../contract';
import { workflowMainPart } from './start';

// Sessions for a harness's parts: every contribution taken and disposable.
export const FAKE_SESSIONS = fakeDependency(
  sessionsMainKey,
  (consumer) =>
    ({
      contributeTools: () => consumer.track({ dispose: () => undefined }),
      addHookHandler: () => consumer.track({ dispose: () => undefined }),
      label: () => null,
    }) as unknown as SessionsMainExports,
);

// Contributions for a harness's parts: read, with no strategy of any feature.
export const FAKE_CONTRIBUTIONS = fakeDependency(
  contributionsMainKey,
  (consumer) =>
    ({
      registerFeature: () => consumer.track({ dispose: () => undefined }),
      strategies: () => [],
      onChanged: () => consumer.track({ dispose: () => undefined }),
      ready: Promise.resolve(),
    }) satisfies ContributionsMainExports,
);

// Chat for a harness's parts: every instruction taken and disposable.
export const FAKE_CHAT = fakeDependency(
  chatMainKey,
  (consumer) =>
    ({
      addInstructions: () => consumer.track({ dispose: () => undefined }),
      activeTime: () => null,
    }) as unknown as ChatMainExports,
);

// The real engine main part over the fakes, with the one profile `personal`
// registered under harness `claude`, and its exports as the dependency a
// workflow plugin's part under test takes.
export function startEngineMainPart(options: { drive?: boolean } = {}) {
  const state = createSlotStore(() => undefined);
  state
    .publish(coreAgentHarnessesSlot)
    .set(
      'claude',
      harnessInfo({ profiles: [{ name: 'personal', configDir: '~/.c' }] }),
    );
  const engine = startMainPart(workflowMainPart, {
    drive: options.drive,
    state,
    dependencies: [FAKE_SESSIONS, FAKE_CHAT, FAKE_CONTRIBUTIONS],
  });
  const dependency = fakeDependency(
    workflowMainKey,
    (consumer) => engine.started().exports?.(consumer) as WorkflowMainExports,
  );
  return { engine, dependency };
}

// A contributions fake a test drives: `set` replaces a feature's strategies
// and tells its `onChanged` listeners; `resolveReady` and `rejectReady` settle
// `ready`, which stays pending until one runs; `registered` holds each key
// `registerFeature` took.
export function fakeContributions() {
  const strategies = new Map<FeatureKey, readonly Strategy<unknown>[]>();
  const listeners = new Map<
    FeatureKey,
    Set<(strategies: readonly Strategy<unknown>[]) => void>
  >();
  const registered: FeatureKey[] = [];
  let settle: { resolve(): void; reject(error: Error): void } | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const exports: ContributionsMainExports = {
    registerFeature(key) {
      registered.push(key);
      return { dispose: () => undefined };
    },
    strategies: <V>(key: FeatureKey) =>
      (strategies.get(key) ?? []) as readonly Strategy<V>[],
    onChanged(key, listener) {
      const held = listeners.get(key) ?? new Set();
      listeners.set(key, held);
      held.add(listener);
      return { dispose: () => held.delete(listener) };
    },
    ready,
  };
  return {
    exports,
    registered,
    set(key: FeatureKey, value: readonly Strategy<unknown>[]) {
      strategies.set(key, value);
      for (const listener of listeners.get(key) ?? []) {
        listener(value);
      }
    },
    resolveReady: () => settle?.resolve(),
    rejectReady: (error: Error) => settle?.reject(error),
  };
}
