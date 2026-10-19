// Each `@ts-expect-error` below is checked by `npm run typecheck`: the line
// after it must fail to compile.
import { describe, expect, it } from 'vitest';
import type { PageStart } from '../contracts/plugin';
import { definePlugin } from './define-plugin';

const NO_KEYS = { page: [], editor: [], app: [], global: [], intercept: [] };

const manifest = definePlugin({
  id: 'p',
  dependsOn: [],
  commands: {
    go: { label: 'Go', group: 'Moves', runsIn: 'page' },
    quit: { label: 'Quit', group: 'App', runsIn: 'main' },
  },
  scopes: ['view'],
  keys: { ...NO_KEYS, page: [{ keys: ['g'], scope: 'view', command: 'go' }] },
  settings: {},
});

describe('definePlugin', () => {
  it('a missing handler is a type error', () => {
    // A page start needs a handler for every page command and no main one.
    const complete: PageStart<typeof manifest> = { commands: { go: () => {} } };
    // @ts-expect-error -- `go` runs in the page and has no handler
    const missing: PageStart<typeof manifest> = { commands: {} };

    expect(Object.keys(complete.commands)).toEqual(['go']);
    expect(missing.commands).toEqual({});
  });

  it('a key naming an undeclared command is a type error', () => {
    const defined = definePlugin({
      ...manifest,
      keys: {
        ...NO_KEYS,
        // @ts-expect-error -- `goo` is not a declared command
        page: [{ keys: ['g'], scope: 'view', command: 'goo' }],
      },
    });

    expect(defined.id).toBe('p');
  });

  it('a page bind naming an undeclared scope is a type error', () => {
    const defined = definePlugin({
      ...manifest,
      keys: {
        ...NO_KEYS,
        // @ts-expect-error -- `veiw` is not a declared scope
        page: [{ keys: ['g'], scope: 'veiw', command: 'go' }],
      },
    });

    expect(defined.id).toBe('p');
  });
});
