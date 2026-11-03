import { describe, expect, it, vi } from 'vitest';
import type { Registrations } from '../contracts/disposable';
import type { PluginManifest } from '../contracts/plugin';
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
      dependsOn: { main: dependsOn, page: otherProcess },
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

  it('stops the dependents of a part first, newest first, then the part', async () => {
    const log: string[] = [];
    const host = startLogging(
      [part('a'), part('b', ['a']), part('c', ['b']), part('d')],
      log,
    );

    await host.stop('a');

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

  it('stop of a part not started does nothing', async () => {
    const log: string[] = [];
    const host = startLogging([part('a'), part('b')], log);

    await host.stop('zzz');

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
});
