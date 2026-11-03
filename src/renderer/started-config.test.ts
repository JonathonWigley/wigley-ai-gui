import { describe, expect, it } from 'vitest';
import type { CommandInfo } from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import { startedPluginsConfig } from './started-config';

function command(id: string, plugin: string): CommandInfo {
  return { id, label: id, group: 'Test', runsIn: 'page', plugin };
}

const pBind = { keys: ['g'], scope: 'any', command: 'p.go' };
const qBind = { keys: ['h'], scope: 'any', command: 'q.go' };

// A config whose keymap holds one page bind of plugin `p` and one of `q`;
// nothing here reads the rest.
const config = {
  keymap: {
    editor: { leader: '<Space>', remaps: [], binds: [] },
    page: [pBind, qBind],
    app: [],
    intercept: [],
    global: [],
    groups: {},
  },
  commands: { 'p.go': command('p.go', 'p'), 'q.go': command('q.go', 'q') },
  settings: { keySequenceTimeoutMs: 900 },
} as unknown as AppConfig;

describe('startedPluginsConfig', () => {
  it.each([
    {
      case: 'UnstartedPlugin_DropsItsBinds',
      loadList: ['p'],
      expected: { ...config, keymap: { ...config.keymap, page: [qBind] } },
    },
    { case: 'NoneUnstarted_KeepsTheKeymap', loadList: [], expected: config },
  ])('startedPluginsConfig_$case', ({ loadList, expected }) => {
    expect(startedPluginsConfig(config, loadList)).toEqual(expected);
  });
});
