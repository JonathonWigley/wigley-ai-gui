import { describe, expect, it } from 'vitest';
import { definePlugin } from './define-plugin';

const manifest = definePlugin({
  id: 'p',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {
    go: { label: 'Go', group: 'Moves', runsIn: 'page' },
    quit: { label: 'Quit', group: 'App', runsIn: 'main' },
  },
  scopes: { view: 'In the view' },
  keys: {
    binds: [{ keys: 'g', scope: 'view', command: 'go' }],
    app: [{ accelerator: 'CommandOrControl+Q', command: 'quit' }],
  },
  settings: { delayMs: 400 },
  settingInfo: { delayMs: { label: 'Delay', description: 'The delay.' } },
  themeTokens: {},
});

describe('definePlugin', () => {
  it('an id holding an uppercase letter throws naming the id', () => {
    expect(() => definePlugin({ ...manifest, id: 'Forms' })).toThrow('"Forms"');
  });

  it('an id holding a dot throws naming the id', () => {
    expect(() => definePlugin({ ...manifest, id: 'my.plugin' })).toThrow(
      '"my.plugin"',
    );
  });
});
