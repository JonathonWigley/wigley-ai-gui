import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '../contracts/plugin';
import { startPlugins } from './plugin-host';

interface TestPart {
  manifest: PluginManifest;
  exports?: unknown;
}

function part(
  id: string,
  dependsOn: string[] = [],
  exports?: unknown,
): TestPart {
  return {
    manifest: {
      id,
      dependsOn,
      commands: {},
      scopes: [],
      keys: { page: [], editor: [], app: [], global: [], intercept: [] },
      settings: {},
    },
    exports,
  };
}

// Starts each part, recording its id in start order.
function startRecording(parts: TestPart[]): string[] {
  const order: string[] = [];
  startPlugins(parts, (started) => {
    order.push(started.manifest.id);
    return { exports: started.exports };
  });
  return order;
}

describe('startPlugins', () => {
  it('starts dependencies first', () => {
    const order = startRecording([part('b', ['a']), part('a'), part('c')]);

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it("hands a dependent its dependency's exports", () => {
    const aExports = { greet: 'hello' };
    let received: unknown;

    startPlugins(
      [part('b', ['a']), part('a', [], aExports)],
      (started, dependency) => {
        if (started.manifest.id === 'b') {
          received = dependency('a');
        }
        return { exports: started.exports };
      },
    );

    expect(received).toBe(aExports);
  });

  it('rejects a missing dependency', () => {
    expect(() => startRecording([part('b', ['a'])])).toThrow(/"b".*a/);
  });

  it('rejects a duplicate id', () => {
    expect(() => startRecording([part('a'), part('a')])).toThrow(/"a"/);
  });

  it('rejects a cycle', () => {
    expect(() => startRecording([part('a', ['b']), part('b', ['a'])])).toThrow(
      /cycle: a, b/,
    );
  });

  it('rejects a dependency the manifest did not declare', () => {
    expect(() =>
      startPlugins([part('c'), part('b')], (started, dependency) => {
        if (started.manifest.id === 'b') {
          dependency('c');
        }
        return {};
      }),
    ).toThrow(/"b".*"c"/);
  });
});
