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
import { LIST_PICKER_COMMANDS } from '../shared/list-picker-commands';
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

  // A bind straight to a `work.*` command resolves silently on a refusal; the
  // views' own commands toast it.
  it('defaultKeymap_WorkViews_BindNoWorkCommand', () => {
    const viewBinds = defaultKeymap.binds.filter(({ scope }) =>
      /^work-(inbox|board)\./.test(scope),
    );

    expect(viewBinds.length).toBeGreaterThan(0);
    expect(viewBinds.map(({ command }) => command)).not.toContainEqual(
      expect.stringMatching(/^work\./),
    );
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

  it('workflowMainAction_KeepsItsChord', () => {
    expect(
      defaultKeymap.binds.find((bind) => bind.keys === '<Leader>ww')?.command,
    ).toBe('workflow.mainAction');
  });

  // Breaks when a plugin takes the list-picker commands but its picker scope
  // is missing from LIST_PICKER_SCOPES, so its picker gets no keys.
  it.each(
    manifests
      .filter((manifest) =>
        Object.keys(LIST_PICKER_COMMANDS).every(
          (command) => command in manifest.commands,
        ),
      )
      .map((manifest) => ({ id: manifest.id, scopes: manifest.scopes })),
  )(
    'listPickerScopes_HoldThePickerScopeOfEveryPluginTakingItsCommands: $id',
    ({ id, scopes }) => {
      const pickerScope = `${id}.picker`;

      expect(Object.keys(scopes ?? {})).toContain('picker');
      expect(LIST_PICKER_SCOPES as readonly string[]).toContain(pickerScope);
    },
  );
});
