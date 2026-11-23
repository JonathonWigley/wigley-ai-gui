import { describe, expect, it } from 'vitest';
import type { FeatureKey } from '../../../contracts/contributions';
import type { Disposable } from '../../../contracts/disposable';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type SettingControlKind,
  type SettingsPageExports,
  settingsPageKey,
} from '../../settings/contract';
import {
  contributionsFeaturesSlot,
  type FeatureStrategies,
  strategyControlKind,
  WORKFLOW_LIST_CONTROL_KIND,
} from '../contract';
import { contributionsPagePart } from './start';

function feature(key: FeatureKey): FeatureStrategies {
  return { key, label: key, strategies: [] };
}

// Settings faked as a record of the control kinds added and not yet disposed.
function fakeSettings() {
  const live: string[] = [];
  const dependency = fakeDependency(
    settingsPageKey,
    () =>
      ({
        addControlKind(kind: SettingControlKind): Disposable {
          live.push(kind.id);
          return {
            dispose: () => void live.splice(live.indexOf(kind.id), 1),
          };
        },
      }) as unknown as SettingsPageExports,
  );
  return { live, dependency };
}

describe('contributionsPagePart', () => {
  it('start_Always_AddsTheWorkflowListKind', () => {
    const settings = fakeSettings();

    startPagePart(contributionsPagePart, {
      dependencies: [settings.dependency],
    });

    expect(settings.live).toEqual([WORKFLOW_LIST_CONTROL_KIND]);
  });

  it('start_FeaturesAlreadyHeld_AddsAStrategyKindForEach', async () => {
    const settings = fakeSettings();
    const harness = startPagePart(contributionsPagePart, {
      dependencies: [settings.dependency],
    });
    await harness.stop();
    const features = harness.state.publish(contributionsFeaturesSlot);
    features.set('backlog', feature('backlog'));
    features.set('retro', feature('retro'));
    settings.live.length = 0;

    await harness.restart();

    expect(settings.live).toEqual([
      WORKFLOW_LIST_CONTROL_KIND,
      strategyControlKind('backlog'),
      strategyControlKind('retro'),
    ]);
  });

  it('featureKey_HeldThenDropped_AddsThenDisposesItsKind', () => {
    const settings = fakeSettings();
    const harness = startPagePart(contributionsPagePart, {
      dependencies: [settings.dependency],
    });
    const features = harness.state.publish(contributionsFeaturesSlot);

    features.set('backlog', feature('backlog'));
    expect(settings.live).toContain(strategyControlKind('backlog'));

    features.delete('backlog');
    expect(settings.live).toEqual([WORKFLOW_LIST_CONTROL_KIND]);
  });

  it('featureKey_HeldAgain_AddsItsKindOnce', () => {
    const settings = fakeSettings();
    const harness = startPagePart(contributionsPagePart, {
      dependencies: [settings.dependency],
    });
    const features = harness.state.publish(contributionsFeaturesSlot);

    features.set('backlog', feature('backlog'));
    features.set('backlog', { ...feature('backlog'), label: 'Backlog' });

    expect(
      settings.live.filter((id) => id === strategyControlKind('backlog')),
    ).toHaveLength(1);
  });
});
