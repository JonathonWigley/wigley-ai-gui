import { vi } from 'vitest';
import { fakeDependency } from '../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from './chat/contract';
import {
  type ConnectedSession,
  type SessionInfo,
  type SessionsMainExports,
  sessionsMainKey,
} from './sessions/contract';

export const fakeChat = fakeDependency(
  chatMainKey,
  () => ({ profileOf: () => null }) as unknown as ChatMainExports,
);

// Sessions faked so a test sees the `end` of the connection the preview holds.
export function previewSessions() {
  const end = vi.fn();
  const dependency = fakeDependency(
    sessionsMainKey,
    (consumer) =>
      ({
        contributeTools: () => consumer.track({ dispose() {} }),
        addCloseGuard: () => consumer.track({ dispose() {} }),
        activate() {},
        connect: (info: SessionInfo): ConnectedSession => ({
          session: { id: 'preview-row', info },
          call: () => Promise.reject(new Error('the preview calls no tool')),
          end,
        }),
      }) as unknown as SessionsMainExports,
  );
  return { end, dependency };
}
