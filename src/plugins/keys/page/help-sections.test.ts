import { describe, expect, it } from 'vitest';
import type { Keymap } from '../../../contracts/keymap';
import type { ScopeInfo } from '../../../contracts/plugin';
import { helpSections } from './help-sections';

const LABELS: Record<string, string> = {
  'a.next': 'next',
  'a.review': 'review',
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
    groups: {},
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
        { keys: ['<S-D-k>'], scope: 'a.x', command: 'a.review' },
      ],
    });

    const sections = helpSections(map, scopes, label, 'macos');

    expect(sections.slice(0, 2)).toEqual([
      {
        title: 'In X',
        hints: [
          { keys: 'j', label: 'next' },
          { keys: '⇧⌘K', label: 'review' },
        ],
      },
      { title: 'Everywhere', hints: [{ keys: '⎋', label: 'close' }] },
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

    const sections = helpSections(map, scopes, label, 'macos');

    expect(sections.map((section) => section.title)).toEqual(['In X']);
  });

  it('helpSections_EditorRemapAndChordSections', () => {
    const map = keymap({
      editor: {
        leader: '<Space>',
        remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
        binds: [
          { keys: '<Leader>w', scope: 'any', command: 'a.save' },
          { keys: '<A-o>', scope: 'any', command: 'a.cycle' },
        ],
      },
      intercept: [{ key: 'Tab', control: true, command: 'a.cycle' }],
      global: [{ accelerator: 'Control+Alt+Command+W', command: 'a.summon' }],
    });
    const scopes: ScopeInfo[] = [
      { id: 'any', title: 'Everywhere', plugin: 'core' },
    ];

    const sections = helpSections(map, scopes, label, 'macos');

    expect(sections).toEqual([
      {
        title: expect.stringContaining('Everywhere'),
        hints: [
          { keys: 'Space w', label: 'save' },
          { keys: '⌥O', label: 'cycle tabs' },
        ],
      },
      {
        title: expect.any(String),
        hints: [{ keys: 'j k', label: expect.stringContaining('⎋') }],
      },
      {
        title: expect.any(String),
        hints: [{ keys: '⌃⇥', label: 'cycle tabs' }],
      },
      {
        title: expect.any(String),
        hints: [{ keys: '⌃⌥⌘W', label: 'summon' }],
      },
    ]);
  });

  it('helpSections_ChordSectionsOffMac_PrintWords', () => {
    const map = keymap({
      editor: {
        leader: '<Space>',
        remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
        binds: [],
      },
      app: [{ accelerator: 'CommandOrControl+Shift+K', command: 'a.review' }],
      intercept: [{ key: 'Tab', control: true, command: 'a.cycle' }],
      global: [{ accelerator: 'Control+Alt+W', command: 'a.summon' }],
    });

    const sections = helpSections(map, [], label, 'windows');

    expect(sections).toEqual([
      {
        title: expect.any(String),
        hints: [{ keys: 'j k', label: expect.stringContaining('Esc') }],
      },
      {
        title: expect.any(String),
        hints: [
          { keys: 'Ctrl+Shift+K', label: 'review' },
          { keys: 'Ctrl+Tab', label: 'cycle tabs' },
        ],
      },
      {
        title: expect.any(String),
        hints: [{ keys: 'Ctrl+Alt+W', label: 'summon' }],
      },
    ]);
  });

  it("lists each scope's editor binds after its page binds", () => {
    const map = keymap({
      page: [{ keys: ['j'], scope: 'a.view', command: 'a.next' }],
      editor: {
        leader: '<Space>',
        remaps: [],
        binds: [
          { keys: '<Leader>x', scope: 'a.view', command: 'a.save' },
          { keys: '<Leader>?', scope: 'any', command: 'a.close' },
        ],
      },
    });
    const scopes: ScopeInfo[] = [
      { id: 'a.view', title: 'In the view', plugin: 'a' },
      { id: 'any', title: 'Everywhere', plugin: 'core' },
    ];

    const titles = helpSections(map, scopes, label, 'macos').map(
      (section) => section.title,
    );

    expect(titles).toEqual([
      'In the view',
      expect.stringContaining('In the view'),
      expect.stringContaining('Everywhere'),
    ]);
  });
});
