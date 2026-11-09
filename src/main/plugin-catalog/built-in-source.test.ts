import { describe, expect, it } from 'vitest';
import type { MainPart, PluginManifest } from '../../contracts/plugin';
import { createBuiltInSource } from './built-in-source';

function manifestOf(id: string): PluginManifest {
  return {
    id,
    label: id,
    description: `The ${id} plugin.`,
    dependsOn: { main: [], page: [] },
    reads: { main: [], page: [] },
    commands: {},
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
  };
}

function partOf(manifest: PluginManifest): MainPart {
  return { manifest, start: () => ({ commands: {} }) };
}

describe('createBuiltInSource', () => {
  it('loads each manifest with its main part, in list order', async () => {
    const first = manifestOf('first');
    const second = manifestOf('second');
    const secondPart = partOf(second);
    const source = createBuiltInSource({
      manifests: [first, second],
      mainParts: [secondPart],
    });

    expect(await source.loadAll()).toEqual([
      {
        kind: 'loaded',
        entry: {
          manifest: first,
          revision: 0,
          main: null,
          pageUrl: null,
          folder: null,
        },
      },
      {
        kind: 'loaded',
        entry: {
          manifest: second,
          revision: 0,
          main: secondPart,
          pageUrl: null,
          folder: null,
        },
      },
    ]);
  });

  it('throws for a main part whose manifest is not listed', () => {
    const listed = manifestOf('listed');
    const unlisted = manifestOf('unlisted');

    expect(() =>
      createBuiltInSource({
        manifests: [listed],
        mainParts: [partOf(unlisted)],
      }),
    ).toThrow(
      'Plugin parts with no manifest in the built-in manifests list: unlisted',
    );
  });
});
