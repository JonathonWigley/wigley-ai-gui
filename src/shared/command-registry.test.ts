import { describe, expect, it } from 'vitest';
import type { Log } from '../contracts/log';
import { CommandRegistry } from './command-registry';

function setup() {
  const logs: string[] = [];
  const log: Log = (source, message) => {
    logs.push(`${source}: ${message}`);
  };
  return { commands: new CommandRegistry<{ arg: unknown }>(log), logs };
}

const NO_ARG = { arg: undefined };

describe('CommandRegistry', () => {
  it("register's handle unregisters the command", () => {
    const { commands } = setup();
    const handle = commands.register('p.go', () => {}, 'p');

    handle.dispose();
    handle.dispose();

    expect(commands.has('p.go')).toBe(false);
    expect(() => commands.run('p.go', NO_ARG)).toThrow(
      'No command is registered as "p.go"',
    );
  });

  it('a disposed handle leaves the command registered after it', async () => {
    const { commands } = setup();
    const ran: string[] = [];
    const first = commands.register('p.go', () => void ran.push('first'), 'p');
    first.dispose();
    commands.register('p.go', () => void ran.push('second'), 'p');

    first.dispose();
    await commands.run('p.go', NO_ARG);

    expect(ran).toEqual(['second']);
  });

  it('run_NoIntercept_StartsTheHandlerBeforeReturning', () => {
    const { commands } = setup();
    let started = false;
    commands.register(
      'p.go',
      async () => {
        started = true;
      },
      'p',
    );

    void commands.run('p.go', NO_ARG);

    expect(started).toBe(true);
  });

  it('run_HandlerRunsAndResolves_ResolvesRan', async () => {
    const { commands } = setup();
    commands.register('p.go', async () => {}, 'p');

    await expect(
      commands.run('p.go', NO_ARG, { reportErrors: true }),
    ).resolves.toBe('ran');
  });

  const throwsBoom = () => {
    throw new Error('boom');
  };
  const rejectsBoom = () => Promise.reject(new Error('boom'));

  it.each([
    { case: 'throws', handler: throwsBoom, reportErrors: undefined },
    { case: 'rejects', handler: rejectsBoom, reportErrors: undefined },
    { case: 'throws, reporting', handler: throwsBoom, reportErrors: true },
    { case: 'rejects, reporting', handler: rejectsBoom, reportErrors: true },
  ] as const)(
    'run_HandlerThrowsOrRejects_LogsUnderOwnerAndSkipsOrRejectsAReportingRun: $case',
    async ({ handler, reportErrors }) => {
      const { commands, logs } = setup();
      const heard: string[] = [];
      commands.register('p.go', handler, 'owner');
      commands.onDidRun((id) => heard.push(id), 'q');

      const run = commands.run('p.go', NO_ARG, { reportErrors });

      if (reportErrors) {
        await expect(run).rejects.toThrow(/^boom$/);
      } else {
        await expect(run).resolves.toBe('skipped');
      }
      expect(logs).toEqual(['owner: command p.go failed: boom']);
      expect(heard).toEqual([]);
    },
  );

  it('intercept_TwoWraps_LastRegisteredIsOutermost', async () => {
    const { commands } = setup();
    const order: string[] = [];
    commands.register('p.go', () => void order.push('handler'), 'p');
    const wrapOf = (name: string) => async (next: () => Promise<void>) => {
      order.push(`${name} in`);
      await next();
      order.push(`${name} out`);
    };
    commands.intercept('p.go', wrapOf('first'), 'a');
    commands.intercept('p.go', wrapOf('second'), 'b');

    await commands.run('p.go', { arg: 3 });

    expect(order).toEqual([
      'second in',
      'first in',
      'handler',
      'first out',
      'second out',
    ]);
  });

  it('intercept_WrapContext_HoldsIdAndArg', async () => {
    const { commands } = setup();
    const contexts: unknown[] = [];
    commands.register('p.go', () => {}, 'p');
    commands.intercept(
      'p.go',
      (_next, context) => void contexts.push(context),
      'a',
    );

    await commands.run('p.go', { arg: 3 });

    expect(contexts).toEqual([{ id: 'p.go', arg: 3 }]);
  });

  it('intercept_WrapSkipsNext_NoHandlerAndNoDidRun', async () => {
    const { commands } = setup();
    const ran: string[] = [];
    commands.register('p.go', () => void ran.push('handler'), 'p');
    commands.onDidRun((id) => ran.push(`did ${id}`), 'q');
    commands.intercept('p.go', () => {}, 'a');

    await expect(
      commands.run('p.go', NO_ARG, { reportErrors: true }),
    ).resolves.toBe('skipped');

    expect(ran).toEqual([]);
  });

  it('intercept_NextTwice_RunsTheHandlerOnce', async () => {
    const { commands } = setup();
    let runs = 0;
    commands.register(
      'p.go',
      () => {
        runs += 1;
      },
      'p',
    );
    commands.intercept(
      'p.go',
      async (next) => {
        await next();
        await next();
      },
      'a',
    );

    await commands.run('p.go', NO_ARG);

    expect(runs).toBe(1);
  });

  it.each([
    { case: 'plain', reportErrors: undefined },
    { case: 'reporting', reportErrors: true },
  ] as const)(
    'intercept_WrapThrows_LogsUnderTheWrapOwnerAndSkipsOrRejectsAReportingRun: $case',
    async ({ reportErrors }) => {
      const { commands, logs } = setup();
      const heard: string[] = [];
      commands.register('p.go', () => {}, 'p');
      commands.onDidRun((id) => heard.push(id), 'q');
      commands.intercept(
        'p.go',
        async (next) => {
          await next();
          throw new Error('boom');
        },
        'wrapper',
      );

      const run = commands.run('p.go', NO_ARG, { reportErrors });

      if (reportErrors) {
        await expect(run).rejects.toThrow(/^boom$/);
      } else {
        await expect(run).resolves.toBe('skipped');
      }
      expect(logs).toEqual(['wrapper: intercept of p.go failed: boom']);
      expect(heard).toEqual([]);
    },
  );

  it('run_HandlerThenWrapFail_RejectsWithTheFirstFailure', async () => {
    const { commands } = setup();
    commands.register('p.go', () => Promise.reject(new Error('first')), 'p');
    commands.intercept(
      'p.go',
      async (next) => {
        await next();
        throw new Error('second');
      },
      'wrapper',
    );

    await expect(
      commands.run('p.go', NO_ARG, { reportErrors: true }),
    ).rejects.toThrow(/^first$/);
  });

  it('intercept_WrapDoesNotAwaitNext_RunWaitsForTheHandler', async () => {
    const { commands } = setup();
    const order: string[] = [];
    let finish = () => {};
    commands.register(
      'p.go',
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      'p',
    );
    commands.onDidRun(() => order.push('did'), 'q');
    commands.intercept('p.go', (next) => void next(), 'a');

    const run = commands.run('p.go', NO_ARG).then(() => order.push('ran'));
    await Promise.resolve();
    order.push('still running');
    finish();
    await run;

    expect(order).toEqual(['still running', 'did', 'ran']);
  });

  it('intercept_Disposed_WrapGone', async () => {
    const { commands } = setup();
    const ran: string[] = [];
    commands.register('p.go', () => void ran.push('handler'), 'p');
    const handle = commands.intercept('p.go', () => void ran.push('wrap'), 'a');

    handle.dispose();
    await commands.run('p.go', NO_ARG);

    expect(ran).toEqual(['handler']);
  });

  it('onDidRun_ListenerThrows_OtherListenersRun', async () => {
    const { commands, logs } = setup();
    const heard: unknown[] = [];
    commands.register('p.go', () => {}, 'p');
    commands.onDidRun(() => {
      throw new Error('boom');
    }, 'noisy');
    commands.onDidRun((id, arg) => heard.push([id, arg]), 'q');

    await commands.run('p.go', { arg: 3 });

    expect(heard).toEqual([['p.go', 3]]);
    expect(logs).toEqual(['noisy: listener of command p.go failed: boom']);
  });
});
