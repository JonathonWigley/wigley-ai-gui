import { describe, expect, it } from 'vitest';
import type { AcceleratorBind, PageBind } from '../../contracts/keymap';
import type { CommandInfo } from '../../contracts/plugin';
import type { AppConfig } from '../../contracts/settings';
import { createAppliedPlugins, withAppliedList } from './applied-plugins';

describe('withAppliedList', () => {
  const pApp: AcceleratorBind = { accelerator: 'Ctrl+P', command: 'p.go' };
  const qApp: AcceleratorBind = { accelerator: 'Ctrl+Q', command: 'q.go' };
  const pPage: PageBind = { keys: ['g'], scope: 'any', command: 'p.page' };
  const qPage: PageBind = { keys: ['h'], scope: 'any', command: 'q.page' };
  const command = (
    id: string,
    plugin: string,
    runsIn: 'main' | 'page',
  ): CommandInfo => ({ id, label: id, group: 'Test', runsIn, plugin });

  // Plugins `p` and `q`, each with one app bind, one page bind and one scope,
  // and the user's own `plugins.disabled` of `['p']`; nothing here reads the
  // rest.
  const config = {
    settings: { keySequenceTimeoutMs: 900, plugins: { disabled: ['p'] } },
    keymap: {
      editor: { leader: ' ', remaps: [], binds: [] },
      page: [pPage, qPage],
      app: [pApp, qApp],
      intercept: [],
      global: [],
      groups: {},
    },
    commands: {
      'p.go': command('p.go', 'p', 'main'),
      'q.go': command('q.go', 'q', 'main'),
      'p.page': command('p.page', 'p', 'page'),
      'q.page': command('q.page', 'q', 'page'),
    },
    scopes: [
      { id: 'p.view', title: 'In p', plugin: 'p' },
      { id: 'q.view', title: 'In q', plugin: 'q' },
    ],
  } as unknown as AppConfig;

  it.each([
    {
      case: 'NoneOff_ServesEmptyAndKeepsEverything',
      disabled: [],
      expected: {
        disabled: [],
        app: [pApp, qApp],
        page: [pPage, qPage],
        commands: ['p.go', 'q.go', 'p.page', 'q.page'],
        scopes: ['p.view', 'q.view'],
      },
    },
    {
      case: 'OneOff_DropsItsBindsCommandsAndScopes',
      disabled: ['q'],
      expected: {
        disabled: ['q'],
        app: [pApp],
        page: [pPage],
        commands: ['p.go', 'p.page'],
        scopes: ['p.view'],
      },
    },
    {
      case: 'BothOff_KeepsTheListOrderAndDropsAll',
      disabled: ['q', 'p'],
      expected: {
        disabled: ['q', 'p'],
        app: [],
        page: [],
        commands: [],
        scopes: [],
      },
    },
  ])('withAppliedList_$case', ({ disabled, expected }) => {
    const served = withAppliedList(config, disabled);

    expect({
      disabled: served.settings.plugins.disabled,
      app: served.keymap.app,
      page: served.keymap.page,
      commands: Object.keys(served.commands),
      scopes: served.scopes.map((info) => info.id),
    }).toEqual(expected);
  });
});

describe('createAppliedPlugins', () => {
  it('createAppliedPlugins_Set_KeepsItsOwnCopy', () => {
    const applied = createAppliedPlugins([]);
    const list = ['a', 'b'];

    applied.set(list);
    list.push('x');

    expect(applied.disabled()).toEqual(['a', 'b']);
  });
});
