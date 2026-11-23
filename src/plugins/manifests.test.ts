import { describe, expect, it } from 'vitest';
import { coreDefaultSettings } from '../config/settings';
import type { MainPart } from '../contracts/plugin';
import {
  disabledDependencyProblem,
  pluginSettingInfo,
  requireNoSettingsUnderCoreNames,
} from '../shared/plugin-manifests';
import {
  builtInManifests,
  manifests,
  withoutRealHarnessPlugins,
} from './manifests';

// The shipped manifests are the subject here: a leaf setting without a
// declaration makes the settings schema throw.
describe('manifests', () => {
  it('manifests_SettingInfo_DeclaresEveryLeafSetting', () => {
    expect(() => pluginSettingInfo(manifests)).not.toThrow();
  });

  it('manifests_CoreSettingNames_HoldNoPluginSettings', () => {
    expect(() =>
      requireNoSettingsUnderCoreNames(manifests, coreDefaultSettings()),
    ).not.toThrow();
  });

  it('manifests_DefaultDisabled_BreaksNoDependency', () => {
    expect(
      disabledDependencyProblem(
        coreDefaultSettings().plugins.disabled,
        manifests,
      ),
    ).toBeNull();
  });

  it('manifests_LabelsAndDescriptions_FilledAndLabelsUnique', () => {
    const problems: string[] = [];
    const owners = new Map<string, string>();
    for (const { id, label, description } of manifests) {
      if (label.trim() === '') problems.push(`${id} has a blank label`);
      if (description.trim() === '') {
        problems.push(`${id} has a blank description`);
      }
      const other = owners.get(label);
      if (other !== undefined) {
        problems.push(`${other} and ${id} share the label "${label}"`);
      }
      owners.set(label, id);
    }

    expect(problems).toEqual([]);
  });

  it('manifests_WorkViews_DeclareTheCommandsEachOtherRuns', () => {
    const command = (plugin: string, name: string) =>
      (
        builtInManifests.find(({ id }) => id === plugin)?.commands as
          | Record<string, unknown>
          | undefined
      )?.[name];

    expect(command('work-board', 'showTicket')).toMatchObject({
      runsIn: 'page',
      arg: 'string',
    });
    expect(command('work-inbox', 'filterTicket')).toMatchObject({
      runsIn: 'page',
      arg: 'string',
    });
  });

  it('manifests_Workflow_ListsItsSettings', () => {
    const workflow = manifests.find(({ id }) => id === 'workflow');

    expect(Object.keys(workflow?.settings ?? {}).sort()).toEqual(
      ['autoStart', 'layout', 'off'].sort(),
    );
  });
});

describe('withoutRealHarnessPlugins', () => {
  const ids = (list: readonly { id: string }[]) => list.map(({ id }) => id);
  const inputIds = ids(builtInManifests);
  const parts: readonly MainPart[] = builtInManifests.map((manifest) => ({
    manifest,
    start: () => ({ commands: {} }),
  }));

  it.each([
    {
      given: 'a fake run',
      isFake: true,
      expected: inputIds.filter((id) => id !== 'claude-code'),
    },
    { given: 'a real run', isFake: false, expected: inputIds },
  ])('withoutRealHarnessPlugins_given $given', ({ isFake, expected }) => {
    const kept = withoutRealHarnessPlugins(builtInManifests, parts, isFake);

    expect(ids(kept.manifests)).toEqual(expected);
    expect(ids(kept.mainParts.map(({ manifest }) => manifest))).toEqual(
      expected,
    );
  });
});
