import { describe, expect, it } from 'vitest';
import {
  type AgentSession,
  errorResult,
  textResult,
} from '../../sessions/contract';
import {
  createPermissionRoute,
  NO_PROCESS_TEXT,
  type PermissionTarget,
  readPermissionCall,
  type RoutedPermissionCall,
} from './permission-route';

const ARGS = { tool_name: 'Bash', input: { command: 'ls' } };

function sessionOf(rowId: string): AgentSession {
  return {
    id: rowId,
    info: { sessionId: null, projectDir: '/p', harness: 'claude' },
  };
}

function context(signal = new AbortController().signal) {
  return { toolUseId: null, signal };
}

// A target that replies `reply` at once, recording each call and its signal.
function replyingTarget(reply: string) {
  const asked: { call: RoutedPermissionCall; signal: AbortSignal }[] = [];
  const target: PermissionTarget = {
    ask(call, signal) {
      asked.push({ call, signal });
      return Promise.resolve(reply);
    },
  };
  return { target, asked };
}

// A target whose calls wait until the test settles them.
function waitingTarget() {
  const signals: AbortSignal[] = [];
  const target: PermissionTarget = {
    ask(_call, signal) {
      signals.push(signal);
      return new Promise<string>(() => undefined);
    },
  };
  return { target, signals };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe('readPermissionCall', () => {
  it('readPermissionCall_readsTheDocumentedShape', () => {
    expect(
      readPermissionCall({
        tool_name: 'Write',
        input: { file_path: '/a.txt' },
        tool_use_id: 'toolu_1',
      }),
    ).toEqual({
      toolName: 'Write',
      input: { file_path: '/a.txt' },
      toolUseId: 'toolu_1',
    });
    expect(
      readPermissionCall({ tool_name: 'Bash', input: { command: 'ls' } }),
    ).toEqual({ toolName: 'Bash', input: { command: 'ls' }, toolUseId: null });
  });

  it('readPermissionCall_namesTheWrongField', () => {
    expect(() => readPermissionCall({ tool_name: 7, input: {} })).toThrow(
      /tool_name/,
    );
    expect(() => readPermissionCall({ tool_name: 'Bash' })).toThrow(/input/);
  });
});

describe('createPermissionRoute', () => {
  it('toolSession_RoutesByRowId', async () => {
    const route = createPermissionRoute();
    const rowA = replyingTarget('reply a');
    const rowB = replyingTarget('reply b');
    route.route('row-a', Promise.resolve(rowA.target));
    route.route('row-b', Promise.resolve(rowB.target));

    const result = await route
      .toolSession(sessionOf('row-a'))
      .call('permission_prompt', ARGS, context());

    expect(result).toEqual(textResult('reply a'));
    expect(rowA.asked.map(({ call }) => call)).toEqual([
      {
        toolName: 'Bash',
        input: { command: 'ls' },
        toolUseId: null,
        args: ARGS,
      },
    ]);
    expect(rowB.asked).toEqual([]);
  });

  it.each([
    {
      given: 'no record',
      arrange: () => undefined,
    },
    {
      given: 'a dispose removed it',
      arrange: (route: ReturnType<typeof createPermissionRoute>) =>
        route
          .route('row-a', Promise.resolve(replyingTarget('no').target))
          .dispose(),
    },
    {
      given: 'the target promise settled null',
      arrange: (route: ReturnType<typeof createPermissionRoute>) =>
        route.route('row-a', Promise.resolve(null)),
    },
    {
      given: 'the target promise rejected',
      arrange: (route: ReturnType<typeof createPermissionRoute>) =>
        route.route('row-a', Promise.reject(new Error('attach failed'))),
    },
  ])('toolSession_NoProcess_ErrorResult given $given', async ({ arrange }) => {
    const route = createPermissionRoute();
    arrange(route);

    const result = await route
      .toolSession(sessionOf('row-a'))
      .call('permission_prompt', ARGS, context());

    expect(result).toEqual(errorResult(NO_PROCESS_TEXT));
  });

  it('toolSession_TargetPending_WaitsForIt', async () => {
    const route = createPermissionRoute();
    let attach: (target: PermissionTarget) => void = () => undefined;
    route.route(
      'row-a',
      new Promise<PermissionTarget>((resolve) => {
        attach = resolve;
      }),
    );
    let result: unknown = 'pending';
    void route
      .toolSession(sessionOf('row-a'))
      .call('permission_prompt', ARGS, context())
      .then((settled) => {
        result = settled;
      });
    await flush();
    expect(result).toBe('pending');

    attach(replyingTarget('after attach').target);
    await flush();

    expect(result).toEqual(textResult('after attach'));
  });

  it('toolSession_End_AbortsWaitingCalls', async () => {
    const route = createPermissionRoute();
    const { target, signals } = waitingTarget();
    route.route('row-a', Promise.resolve(target));
    const tools = route.toolSession(sessionOf('row-a'));
    void tools.call('permission_prompt', ARGS, context());
    await flush();
    expect(signals.map((signal) => signal.aborted)).toEqual([false]);

    tools.end();

    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
  });

  it('route_LaterRouteReplaces_DisposeRemovesOnlyItsOwn', async () => {
    const route = createPermissionRoute();
    const tools = route.toolSession(sessionOf('row-a'));
    const first = route.route(
      'row-a',
      Promise.resolve(replyingTarget('first').target),
    );
    const second = route.route(
      'row-a',
      Promise.resolve(replyingTarget('second').target),
    );

    first.dispose();
    const afterFirstDispose = await tools.call(
      'permission_prompt',
      ARGS,
      context(),
    );
    second.dispose();
    const afterSecondDispose = await tools.call(
      'permission_prompt',
      ARGS,
      context(),
    );

    expect(afterFirstDispose).toEqual(textResult('second'));
    expect(afterSecondDispose).toEqual(errorResult(NO_PROCESS_TEXT));
  });

  it('toolSession_UnknownTool_Throws', async () => {
    const route = createPermissionRoute();

    await expect(
      route.toolSession(sessionOf('row-a')).call('x', ARGS, context()),
    ).rejects.toThrow('claude-code has no tool "x"');
  });
});
