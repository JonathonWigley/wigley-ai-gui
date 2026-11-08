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
import { defaultKeymap, LIST_PICKER_SCOPES } from './keymap';
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
  it.each(LIST_PICKER_SCOPES)(
    'listPickerBinds_%s_BindsTheSharedSet',
    (scope) => {
      const plugin = scope.split('.')[0];
      const inScope = defaultKeymap.binds
        .filter((bind) => bind.scope === scope)
        .map((bind) => ({
          keys: bind.keys,
          where: 'where' in bind ? bind.where : undefined,
          mode: 'mode' in bind ? bind.mode : undefined,
          command: bind.command,
        }));
      const page = (keys: string, command: string) => ({
        keys,
        where: undefined,
        mode: undefined,
        command: `${plugin}.${command}`,
      });

      expect(inScope).toEqual(
        expect.arrayContaining([
          page('j', 'pickerDown'),
          page('k', 'pickerUp'),
          page('gg', 'pickerTop'),
          page('G', 'pickerBottom'),
          page('<CR>', 'pickerChoose'),
          page('l', 'pickerChoose'),
          page('/', 'pickerFilter'),
          page('<Esc>', 'pickerCancel'),
          { ...page('<CR>', 'pickerChoose'), where: 'box' },
          { ...page('<CR>', 'pickerChoose'), mode: 'insert' },
          { ...page('<Esc>', 'pickerList'), where: 'box' },
        ]),
      );
    },
  );
});
