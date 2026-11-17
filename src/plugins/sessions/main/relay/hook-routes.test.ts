import { describe, expect, it } from 'vitest';
import type {
  AgentSession,
  HookHandler,
  HookReply,
  SessionInfo,
} from '../../contract';
import { createHookRoutes } from './hook-routes';

const SESSION: AgentSession = {
  id: 'row-1',
  info: {
    sessionId: 'host-1',
    projectDir: '/work/alpha',
    harness: 'claude',
    rowId: null,
  },
};

function hookInfo(sessionId: string | null, rowId: string | null): SessionInfo {
  return { sessionId, projectDir: '/work/alpha', harness: 'claude', rowId };
}

// Finds SESSION by its app id as a row id or by its host id.
function sessionOf(info: SessionInfo): AgentSession | null {
  const isNamed =
    info.rowId === SESSION.id || info.sessionId === SESSION.info.sessionId;
  return isNamed ? SESSION : null;
}

describe('createHookRoutes', () => {
  it.each<{
    case: string;
    name: string;
    info: SessionInfo;
    fails: boolean;
    expected: HookReply;
    received: [AgentSession, unknown][];
    logged: string[];
  }>([
    {
      case: 'handler found and resolves',
      name: 'chatroom.pre',
      info: hookInfo('host-1', null),
      fails: false,
      expected: { ok: true, reply: { verdict: 'allow' } },
      received: [[SESSION, { tool: 'edit' }]],
      logged: [],
    },
    {
      case: 'found by row id with a null host id',
      name: 'chatroom.pre',
      info: hookInfo(null, 'row-1'),
      fails: false,
      expected: { ok: true, reply: { verdict: 'allow' } },
      received: [[SESSION, { tool: 'edit' }]],
      logged: [],
    },
    {
      case: 'unknown name',
      name: 'chatroom.post',
      info: hookInfo('host-1', null),
      fails: false,
      expected: { ok: false, error: 'no hook handler named chatroom.post' },
      received: [],
      logged: [],
    },
    {
      case: 'null host id and no row id',
      name: 'chatroom.pre',
      info: hookInfo(null, null),
      fails: false,
      expected: { ok: false, error: 'no live session holds host id none' },
      received: [],
      logged: [],
    },
    {
      case: 'unknown host id',
      name: 'chatroom.pre',
      info: hookInfo('host-9', null),
      fails: false,
      expected: { ok: false, error: 'no live session holds host id host-9' },
      received: [],
      logged: [],
    },
    {
      case: 'handler rejects',
      name: 'chatroom.pre',
      info: hookInfo('host-1', null),
      fails: true,
      expected: { ok: false, error: 'room store unavailable' },
      received: [[SESSION, { tool: 'edit' }]],
      logged: ['hook chatroom.pre failed: room store unavailable'],
    },
  ])('answer_Outcomes: $case', async ({ name, info, fails, ...outcome }) => {
    const received: [AgentSession, unknown][] = [];
    const logged: string[] = [];
    const handler: HookHandler = async (session, request) => {
      received.push([session, request]);
      if (fails) {
        throw new Error('room store unavailable');
      }
      return { verdict: 'allow' };
    };
    const routes = createHookRoutes(sessionOf, (message) =>
      logged.push(message),
    );
    routes.add('chatroom.pre', handler);

    const reply = await routes.answer(name, info, { tool: 'edit' });

    expect(reply).toEqual(outcome.expected);
    expect(received).toEqual(outcome.received);
    expect(logged).toEqual(outcome.logged);
  });

  it('add_NameHeld_Throws', async () => {
    const routes = createHookRoutes(sessionOf, () => {});
    const first = routes.add('chatroom.pre', async () => ({ from: 'first' }));

    expect(() =>
      routes.add('chatroom.pre', async () => ({ from: 'second' })),
    ).toThrow('hook handler chatroom.pre is already registered');
    first.dispose();
    routes.add('chatroom.pre', async () => ({ from: 'second' }));
    first.dispose();

    expect(
      await routes.answer('chatroom.pre', hookInfo('host-1', null), {}),
    ).toEqual({ ok: true, reply: { from: 'second' } });
  });
});
