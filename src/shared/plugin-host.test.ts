import { describe, expect, it, vi } from 'vitest';
import type { Registrations } from '../contracts/disposable';
import type { PartStop, PluginManifest } from '../contracts/plugin';
import { type PartContext, type PluginHost, startPlugins } from './plugin-host';

interface TestPart {
  manifest: PluginManifest;
  exports?: (consumer: Registrations) => unknown;
}

function part(
  id: string,
  dependsOn: string[] = [],
  exports?: (consumer: Registrations) => unknown,
  otherProcess: string[] = [],
): TestPart {
  return {
    manifest: {
      id,
      label: id,
      description: 'A test plugin.',
      dependsOn: { main: dependsOn, page: otherProcess },
      reads: { main: [], page: [] },
      commands: {},
      scopes: {},
      settings: {},
      settingInfo: {},
      themeTokens: {},
    },
    exports,
  };
}

// Starts each part `disabled` does not name, recording its id in start order.
function startRecording(parts: TestPart[], disabled: string[] = []): string[] {
  const order: string[] = [];
  startPlugins(
    parts,
    'main',
    (started) => {
      order.push(started.manifest.id);
      return { exports: started.exports };
    },
    parts.map((each) => each.manifest),
    disabled,
  );
  return order;
}

// Starts `parts`, each with an async `dispose` that logs `dispose <id>` and a
// tracked handle that logs `regs <id>`.
function startLogging(parts: TestPart[], log: string[]) {
  return startPlugins(parts, 'main', (started, context) => {
    const { id } = started.manifest;
    context.registrations.track({ dispose: () => log.push(`regs ${id}`) });
    return {
      dispose: async () => {
        await Promise.resolve();
        log.push(`dispose ${id}`);
      },
    };
  });
}

interface Hooks {
  exports?(consumer: Registrations): unknown;
  dispose?(stop: PartStop): void | Promise<void>;
  ready?(): void;
  mayStop?(): string | null;
}

// Starts `parts` that `disabled` does not name, each returning what `hooks`
// gives for it, with the host's lines kept in `logged` as
// `<source>: <message>`.
function startHooked(
  parts: TestPart[],
  hooks: (id: string, context: PartContext) => Hooks,
  disabled: string[] = [],
  logged: string[] = [],
) {
  return startPlugins(
    parts,
    'main',
    (started, context) => hooks(started.manifest.id, context),
    parts.map((each) => each.manifest),
    disabled,
    (source, message) => logged.push(`${source}: ${message}`),
  );
}

// Hooks that push `start <id>` as each part starts and `ready <id>` from its
// `ready`.
function recordingHooks(events: string[]) {
  return (id: string): Hooks => {
    events.push(`start ${id}`);
    return { ready: () => events.push(`ready ${id}`) };
  };
}

