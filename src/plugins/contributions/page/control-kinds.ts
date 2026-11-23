import {
  type FeatureKey,
  qualifiedWorkflowId,
  type WorkflowDecl,
} from '../../../contracts/contributions';
import { isStringArray, userValue } from '../../../shared/json';
import type {
  SettingControlKind,
  SettingKindRead,
} from '../../settings/contract';
import {
  type FeatureStrategies,
  strategyControlKind,
  WORKFLOW_LIST_CONTROL_KIND,
} from '../contract';

const AUTOMATIC_TEXT = 'Automatic';

// A single-strategy feature's pick setting: `''` is `Automatic`, an installed
// strategy's id its label, any other value `<value> (not installed)`. The
// picker lists `''` and each installed id, reading `feature` at each call.
export function strategyKind(
  key: FeatureKey,
  feature: () => FeatureStrategies | undefined,
): SettingControlKind {
  const label = (value: unknown) => {
    if (value === '') {
      return AUTOMATIC_TEXT;
    }
    const strategy = feature()?.strategies.find(({ id }) => id === value);
    return strategy === undefined
      ? `${String(value)} (not installed)`
      : strategy.label;
  };
  return {
    id: strategyControlKind(key),
    text: label,
    edit: {
      type: 'picker',
      items: () => ['', ...(feature()?.strategies.map(({ id }) => id) ?? [])],
      label,
    },
  };
}

// One declared workflow as a row of the list.
interface WorkflowRow {
  id: string;
  label: string;
  pluginName: string;
}

function workflowRows(feature: FeatureStrategies | undefined): WorkflowRow[] {
  return (feature?.strategies ?? []).flatMap((strategy) => {
    const decls = Array.isArray(strategy.value)
      ? (strategy.value as unknown as WorkflowDecl[])
      : [];
    return decls.map((decl) => ({
      id: qualifiedWorkflowId(strategy.id, decl.id),
      label: decl.label,
      pluginName: strategy.id,
    }));
  });
}

// The `off` list the row's setting holds now: the user layer's value at the
// leaf's path, else the leaf's fallback, else `[]`.
function currentOff({ leaf, config }: SettingKindRead): string[] {
  const settings = config.settings;
  const user =
    settings.state === 'ok'
      ? userValue(settings.layer, leaf.path)
      : { isSet: false, value: undefined };
  const value = user.isSet ? user.value : leaf.fallback?.value;
  return isStringArray(value) ? value : [];
}

// `workflow.off`, the qualified ids of the workflows switched off: `All on`
// for none, else `<n> off`. The picker has a row per declared workflow, in
// source then declaration order, each item the whole next `off` list with that
// row's id toggled, labelled `<label> · <plugin name> · on|off` as the row
// will be after the pick.
export function workflowListKind(
  feature: () => FeatureStrategies | undefined,
): SettingControlKind {
  const rowOf = new WeakMap<object, WorkflowRow>();
  return {
    id: WORKFLOW_LIST_CONTROL_KIND,
    text: (value) =>
      Array.isArray(value) && value.length > 0
        ? `${String(value.length)} off`
        : 'All on',
    edit: {
      type: 'picker',
      items(read) {
        const off = currentOff(read);
        return workflowRows(feature()).map((row) => {
          const next = off.includes(row.id)
            ? off.filter((id) => id !== row.id)
            : [...off, row.id];
          rowOf.set(next, row);
          return next;
        });
      },
      label(item) {
        if (!Array.isArray(item)) {
          return String(item);
        }
        const row = rowOf.get(item);
        if (row === undefined) {
          return String(item);
        }
        const state = item.includes(row.id) ? 'off' : 'on';
        return `${row.label} · ${row.pluginName} · ${state}`;
      },
    },
  };
}
