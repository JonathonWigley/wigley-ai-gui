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
  scopes: { view: 'In the view' },
  keys: {
    ...NO_KEYS,
    page: [{ keys: ['g'], scope: 'view', command: 'go' }],
    app: [{ accelerator: 'CommandOrControl+Q', command: 'quit' }],
  },
  settings: { delayMs: 400 },
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

  it('a page bind naming a main command is a type error', () => {
    const defined = definePlugin({
      ...manifest,
      keys: {
        ...NO_KEYS,
        // @ts-expect-error -- `quit` runs in main, not the page
        page: [{ keys: ['q'], scope: 'view', command: 'quit' }],
      },
    });

    expect(defined.id).toBe('p');
  });

  it('an app bind naming a page command is a type error', () => {
    const defined = definePlugin({
      ...manifest,
      keys: {
        ...NO_KEYS,
        // @ts-expect-error -- `go` runs in the page, not main
        app: [{ accelerator: 'CommandOrControl+G', command: 'go' }],
      },
    });

    expect(defined.id).toBe('p');
  });

  it('settings keep plain types, not their literal defaults', () => {
    // Compiles only while `delayMs` is a number rather than the literal 400.
    const changed: (typeof manifest)['settings'] = { delayMs: 5 };

    expect(changed.delayMs).toBe(5);
  });

  it('an id holding an uppercase letter throws naming the id', () => {
    expect(() => definePlugin({ ...manifest, id: 'Forms' })).toThrow(
      'Plugin id "Forms"',
    );
  });

  it('an id holding a dot throws naming the id', () => {
    expect(() => definePlugin({ ...manifest, id: 'my.plugin' })).toThrow(
      'Plugin id "my.plugin"',
    );
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
