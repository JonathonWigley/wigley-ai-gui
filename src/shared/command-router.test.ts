import { describe, expect, it, vi } from 'vitest';
import type {
  CommandHop,
  CommandKey,
  CommandOutcome,
} from '../contracts/commands';
import type { CommandInfo, PageCommandContext } from '../contracts/plugin';
import { CommandRegistry } from './command-registry';
import { createCommandRouter } from './command-router';

function info(id: string, overrides: Partial<CommandInfo> = {}): CommandInfo {
  return {
    id,
    plugin: 'p',
    label: id,
    group: 'g',
    runsIn: 'page',
    ...overrides,
  };
}

function setup(infos: CommandInfo[]) {
  const registry = new CommandRegistry<PageCommandContext<any>>(() => {});
  const remote = vi.fn(
    async (
      _id: string,
      _arg: unknown,
      _hop: CommandHop,
    ): Promise<CommandOutcome> => 'ran',
  );
  const router = createCommandRouter<PageCommandContext<any>>({
    process: 'page',
    registry,
    infoOf: (id) => infos.find((each) => each.id === id),
    remote,
  });
  return { registry, remote, router };
}

describe('createCommandRouter', () => {
  it('run_UnknownOrBadArg_ThrowsAtTheCallNotARejection', () => {
    const { registry, router } = setup([info('p.n', { arg: 'number' })]);
    registry.register('p.n', () => {}, 'p');

    expect(() => router.run('p.gone', undefined)).toThrow(
      'No command is registered as "p.gone"',
    );
    expect(() => router.run('p.n', undefined)).toThrow(
      'command "p.n" needs a number',
    );
  });

  it('run_OwnCommandNoHandler_ThrowsAtTheCall', () => {
    const { router } = setup([info('p.off')]);

    expect(() => router.run('p.off', undefined)).toThrow(
      'No command is registered as "p.off"',
    );
  });

  it('run_OtherProcessCommand_GoesToRemoteAndNoLocalIntercept', async () => {
    const { registry, remote, router } = setup([
      info('p.m', { runsIn: 'main', arg: 'number' }),
    ]);
    const wrap = vi.fn();
    registry.intercept('p.m', wrap, 'p');

    await router.run(
      'p.m',
      4,
      { editor: undefined, targetSessionId: 's1', callerSessionId: 'c1' },
      { reportErrors: true },
    );

    // Strict: the hop holds no `editor` key, set or undefined.
    expect(remote.mock.calls).toStrictEqual([
      [
        'p.m',
        4,
        { targetSessionId: 's1', callerSessionId: 'c1', reportErrors: true },
      ],
    ]);
    expect(wrap).not.toHaveBeenCalled();
  });

  it('run_CommandKey_RunsByItsId', async () => {
    const { registry, router } = setup([info('p.n', { arg: 'number' })]);
    const heard: unknown[] = [];
    registry.register('p.n', ({ arg }) => void heard.push(arg), 'p');
    const key: CommandKey<number> = { id: 'p.n' };

    await router.run(key, 7);

    expect(heard).toEqual([7]);
  });

  it('run_Extras_ReachTheHandlerWithTheArg', async () => {
    const { registry, router } = setup([info('p.n', { arg: 'number' })]);
    const contexts: unknown[] = [];
    registry.register('p.n', (context) => void contexts.push(context), 'p');

    await router.run('p.n', 7, {
      editor: undefined,
      targetSessionId: 's1',
      callerSessionId: 'c1',
    });

    expect(contexts).toEqual([
      {
        editor: undefined,
        targetSessionId: 's1',
        callerSessionId: 'c1',
        arg: 7,
      },
    ]);
  });

  it('intercept_OtherProcessCommand_Throws', () => {
    const { router } = setup([info('p.m', { runsIn: 'main' })]);

    expect(() => router.intercept('p.m', () => {}, 'q')).toThrow(
      'p.m runs in main; intercept it there',
    );
    expect(() => router.intercept('p.later', () => {}, 'q')).not.toThrow();
  });
});
