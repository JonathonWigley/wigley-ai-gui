import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
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
      label: () => null,
    }) as unknown as SessionsMainExports,
);

// Chat for a harness's parts: every instruction taken and disposable, and the
// one profile `personal`.
export const FAKE_CHAT = fakeDependency(
  chatMainKey,
  (consumer) =>
    ({
      addInstructions: () => consumer.track({ dispose: () => undefined }),
      activeTime: () => null,
      profiles: () => [{ name: 'personal', configDir: '~/.c' }],
    }) as unknown as ChatMainExports,
);

// The real engine main part over the fakes, and its exports as the dependency a
// workflow plugin's part under test takes.
export function startEngineMainPart(options: { drive?: boolean } = {}) {
  const engine = startMainPart(workflowMainPart, {
    drive: options.drive,
    dependencies: [FAKE_SESSIONS, FAKE_CHAT],
  });
  const dependency = fakeDependency(
    workflowMainKey,
    (consumer) => engine.started().exports?.(consumer) as WorkflowMainExports,
  );
  return { engine, dependency };
}
