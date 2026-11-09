import { vi } from 'vitest';
import { fakeDependency } from '../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from './chat/contract';
import {
  type ConnectedSession,
  type SessionInfo,
  type SessionsMainExports,
  sessionsMainKey,
  type ToolResult,
} from './sessions/contract';

export const fakeChat = fakeDependency(
  chatMainKey,
  () =>
    ({
      profileOf: () => null,
      isHeadless: () => false,
    }) as unknown as ChatMainExports,
);

export const SUBMITTED: ToolResult = {
  content: [{ type: 'text', text: 'done' }],
};

// Sessions whose tool calls wait until the test answers them; each call's tool
// name and args are kept in `calls`.
export function fakeSessions() {
  const connectedInfo: SessionInfo[] = [];
  const answers: ((result: ToolResult) => void)[] = [];
  const calls: [string, unknown][] = [];
  return {
    connectedInfo,
    answers,
    calls,
    connect(info: SessionInfo): ConnectedSession {
      connectedInfo.push(info);
      const id = `row-${String(info.sessionId)}`;
      return {
        session: { id, info },
        call: (tool, args) =>
          new Promise<ToolResult>((resolve) => {
            calls.push([tool, args]);
            answers.push(resolve);
          }),
        end: () => undefined,
      };
    },
  };
}

// The sessions plugin's ended event, which the test emits by row id.
export function fakeEndedEvent() {
  const listeners: ((rowId: string) => void)[] = [];
  return {
    on: (listener: (rowId: string) => void) => listeners.push(listener),
    emit: (rowId: string) => {
      for (const listener of listeners) {
        listener(rowId);
      }
    },
  };
}

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
