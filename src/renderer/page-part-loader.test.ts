import { describe, expect, it } from 'vitest';
import type { PagePart, PluginManifest } from '../contracts/plugin';
import type { PluginOrigin, ServedPlugin } from '../contracts/plugin-catalog';
import {
  deferredPageIds,
  loadPagePart,
  pagePartIds,
  startCheckedPart,
} from './page-part-loader';

function manifest(
  id: string,
  dependsOn: { main?: string[]; page?: string[] } = {},
  commands: PluginManifest['commands'] = {},
): PluginManifest {
  return {
    id,
    label: id,
    description: 'A test plugin.',
    dependsOn: { main: dependsOn.main ?? [], page: dependsOn.page ?? [] },
    reads: { main: [], page: [] },
    commands,
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
  };
}

function served(
  id: string,
  origin: PluginOrigin,
  pageUrl: string | null = null,
  dependsOn: { main?: string[]; page?: string[] } = {},
): ServedPlugin {
  return {
    id,
    origin,
    revision: 0,
    pageUrl,
    manifest: manifest(id, dependsOn),
  };
}

function builtIn(id: string): PagePart {
  return { manifest: manifest(id), start: () => ({ commands: {} }) };
}

const USER_START = () => ({ commands: {} });

describe('loadPagePart', () => {
  // Breaks if a replaced built-in's static part leaks in, or if a missing
  // `start` slips through.
  it.each([
    {
      row: 'built-in with a page part',
      plugin: served('a', 'built-in'),
      module: null,
      part: 'static',
      imported: [],
    },
    {
      row: 'built-in without one',
      plugin: served('none', 'built-in'),
      module: null,
      part: null,
      imported: [],
    },
    {
      row: 'user with pageUrl',
      plugin: served('u', 'user', 'wigley-plugin://u/~1/page.js'),
      module: { start: USER_START },
      part: 'imported',
      imported: ['wigley-plugin://u/~1/page.js'],
    },
    {
      row: 'user with null pageUrl',
      plugin: served('u', 'user'),
      module: { start: USER_START },
      part: null,
      imported: [],
    },
    {
      row: 'replaces-built-in',
      plugin: served('a', 'replaces-built-in', 'wigley-plugin://a/~2/page.js'),
      module: { start: USER_START },
      part: 'imported',
      imported: ['wigley-plugin://a/~2/page.js'],
    },
  ])('loadPagePart_PicksThePartByOrigin: $row', async (row) => {
    const imported: string[] = [];
    const statics = [builtIn('a')];

    const part = await loadPagePart(row.plugin, {
      builtIns: statics,
      importModule: async (url) => {
        imported.push(url);
        return row.module;
      },
    });

    const expected = {
      static: statics[0],
      imported: { manifest: row.plugin.manifest, start: USER_START },
    };
    expect(part).toEqual(
      row.part === null ? null : expected[row.part as keyof typeof expected],
    );
    expect(part === statics[0]).toBe(row.part === 'static');
    expect(imported).toEqual(row.imported);
  });

  it('loadPagePart_PicksThePartByOrigin: a module without start', async () => {
    await expect(
      loadPagePart(served('u', 'user', 'wigley-plugin://u/~1/page.js'), {
        builtIns: [],
        importModule: async () => ({ begin: USER_START }),
      }),
    ).rejects.toThrow('page.js of u exports no start function');
  });
});

describe('pagePartIds', () => {
  // Breaks if a main-only plugin's binds would be stripped, or if the order
  // is served order.
  it.each([
    {
      row: 'a built-in with a page part',
      plugins: [served('a', 'built-in')],
      ids: ['a'],
    },
    {
      row: 'a built-in with none',
      plugins: [served('none', 'built-in')],
      ids: [],
    },
    {
      row: 'a user plugin with pageUrl',
      plugins: [served('u', 'user', 'wigley-plugin://u/~1/page.js')],
      ids: ['u'],
    },
    {
      row: 'a main-only user plugin with null pageUrl',
      plugins: [served('m', 'user')],
      ids: [],
    },
    {
      row: 'a dependent listed before its dependency',
      plugins: [
        served('d', 'user', 'wigley-plugin://d/~1/page.js', { page: ['a'] }),
        served('a', 'built-in'),
      ],
      ids: ['a', 'd'],
    },
  ])('pagePartIds_OnlyPluginsWithAPagePart: $row', ({ plugins, ids }) => {
    expect(pagePartIds(plugins, [builtIn('a')])).toEqual(ids);
  });
});

describe('deferredPageIds', () => {
  it.each([
    {
      row: 'only built-ins',
      plugins: [served('a', 'built-in'), served('b', 'built-in')],
      ids: [],
    },
    {
      row: 'one user id',
      plugins: [served('a', 'built-in'), served('u', 'user')],
      ids: ['u'],
    },
    {
      row: 'a built-in that depends on a replaced built-in through dependsOn.page',
      plugins: [
        served('b', 'built-in', null, { page: ['r'] }),
        served('r', 'replaces-built-in'),
      ],
      ids: ['r', 'b'],
    },
    {
      row: 'a transitive dependent',
      plugins: [
        served('c', 'built-in', null, { page: ['b'] }),
        served('b', 'built-in', null, { page: ['u'] }),
        served('u', 'user'),
      ],
      ids: ['u', 'b', 'c'],
    },
    {
      row: 'a dependent user id named before its user dependency',
      plugins: [
        served('a-tool', 'user', null, { page: ['z-base'] }),
        served('z-base', 'user'),
        served('b', 'built-in'),
      ],
      ids: ['z-base', 'a-tool'],
    },
    {
      row: 'a built-in that depends on a user id only through dependsOn.main',
      plugins: [
        served('b', 'built-in', null, { main: ['u'] }),
        served('u', 'user'),
      ],
      ids: ['u'],
    },
  ])(
    'deferredPageIds_UserIdsAndTheirPageDependents: $row',
    ({ plugins, ids }) => {
      expect(deferredPageIds(plugins)).toEqual(ids);
    },
  );
});

describe('startCheckedPart', () => {
  // Breaks if a missing user handler slips through, or if the check runs
  // after the caller could register.
  it.each([
    {
      row: 'user part with every handler',
      origin: 'user',
      commands: { hello: () => undefined },
      error: null,
    },
    {
      row: 'user part missing hello',
      origin: 'user',
      commands: {},
      error: 'u: missing hello',
    },
    {
      row: 'replaces-built-in part missing a handler',
      origin: 'replaces-built-in',
      commands: {},
      error: 'u: missing hello',
    },
    {
      row: 'built-in part missing a handler',
      origin: 'built-in',
      commands: {},
      error: null,
    },
  ] as const)(
    'startCheckedPart_ChecksHandlersOfNonBuiltIns: $row',
    ({ origin, commands, error }) => {
      const part: PagePart = {
        manifest: manifest(
          'u',
          {},
          {
            hello: { label: 'Hello', group: 'U', runsIn: 'page' },
          },
        ),
        start: () => ({ commands }),
      };
      const registered: string[] = [];
      const run = () => {
        const started = startCheckedPart(part, origin, (each) =>
          each.start({} as Parameters<PagePart['start']>[0]),
        );
        registered.push(...Object.keys(started.commands));
        return started;
      };

      if (error === null) {
        expect(run().commands).toBe(commands);
      } else {
        expect(run).toThrow(error);
      }
      expect(registered).toEqual(error === null ? Object.keys(commands) : []);
    },
  );
});