describe('startPlugins', () => {
  // The second row is the page list's workflow, agent-strip and docs: a part
  // waiting on a later-listed dependency still starts before the parts
  // listed after it, so chat draws workflow's composer part first. The third
  // shows a page-list edge orders nothing in main.
  it.each([
    {
      parts: [part('b', ['a']), part('a'), part('c')],
      order: ['a', 'b', 'c'],
    },
    {
      parts: [part('w', ['d']), part('s'), part('d', ['k']), part('k')],
      order: ['k', 'd', 'w', 's'],
    },
    {
      parts: [part('b', [], undefined, ['a']), part('a')],
      order: ['b', 'a'],
    },
  ])('starts each part in list order after its dependencies', (row) => {
    expect(startRecording(row.parts)).toEqual(row.order);
  });

  it("hands each dependent its own view of a dependency's exports, made once", () => {
    const exports = vi.fn((consumer: Registrations) => ({ consumer }));
    const contexts = new Map<string, PartContext>();
    const views = new Map<string, unknown[]>();

    startPlugins(
      [part('a', [], exports), part('b', ['a']), part('c', ['a'])],
      'main',
      (started, context) => {
        const { id } = started.manifest;
        contexts.set(id, context);
        if (id !== 'a') {
          views.set(id, [context.dependency('a'), context.dependency('a')]);
        }
        return { exports: started.exports };
      },
    );

    expect(exports).toHaveBeenCalledTimes(2);
    const [bFirst, bSecond] = views.get('b')!;
    expect(bSecond).toBe(bFirst);
    expect((bFirst as { consumer: Registrations }).consumer).toBe(
      contexts.get('b')!.registrations,
    );
    expect(views.get('c')![0]).not.toBe(bFirst);
  });

  it('rejects a missing dependency', () => {
    expect(() => startRecording([part('b', ['a'])])).toThrow(/"b".*a/);
  });

  it('starts a part whose dependency is known but has no part here', () => {
    let received: unknown = 'not read';
    const pageOnly = part('a').manifest;
    const b = part('b', ['a']);

    const host = startPlugins(
      [b],
      'main',
      (started, context) => {
        received = context.dependency('a');
        return { exports: started.exports };
      },
      [pageOnly, b.manifest],
    );

    expect([...host.started.keys()]).toEqual(['b']);
    expect(received).toBeUndefined();
  });

  it('returns undefined for a dependency with no exports', () => {
    let received: unknown = 'not read';

    startPlugins([part('a'), part('b', ['a'])], 'main', (started, context) => {
      if (started.manifest.id === 'b') {
        received = context.dependency('a');
      }
      return { exports: started.exports };
    });

    expect(received).toBeUndefined();
  });

  it('rejects a duplicate id', () => {
    expect(() => startRecording([part('a'), part('a')])).toThrow(/"a"/);
  });

  it('rejects a cycle', () => {
    expect(() => startRecording([part('a', ['b']), part('b', ['a'])])).toThrow(
      /cycle: a, b/,
    );
  });

  it('skips a disabled part and starts the rest in order', () => {
    const parts = [part('a'), part('b'), part('c')];
    const order: string[] = [];

    const host = startPlugins(
      parts,
      'main',
      (each) => {
        order.push(each.manifest.id);
        return {};
      },
      parts.map((each) => each.manifest),
      ['b'],
    );

    expect(order).toEqual(['a', 'c']);
    expect(host.started.has('b')).toBe(false);
  });

  it('rejects a kept part that depends on a disabled one', () => {
    expect(() => startRecording([part('a'), part('b', ['a'])], ['a'])).toThrow(
      /"a".*"b"/,
    );
  });

  it('ignores a disabled id with no part', () => {
    expect(startRecording([part('a')], ['z'])).toEqual(['a']);
  });

  it.each([
    { name: 'declared nowhere', asker: part('b') },
    {
      name: 'declared only in the page list',
      asker: part('b', [], undefined, ['c']),
    },
  ])('rejects a dependency $name', ({ asker }) => {
    expect(() =>
      startPlugins([part('c'), asker], 'main', (started, context) => {
        if (started.manifest.id === 'b') {
          context.dependency('c');
        }
        return {};
      }),
    ).toThrow(/"b".*"c".*dependsOn\.main/);
  });

  it('starts a part whose reads names a plugin not in the list', () => {
    const reader = part('a');
    reader.manifest = {
      ...reader.manifest,
      reads: { main: ['ghost'], page: [] },
    };

    expect(startRecording([reader])).toEqual(['a']);
  });

  it('stops the dependents of a part first, newest first, then the part', async () => {
    const log: string[] = [];
    const host = startLogging(
      [part('a'), part('b', ['a']), part('c', ['b']), part('d')],
      log,
    );

    await expect(host.stop('a')).resolves.toEqual(['c', 'b', 'a']);

    expect(log).toEqual([
      'dispose c',
      'regs c',
      'dispose b',
      'regs b',
      'dispose a',
      'regs a',
    ]);
    expect([...host.started.keys()]).toEqual(['d']);
  });

  it.each<{
    case: string;
    act(host: PluginHost<Hooks, TestPart>): Promise<unknown>;
    stops: string[];
  }>([
    {
      case: 'stop left out',
      act: (host) => host.stop('a'),
      stops: ['b end', 'a end'],
    },
    {
      case: 'stop as a restart',
      act: (host) => host.stop('a', 'restart'),
      stops: ['b restart', 'a restart'],
    },
    {
      case: 'remove as a restart',
      act: (host) => host.remove('a', 'restart'),
      stops: ['b restart', 'a restart'],
    },
    {
      case: 'restart',
      act: (host) => host.restart('a'),
      stops: ['b restart', 'a restart'],
    },
    {
      case: 'stopAll',
      act: (host) => host.stopAll(),
      stops: ['b end', 'a end'],
    },
  ])(
    "hands each part's dispose how it stops: $case",
    async ({ act, stops }) => {
      const disposed: string[] = [];
      const host = startHooked([part('a'), part('b', ['a'])], (id) => ({
        dispose: (stop) => {
          disposed.push(`${id} ${stop}`);
        },
      }));

      await act(host);

      expect(disposed).toEqual(stops);
    },
  );

  it('stop of a part not started does nothing', async () => {
    const log: string[] = [];
    const host = startLogging([part('a'), part('b')], log);

    await expect(host.stop('zzz')).resolves.toEqual([]);

    expect(log).toEqual([]);
    expect([...host.started.keys()]).toEqual(['a', 'b']);
  });

  it.each([
    { name: 'stop', run: (host: PluginHost<unknown>) => host.stop('a') },
    { name: 'stopAll', run: (host: PluginHost<unknown>) => host.stopAll() },
  ])(
    '$name runs every step when one throws and rejects with the first error',
    async ({ run }) => {
      const log: string[] = [];
      const host = startPlugins(
        [part('a'), part('b', ['a'])],
        'main',
        (started, context) => {
          const { id } = started.manifest;
          context.registrations.track({
            dispose: () => {
              log.push(`regs ${id}`);
              if (id === 'a') {
                throw new Error('a regs failed');
              }
            },
          });
          return {
            dispose: () => {
              if (id === 'b') {
                throw new Error('b dispose failed');
              }
              log.push(`dispose ${id}`);
            },
          };
        },
      );

      await expect(run(host)).rejects.toThrow('b dispose failed');

      expect(log).toEqual(['regs b', 'dispose a', 'regs a']);
      expect(host.started.size).toBe(0);
    },
  );

  it.each([
    {
      name: 'stop then stop',
      first: (host: PluginHost<unknown>) => host.stop('a'),
      second: (host: PluginHost<unknown>) => host.stop('a'),
    },
    {
      name: 'stop then stopAll',
      first: (host: PluginHost<unknown>) => host.stop('a'),
      second: (host: PluginHost<unknown>) => host.stopAll(),
    },
    {
      name: 'stopAll then stop',
      first: (host: PluginHost<unknown>) => host.stopAll(),
      second: (host: PluginHost<unknown>) => host.stop('a'),
    },
  ])(
    '$name: the second waits on the stop in flight and shares its error, and the part stops once',
    async ({ first, second }) => {
      const regsDispose = vi.fn();
      let failDispose = (_error: Error) => {};
      const dispose = vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            failDispose = reject;
          }),
      );
      const host = startPlugins([part('a')], 'main', (_started, context) => {
        context.registrations.track({ dispose: regsDispose });
        return { dispose };
      });

      const firstStop = first(host);
      const secondStop = second(host);
      const settled: string[] = [];
      void secondStop.catch(() => settled.push('second'));
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toEqual([]);
      expect(host.stopping()).toEqual(['a']);

      failDispose(new Error('a dispose failed'));

      await expect(firstStop).rejects.toThrow('a dispose failed');
      await expect(secondStop).rejects.toThrow('a dispose failed');
      expect(host.stopping()).toEqual([]);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(regsDispose).toHaveBeenCalledTimes(1);
      expect(host.started.size).toBe(0);
    },
  );

  it('stopAll stops every part in reverse start order, logging each', async () => {
    const log: string[] = [];
    const logged: string[] = [];
    const parts = [part('a'), part('b', ['a']), part('c')];
    const host = startPlugins(
      parts,
      'main',
      (started, context) => {
        const { id } = started.manifest;
        context.registrations.track({ dispose: () => log.push(`regs ${id}`) });
        return {
          dispose: async () => {
            await Promise.resolve();
            log.push(`dispose ${id}`);
          },
        };
      },
      undefined,
      undefined,
      (source, message) => logged.push(`${source}: ${message}`),
    );

    await host.stopAll();

    expect(log).toEqual([
      'dispose c',
      'regs c',
      'dispose b',
      'regs b',
      'dispose a',
      'regs a',
    ]);
    expect(logged).toEqual([
      'plugin-host: stopping c',
      'plugin-host: stopping b',
      'plugin-host: stopping a',
    ]);
    expect(host.started.size).toBe(0);
  });

  it("disposes a failed start's registrations and throws its error", () => {
    let disposeCount = 0;

    expect(() =>
      startPlugins([part('a'), part('b')], 'main', (started, context) => {
        if (started.manifest.id === 'b') {
          context.registrations.track({
            dispose: () => {
              disposeCount += 1;
            },
          });
          throw new Error('start failed');
        }
        return {};
      }),
    ).toThrow('start failed');

    expect(disposeCount).toBe(1);
  });

  it.each([
    {
      parts: [part('b', ['a']), part('a'), part('c')],
      disabled: ['a', 'b'],
      ids: ['b', 'a'],
      events: ['start a', 'start b', 'ready a', 'ready b'],
    },
    {
      parts: [part('a'), part('b')],
      disabled: ['b'],
      ids: ['a', 'b', 'zzz'],
      events: ['start b', 'ready b'],
    },
  ])(
    'start starts each named part not started, in dependency order, then calls ready on each',
    ({ parts, disabled, ids, events }) => {
      const recorded: string[] = [];
      const host = startHooked(parts, recordingHooks(recorded), disabled);
      recorded.length = 0;

      host.start(ids);

      expect(recorded).toEqual(events);
    },
  );

  it.each([
    { dependency: 'not started', disabled: ['a', 'b'], stopsA: false },
    { dependency: 'whose stop is in flight', disabled: ['b'], stopsA: true },
  ])(
    'start throws, starting nothing, when a named part depends on a part $dependency and not named',
    async ({ disabled, stopsA }) => {
      const recorded: string[] = [];
      let finishDispose = () => {};
      const host = startHooked(
        [part('a'), part('b', ['a'])],
        (id) => {
          recorded.push(`start ${id}`);
          return {
            dispose: () =>
              new Promise<void>((resolve) => {
                finishDispose = resolve;
              }),
          };
        },
        disabled,
      );
      recorded.length = 0;
      const stopping = stopsA ? host.stop('a') : Promise.resolve([]);

      expect(() => host.start(['b'])).toThrow(
        'Plugin "b" depends on plugin "a", which is not started',
      );

      expect(recorded).toEqual([]);
      expect(host.started.has('b')).toBe(false);
      finishDispose();
      await stopping;
    },
  );

  it("ready calls each started part's ready in start order, and logs a throw and goes on", () => {
    const readied: string[] = [];
    const logged: string[] = [];
    const host = startHooked(
      [part('b', ['a']), part('a'), part('c')],
      (id) => ({
        ready: () => {
          readied.push(id);
          if (id === 'b') {
            throw new Error('b ready failed');
          }
        },
      }),
      [],
      logged,
    );

    expect(() => host.ready()).not.toThrow();

    expect(readied).toEqual(['a', 'b', 'c']);
    expect(logged).toContain('plugin-host: ready of b failed: b ready failed');
  });

  it('restart stops the part and its dependents, then starts them again with new registrations and views', async () => {
    let aStarts = 0;
    const bViews: unknown[] = [];
    const bRegistrations: Registrations[] = [];
    const host = startHooked(
      [part('a'), part('b', ['a']), part('d')],
      (id, context) => {
        if (id === 'a') {
          aStarts += 1;
          const run = aStarts;
          return { exports: () => ({ run }) };
        }
        if (id === 'b') {
          bViews.push(context.dependency('a'));
          bRegistrations.push(context.registrations);
        }
        return {};
      },
    );

    await expect(host.restart('a')).resolves.toEqual(['b', 'a']);

    expect(bViews).toEqual([{ run: 1 }, { run: 2 }]);
    expect(bRegistrations[1]).not.toBe(bRegistrations[0]);
    expect([...host.started.keys()]).toEqual(['d', 'a', 'b']);
  });

  it('restart starts in parts order, not the previous start order', async () => {
    const host = startHooked(
      [part('a'), part('b', ['a']), part('c', ['a'])],
      () => ({}),
    );

    await host.restart('b');
    await host.restart('a');

    expect([...host.started.keys()]).toEqual(['a', 'b', 'c']);
  });

  // A later `start(['b'])` brings `b` back only while the host holds it.
  it.each([
    {
      name: 'restart',
      run: (host: PluginHost<unknown>) => host.restart('b'),
      heldAfter: true,
    },
    {
      name: 'remove',
      run: (host: PluginHost<unknown>) => host.remove('b'),
      heldAfter: false,
    },
  ])(
    '$name rejects and starts nothing when its stop rejects',
    async ({ run, heldAfter }) => {
      const host = startHooked([part('a'), part('b', ['a'])], (id) => ({
        dispose: () => {
          if (id === 'b') {
            throw new Error('b dispose failed');
          }
        },
      }));

      await expect(run(host)).rejects.toThrow('b dispose failed');

      expect(host.started.has('b')).toBe(false);
      host.start(['b']);
      expect(host.started.has('b')).toBe(heldAfter);
    },
  );

  it('add holds a part that a later start brings up', () => {
    const recorded: string[] = [];
    const host = startHooked([part('a')], recordingHooks(recorded));
    recorded.length = 0;

    host.add(part('c', ['a']));
    expect(recorded).toEqual([]);
    host.start(['c']);

    expect(recorded).toEqual(['start c', 'ready c']);
    expect([...host.started.keys()]).toEqual(['a', 'c']);
  });

  // Each host is `a` and `b` (on `a`), started; the cycle row adds `x`,
  // disabled, depending on `c`, with `c`'s manifest known.
  it.each([
    {
      name: 'an id the host holds',
      disabledX: false,
      run: (host: PluginHost<unknown, TestPart>) => host.add(part('a')),
      error: 'Two plugins have the id "a"',
    },
    {
      name: 'a dependency not known',
      disabledX: false,
      run: (host: PluginHost<unknown, TestPart>) =>
        host.add(part('c', ['zzz'])),
      error: 'depends on plugins not in the list: zzz',
    },
    {
      name: 'a cycle through a disabled part',
      disabledX: true,
      run: (host: PluginHost<unknown, TestPart>) => host.add(part('c', ['x'])),
      error: 'cycle',
    },
    {
      name: 'stopAll began',
      disabledX: false,
      run: (host: PluginHost<unknown, TestPart>) => {
        void host.stopAll();
        host.add(part('c'));
      },
      error: 'Plugin host is stopping',
    },
  ])('add refuses $name, changing nothing', ({ disabledX, run, error }) => {
    const log: string[] = [];
    const parts = [part('a'), part('b', ['a'])];
    if (disabledX) {
      parts.push(part('x', ['c']));
    }
    const host = startPlugins(
      parts,
      'main',
      (started, context) => {
        const { id } = started.manifest;
        context.registrations.track({ dispose: () => log.push(`regs ${id}`) });
        return {
          dispose: async () => {
            await Promise.resolve();
            log.push(`dispose ${id}`);
          },
        };
      },
      disabledX
        ? [...parts.map((each) => each.manifest), part('c').manifest]
        : undefined,
      disabledX ? ['x'] : [],
    );

    expect(() => run(host)).toThrow(error);

    expect([...host.started.keys()]).toEqual(['a', 'b']);
    expect(log).toEqual([]);
  });

  it.each([
    { remove: 'a', stopped: ['b', 'a'] },
    { remove: 'zzz', stopped: [] },
  ])(
    'remove $remove stops the part with its dependents and forgets it',
    async ({ remove, stopped }) => {
      const log: string[] = [];
      const host = startLogging([part('a'), part('b', ['a'])], log);

      await expect(host.remove(remove)).resolves.toEqual(stopped);

      // `b` is stopped but still held.
      expect([host.holds('a'), host.holds('b')]).toEqual([
        remove !== 'a',
        true,
      ]);
      if (remove === 'a') {
        host.start(['a']);
        expect(host.started.size).toBe(0);
        expect(() => host.start(['b'])).toThrow(
          'Plugin "b" depends on plugins not in the list: a',
        );
        expect(host.started.size).toBe(0);
      }
    },
  );

  it('start checks only the parts it would start', () => {
    const recorded: string[] = [];
    const b = part('b', ['p']);
    const c = part('c', ['p']);
    const p = part('p').manifest;
    let known = [b.manifest, c.manifest, p];
    const host = startPlugins(
      [b, c],
      'main',
      (started) => {
        recorded.push(started.manifest.id);
        return {};
      },
      () => known,
      ['c'],
    );
    known = [b.manifest, c.manifest];

    expect(() => host.start(['b'])).not.toThrow();
    expect(() => host.start(['c'])).toThrow(
      'Plugin "c" depends on plugins not in the list: p',
    );

    expect(recorded).toEqual(['b']);
    expect([...host.started.keys()]).toEqual(['b']);
  });

  it('known as a function is read at each check', () => {
    let known = [part('a').manifest];
    const host = startPlugins(
      [part('a')],
      'main',
      () => ({}),
      () => known,
    );

    expect(() => host.add(part('b', ['p']))).toThrow(
      'depends on plugins not in the list: p',
    );
    known = [...known, part('p').manifest];
    host.add(part('b', ['p']));
    host.start(['b']);

    expect([...host.started.keys()]).toEqual(['a', 'b']);
  });

  // `y` depends on `x` and its start number `throwingStart` throws, so `z`,
  // listed after it, never starts.
  it.each([
    {
      name: 'start',
      disabled: ['x', 'y', 'z'],
      throwingStart: 1,
      run: async (host: PluginHost<unknown>) => host.start(['x', 'y', 'z']),
    },
    {
      name: 'restart',
      disabled: [],
      throwingStart: 2,
      run: (host: PluginHost<unknown>) => host.restart('x'),
    },
  ])(
    '$name whose start throws partway readies the parts started before it and rethrows',
    async ({ disabled, throwingStart, run }) => {
      const readied: string[] = [];
      let yStarts = 0;
      const host = startHooked(
        [part('x'), part('y', ['x']), part('z', ['x'])],
        (id) => {
          if (id === 'y') {
            yStarts += 1;
            if (yStarts === throwingStart) {
              throw new Error('y start failed');
            }
          }
          return { ready: () => readied.push(id) };
        },
        disabled,
      );

      await expect(run(host)).rejects.toThrow('y start failed');

      expect([...host.started.keys()]).toEqual(['x']);
      expect(readied).toEqual(['x']);
    },
  );

  // Every part is held, disabled; `throwing` throws in its start.
  it.each([
    {
      name: 'a dependency throws and each dependent is blamed',
      parts: [part('x'), part('y', ['x']), part('z', ['x']), part('w')],
      ids: ['y', 'x', 'z', 'w'],
      failed: [
        ['x', 'x start failed'],
        ['y', 'Plugin "y" depends on plugin "x", which is not started'],
        ['z', 'Plugin "z" depends on plugin "x", which is not started'],
      ],
      started: ['w'],
    },
    {
      name: 'a dependency held later in the list throws first',
      parts: [part('a', ['x']), part('b'), part('x')],
      ids: ['a', 'b', 'x'],
      failed: [
        ['x', 'x start failed'],
        ['a', 'Plugin "a" depends on plugin "x", which is not started'],
      ],
      started: ['b'],
    },
  ])(
    'startEach starts the rest past a throw, naming the id that threw: $name',
    ({ parts, ids, failed, started }) => {
      const host = startHooked(
        parts,
        (id) => {
          if (id === 'x') {
            throw new Error('x start failed');
          }
          return {};
        },
        parts.map((each) => each.manifest.id),
      );

      const failures = host.startEach(ids);

      expect(
        failures.map(({ id, error }) => [id, (error as Error).message]),
      ).toEqual(failed);
      expect([...host.started.keys()]).toEqual(started);
    },
  );

  it('a ready that throws inside start(ids) is logged and not rethrown', () => {
    const logged: string[] = [];
    const host = startHooked(
      [part('x')],
      () => ({
        ready: () => {
          throw new Error('x ready failed');
        },
      }),
      ['x'],
      logged,
    );

    expect(() => host.start(['x'])).not.toThrow();

    expect(logged).toContain('plugin-host: ready of x failed: x ready failed');
  });

  it.each([
    { name: 'start', run: (host: PluginHost<unknown>) => host.start(['x']) },
    {
      name: 'startEach',
      run: (host: PluginHost<unknown>) => host.startEach(['x']),
    },
  ])('$name after stopAll began throws', async ({ run }) => {
    const host = startHooked([part('a'), part('x')], () => ({}), ['x']);

    const stopped = host.stopAll();

    expect(() => run(host)).toThrow('Plugin host is stopping');
    expect(host.started.has('x')).toBe(false);
    await stopped;
  });

  it.each([
    { ids: ['b', 'a'], reason: 'a: a is busy' },
    { ids: ['b', 'c'], reason: 'b: a round is open' },
    { ids: ['c', 'zzz'], reason: null },
  ])(
    'mayStop returns the first reason a named started part gives, in start order',
    ({ ids, reason }) => {
      const reasons = new Map([
        ['a', 'a is busy'],
        ['b', 'a round is open'],
      ]);
      const host = startHooked([part('a'), part('b'), part('c')], (id) => {
        const given = reasons.get(id);
        return given === undefined ? {} : { mayStop: () => given };
      });

      expect(host.mayStop(ids)).toBe(reason);
    },
  );
});
