// The contributions registry's contract: the sources it reads, the readers a
// feature registers, the strategies it serves in main and through its slot,
// and the pick a single-strategy feature makes among them
// (docs/features/feature-contributions/design.md § The registry).

import type { FeatureKey, JsonValue } from '../../contracts/contributions';
import type { Disposable } from '../../contracts/disposable';
import type { DependencyKey } from '../../contracts/plugin';
import type { JsonSlot, KeyedSlotKey } from '../../contracts/state';

// One agent plugin that carries `auri.json`: the app's own, or an install a
// registered profile lists.
export interface ContributionSource {
  // The plugin's name: its key up to the first `@`.
  pluginName: string;
  // `<name>@<marketplace>`, or `APP_PLUGIN_KEY` for the app's own plugin.
  pluginKey: string;
  version: string | null;
  // The plugin's root folder, as a real path.
  root: string;
  // Null for the app's own plugin.
  harnessId: string | null;
}

export type ReadResult<V> =
  | { ok: true; value: V }
  | { ok: false; reasons: string[] };

// A feature's reader of its section. `label` names the feature as Settings
// shows it. `read` is pure: it reads no file, and a path it needs it resolves
// against `source.root`, leaving the read to the feature. A reason that starts
// with `[` or `.` follows the feature key directly in the problem it serves,
// any other one follows `: `.
export interface FeatureReader<V> {
  label: string;
  read(section: unknown, source: ContributionSource): ReadResult<V>;
}

// One accepted section: `id` is the source's plugin name, `label` the
// section's non-empty string `label`, else the plugin name.
export interface Strategy<V> {
  id: string;
  label: string;
  source: ContributionSource;
  value: V;
}

// One registered feature's strategies, in source order: the app's own plugin
// first, then installs in profile order.
export interface FeatureStrategies {
  key: FeatureKey;
  label: string;
  strategies: Strategy<JsonValue>[];
}

// `registerFeature` throws `feature <key> is already registered` for a held
// key; it runs the reader over the last scan's files at once and again on
// every scan, and its dispose removes the feature's strategies and problems.
// The reader's value must be JSON, since it travels in a slot.
// `strategies` returns `[]` before `ready` and for a key no reader holds.
// `onChanged` hears a key's new strategies after each change of them, never
// on a dispose. `ready` resolves once the first scan settles, even one that
// failed.
export interface ContributionsMainExports {
  registerFeature<V>(
    key: FeatureKey,
    reader: FeatureReader<V> & JsonSlot<V>,
  ): Disposable;
  strategies<V>(key: FeatureKey): readonly Strategy<V>[];
  onChanged(
    key: FeatureKey,
    listener: (strategies: readonly Strategy<unknown>[]) => void,
  ): Disposable;
  ready: Promise<void>;
}

export const contributionsMainKey: DependencyKey<
  ContributionsMainExports,
  'main',
  'contributions'
> = { id: 'contributions', process: 'main' };

// Keyed by feature key, one value per registered feature.
export const contributionsFeaturesSlot: KeyedSlotKey<
  FeatureStrategies,
  'main',
  'contributions'
> = { id: 'contributions.features', process: 'main', kind: 'keyed' };

export type StrategyPick<V> =
  | { kind: 'picked'; strategy: Strategy<V> }
  | { kind: 'none' }
  | { kind: 'choose'; ids: string[] }
  | { kind: 'missing'; id: string };

// A single-strategy feature's pick: a setting naming an installed strategy
// picks it, and one naming none is `missing`; `''` (automatic) picks the only
// strategy, is `none` with no strategy, and `choose`, with the ids in source
// order, with two or more.
export function pickStrategy<V>(
  strategies: readonly Strategy<V>[],
  setting: string,
): StrategyPick<V> {
  if (setting !== '') {
    const named = strategies.find((strategy) => strategy.id === setting);
    return named === undefined
      ? { kind: 'missing', id: setting }
      : { kind: 'picked', strategy: named };
  }
  if (strategies.length === 0) {
    return { kind: 'none' };
  }
  if (strategies.length === 1) {
    return { kind: 'picked', strategy: strategies[0] };
  }
  return { kind: 'choose', ids: strategies.map((strategy) => strategy.id) };
}

// The empty-state text of a pick that runs nothing, null for `picked`.
export function pickProblemText(
  featureLabel: string,
  pick: StrategyPick<unknown>,
): string | null {
  switch (pick.kind) {
    case 'none':
      return `No installed plugin binds ${featureLabel}.`;
    case 'choose':
      return `Several plugins bind ${featureLabel}: pick one in Settings.`;
    case 'missing':
      return `${featureLabel} is set to ${pick.id}, which is not installed.`;
    case 'picked':
      return null;
  }
}

// The Settings control kind that picks a feature's strategy.
export function strategyControlKind(key: FeatureKey): string {
  return `strategy:${key}`;
}

// The Settings control kind of `workflow.off`: a row per declared workflow.
export const WORKFLOW_LIST_CONTROL_KIND = 'strategy-list:workflows';
