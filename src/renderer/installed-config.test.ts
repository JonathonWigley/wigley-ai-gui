import { describe, expect, it } from 'vitest';
import type { Keymap } from '../contracts/keymap';
import type { AppConfig } from '../contracts/settings';
import { type AppliedKeys, installedConfig } from './installed-config';

// A pushed config with one bind of each kind on `command` and one problem from
// main; nothing here reads the rest.
function pushed(command: string): AppConfig {
  const keymap: Keymap = {
    editor: {
      leader: '<Space>',
      remaps: [],
      binds: [{ keys: 'x', scope: 'any', command }],
    },
    page: [{ keys: ['x'], scope: 'any', command }],
    app: [{ accelerator: 'CommandOrControl+X', command }],
    intercept: [{ key: 'x', meta: true, command }],
    global: [{ accelerator: 'Alt+X', command }],
  };
  return {
    keymap,
    settings: { keySequenceTimeoutMs: 900, transparency: 'system' },
    problems: [{ file: 'settings.json', message: 'bad' }],
  } as unknown as AppConfig;
}

function applied(config: AppConfig): AppliedKeys {
  return {
    editor: config.keymap.editor,
    page: config.keymap.page,
    timeoutMs: 500,
  };
}

describe('installedConfig', () => {
  it('takes the editor and page keys from the applied keys and the rest of the keymap as pushed', () => {
    const next = pushed('new');
    const old = applied(pushed('old'));

    const config = installedConfig(next, old, 'clash');

    expect(config.keymap).toEqual({
      editor: old.editor,
      page: old.page,
      app: next.keymap.app,
      intercept: next.keymap.intercept,
      global: next.keymap.global,
    });
  });

  it('takes the sequence timeout from the applied keys and the other settings as pushed', () => {
    const next = pushed('new');

    const config = installedConfig(next, applied(next), 'clash');

    expect(config.settings).toEqual({
      keySequenceTimeoutMs: 500,
      transparency: 'system',
    });
  });

  it('adds a refusal after the pushed problems', () => {
    const next = pushed('new');

    const config = installedConfig(next, applied(next), 'clash');

    expect(config.problems).toEqual([
      { file: 'settings.json', message: 'bad' },
      { file: 'keymap.json', message: 'Keys not applied: clash' },
    ]);
  });

  it('keeps the pushed problems alone when the keys applied', () => {
    const next = pushed('new');

    const config = installedConfig(next, applied(next), null);

    expect(config.problems).toEqual([
      { file: 'settings.json', message: 'bad' },
    ]);
  });
});
