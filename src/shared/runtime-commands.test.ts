import { describe, expect, it, vi } from 'vitest';
import type {
  CommandHop,
  CommandId,
  CommandOutcome,
  CommandSessions,
} from '../contracts/commands';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
} from '../contracts/core-state';
import type { CommandInfo, MainCommandContext } from '../contracts/plugin';
import { CommandRegistry } from './command-registry';
import {
  createRuntimeCommands,
  EMPTY_RUNTIME_CATALOG,
} from './runtime-commands';
import { createSlotStore } from './state/slot-store';

function info(id: CommandId, overrides: Partial<CommandInfo> = {}): CommandInfo {
  return {
    id,
    plugin: id.split('.')[0],
    label: id,
    group: 'g',
    runsIn: 'main',
    ...overrides,
  };
}

// Main's commands serving `served`, with plugin `p`'s view of them.
function setup(served: Record<CommandId, CommandInfo> = {}) {
  const state = createSlotStore(() => {});
  const remote = vi.fn(
    async (
      _id: CommandId,
      _arg: unknown,
      _hop: CommandHop,
    ): Promise<CommandOutcome> => 'ran',
  );
  const commands = createRuntimeCommands<MainCommandContext<any>>({
    process: 'main',
    registry: new CommandRegistry(() => {}),
    writer: state.publish(coreRuntimeMainSlot),
    other: state.read(coreRuntimePageSlot, 'core'),
    served: () => served,
    leader: () => '<Space>',
    remote,
  });
  const { commands: api, bind } = commands.forPlugin('p', (handle) => handle);
  const writePageCatalog = (pageCommands: CommandInfo[]) =>
    state.applyRemote({
      id: coreRuntimePageSlot.id,
      kind: 'value',
      value: { ...EMPTY_RUNTIME_CATALOG, commands: pageCommands },
    });
  return { state, api, bind, remote, writePageCatalog };
}

describe('createRuntimeCommands', () => {
  it('bind_AppBindOnABadAccelerator_ThrowsAtTheCall', () => {
    const { state, api, bind } = setup();
    api.register('go', { label: 'Go', group: 'g', runsIn: 'main' }, () => {});

    expect(() =>
      bind({ kind: 'app', bind: { accelerator: 'Alt+Nope', command: 'p.go' } }),
    ).toThrow('"Nope"');
    expect(state.read(coreRuntimeMainSlot, 'core').get()?.binds.app).toEqual(
      [],
    );
  });

  it('list gives each live command once, catalogs before the served config, sorted by id', () => {
    const pageCommand = info('q.page', { runsIn: 'page', runtime: true });
    const { api, writePageCatalog } = setup({
      'z.served': info('z.served'),
      'q.page': { ...pageCommand, label: 'served copy' },
      'q.old': info('q.old', { runsIn: 'page', runtime: true }),
    });
    writePageCatalog([pageCommand]);

    expect(api.list()).toEqual([pageCommand, info('z.served')]);
  });

  it.each<[string, CommandId, unknown, CommandSessions, string]>([
    ['an unknown id', 'p.gone', undefined, {}, 'Unknown command p.gone'],
    ['a bad argument', 'p.n', 'x', {}, 'command "p.n" needs a number'],
    ['no handler', 'p.off', undefined, {}, 'p.off has no handler'],
    [
      'a target for a command without targets',
      'p.go',
      undefined,
      { targetSessionId: 's1' },
      'p.go takes no session',
    ],
  ])(
    'runFor_Refused_RejectsAndNeverThrowsAtTheCall: %s',
    async (_case, id, arg, sessions, text) => {
      const { api } = setup({ 'p.off': info('p.off') });
      const ran: unknown[] = [];
      api.register(
        'go',
        { label: 'Go', group: 'g', runsIn: 'main' },
        ({ arg: heard }) => void ran.push(heard),
      );
      api.register(
        'n',
        { label: 'N', group: 'g', runsIn: 'main', arg: 'number' },
        ({ arg: heard }) => void ran.push(heard),
      );

      let run: Promise<CommandOutcome> | null = null;
      expect(() => {
        run = api.runFor(id, arg, sessions);
      }).not.toThrow();

      await expect(run).rejects.toThrow(text);
      expect(ran).toEqual([]);
    },
  );

  it('runFor_TargetsCommandOfTheOtherProcess_SendsAReportingHopWithItsSessions', async () => {
    const { api, remote } = setup({
      'q.send': info('q.send', { runsIn: 'page', targets: true }),
    });

    await expect(
      api.runFor('q.send', undefined, {
        targetSessionId: 's1',
        callerSessionId: 'c1',
      }),
    ).resolves.toBe('ran');

    expect(remote.mock.calls).toEqual([
      [
        'q.send',
        undefined,
        { targetSessionId: 's1', callerSessionId: 'c1', reportErrors: true },
      ],
    ]);
  });

  it('runFor_LocalHandlerThrows_RejectsWithItsErrorAndTheHandlerSeesItsSessions', async () => {
    const { api, remote } = setup();
    const contexts: unknown[] = [];
    api.register(
      'boom',
      { label: 'Boom', group: 'g', runsIn: 'main', targets: true },
      (context) => {
        contexts.push(context);
        throw new Error('boom');
      },
    );

    await expect(
      api.runFor('p.boom', undefined, {
        targetSessionId: 's1',
        callerSessionId: 'c1',
      }),
    ).rejects.toThrow(/^boom$/);

    expect(contexts).toEqual([
      { targetSessionId: 's1', callerSessionId: 'c1', arg: undefined },
    ]);
    expect(remote).not.toHaveBeenCalled();
  });
});
