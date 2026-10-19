import { describe, expect, it } from 'vitest';
import type { Keymap } from '../../../contracts/keymap';
import type { ScopeInfo } from '../../../contracts/plugin';
import { helpSections } from './help-sections';

const LABELS: Record<string, string> = {
  'a.next': 'next',
  'a.close': 'close',
  'a.save': 'save',
  'a.cycle': 'cycle tabs',
  'a.summon': 'summon',
};

const label = (id: string) => LABELS[id] ?? id;

function keymap(overrides: Partial<Keymap> = {}): Keymap {
  return {
    editor: { leader: '<Space>', remaps: [], binds: [] },
    page: [],
    app: [],
    intercept: [],
    global: [],
    ...overrides,
  };
}

describe('helpSections', () => {
  it('helpSections_TitlesFromScopeInfos_InOrder', () => {
    const scopes: ScopeInfo[] = [
      { id: 'a.x', title: 'In X', plugin: 'a' },
      { id: 'any', title: 'Everywhere', plugin: 'core' },
    ];
    const map = keymap({
      page: [
        { keys: ['Escape'], scope: 'any', command: 'a.close' },
        { keys: ['j'], scope: 'a.x', command: 'a.next' },
      ],
    });

    const sections = helpSections(map, scopes, label);

    expect(sections.slice(0, 2)).toEqual([
      { title: 'In X', hints: [{ keys: 'j', label: 'next' }] },
      { title: 'Everywhere', hints: [{ keys: 'Esc', label: 'close' }] },
    ]);
  });

  it('helpSections_DropsEmptySections', () => {
    const scopes: ScopeInfo[] = [
      { id: 'a.x', title: 'In X', plugin: 'a' },
      { id: 'a.empty', title: 'In nothing', plugin: 'a' },
    ];
    const map = keymap({
      page: [{ keys: ['j'], scope: 'a.x', command: 'a.next' }],
    });

    const sections = helpSections(map, scopes, label);

    expect(sections.map((section) => section.title)).toEqual(['In X']);
  });

  it('helpSections_EditorRemapAndChordSections', () => {
    const map = keymap({
      editor: {
        leader: '<Space>',
        remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
        binds: [{ keys: '<Leader>w', command: 'a.save' }],
      },
      intercept: [{ key: 'Tab', control: true, command: 'a.cycle' }],
      global: [{ accelerator: 'Control+Alt+Command+W', command: 'a.summon' }],
    });

    const sections = helpSections(map, [], label);

    expect(sections).toEqual([
      {
        title: 'In a text box (vim normal mode)',
        hints: [{ keys: '<Space>w', label: 'save' }],
      },
      {
        title: 'Remaps in a text box',
        hints: [{ keys: 'jk', label: 'sends <Esc> in insert mode' }],
      },
      {
        title: 'App chords',
        hints: [{ keys: 'Control+Tab', label: 'cycle tabs' }],
      },
      {
        title: 'System-wide chords',
        hints: [{ keys: 'Control+Alt+Command+W', label: 'summon' }],
      },
    ]);
  });
});
