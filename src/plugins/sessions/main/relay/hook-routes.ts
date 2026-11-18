import type { Disposable } from '../../../../contracts/disposable';
import type { PluginLog } from '../../../../contracts/log';
import { errorText } from '../../../../shared/error-text';
import type {
  AgentSession,
  HookHandler,
  HookReply,
  SessionInfo,
} from '../../contract';

// One handler per hook name. `add` throws on a name another live registration
// holds; its handle's `dispose` frees the name, and a second `dispose` does
// nothing. `answer` never rejects: a missing handler, no live session for the
// hello's info, and a handler that rejects or throws each answer `ok: false`.
export interface HookRoutes {
  add(name: string, handler: HookHandler): Disposable;
  answer(name: string, info: SessionInfo, request: unknown): Promise<HookReply>;
}

// `sessionOf` finds the live session a hook hello names; a hook never creates
// one. A handler's failure is logged as `hook <name> failed: <text>`.
export function createHookRoutes(
  sessionOf: (info: SessionInfo) => AgentSession | null,
  log: PluginLog,
): HookRoutes {
  const handlers = new Map<string, HookHandler>();
  return {
    add(name, handler) {
      if (handlers.has(name)) {
        throw new Error(`hook handler ${name} is already registered`);
      }
      handlers.set(name, handler);
      let isDisposed = false;
      return {
        dispose: () => {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          handlers.delete(name);
        },
      };
    },
    async answer(name, info, request) {
      const handler = handlers.get(name);
      if (handler === undefined) {
        return { ok: false, error: `no hook handler named ${name}` };
      }
      const session = sessionOf(info);
      if (session === null) {
        return {
          ok: false,
          error: `no live session holds host id ${info.sessionId ?? 'none'}`,
        };
      }
      try {
        return { ok: true, reply: await handler(session, request) };
      } catch (error) {
        const text = errorText(error);
        log(`hook ${name} failed: ${text}`);
        return { ok: false, error: text };
      }
    },
  };
}
