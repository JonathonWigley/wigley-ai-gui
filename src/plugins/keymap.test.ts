import { describe, expect, it } from 'vitest';
import {
  requireUnambiguousKeymap,
  requireWellFormedChords,
} from '../shared/keymap-checks';
import {
  commandInfos,
  mergeKeymap,
  withoutPluginBinds,
} from '../shared/plugin-manifests';
import { defaultKeymap } from './keymap';
import { manifests } from './manifests';

// The shipped keymap is the subject here: a clash in it stops the app at
// start.
describe('defaultKeymap', () => {
  it('defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks', () => {
    const merged = mergeKeymap(defaultKeymap, manifests, {});

    expect(() => requireUnambiguousKeymap(merged)).not.toThrow();
    expect(() => requireWellFormedChords(merged.page)).not.toThrow();
  });

  it('defaultKeymap_WindowDisabled_DropsTheSummonBind', () => {
    const merged = mergeKeymap(defaultKeymap, manifests, {});
    const globalCommands = (keymap: typeof merged) =>
      keymap.global.map((bind) => bind.command);

    const served = withoutPluginBinds(
      merged,
      commandInfos({}, manifests),
      ['window'],
      'main',
    );

    expect(globalCommands(merged)).toContain('window.summon');
    expect(globalCommands(served)).not.toContain('window.summon');
  });

  it.each([
    { keys: '<Leader>wn', command: 'workflow-heavy.makeInNewSession' },
    { keys: '<Leader>wr', command: 'workflow-heavy.resumeMake' },
    { keys: '<Leader>wo', command: 'workflow-heavy.openPlan' },
    { keys: '<Leader>wt', command: 'workflow-heavy.retro' },
    { keys: '<Leader>wd', command: 'workflow-heavy.dismiss' },
    { keys: '<Leader>ww', command: 'workflow.mainAction' },
  ])('workflowHeavyCommands_KeepTheirChords $keys', ({ keys, command }) => {
    expect(
      defaultKeymap.binds.find((bind) => bind.keys === keys)?.command,
    ).toBe(command);
  });
});
