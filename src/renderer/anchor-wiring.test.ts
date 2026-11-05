import { describe, expect, it } from 'vitest';
import type { Keymap } from '../contracts/keymap';
import type { AppConfig } from '../contracts/settings';
import { wireAnchors } from './anchor-wiring';
import { createScopeStack } from './key-scope';
import { createLiveConfig } from './live-config';

const KEYMAP: Keymap = {
  editor: { leader: ' ', remaps: [], binds: [] },
  page: [],
  app: [],
  intercept: [],
  global: [],
  groups: {},
};

function configWith(keymap: Keymap): AppConfig {
  return { keymap } as AppConfig;
}

function wired() {
  const live = createLiveConfig(configWith(KEYMAP), () => undefined);
  const scopeStack = createScopeStack('any');
  const calls: string[] = [];
  wireAnchors({
    live,
    scopeStack,
    anchors: {
      redraw: () => calls.push('redraw'),
      applyVisibility: () => calls.push('applyVisibility'),
    },
  });
  return { live, scopeStack, calls };
}

describe('wireAnchors', () => {
  it.each([
    {
      row: 'a rebind',
      next: {
        ...KEYMAP,
        page: [{ keys: ['x'], scope: 'any', command: 'a.x' }],
      },
      calls: ['redraw'],
    },
    { row: 'an equal keymap', next: { ...KEYMAP }, calls: [] },
  ])('keymapChanged_JsonDiffers_Redraws: $row', ({ next, calls: expected }) => {
    const { live, calls } = wired();

    live.replace(configWith(next));

    expect(calls).toEqual(expected);
  });

  it('scopeChanged_AppliesVisibility', () => {
    const { scopeStack, calls } = wired();

    scopeStack.setBase('a.list');

    expect(calls).toEqual(['applyVisibility']);
  });
});
