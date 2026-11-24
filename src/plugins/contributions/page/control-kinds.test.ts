import { describe, expect, it } from 'vitest';
import type { WorkflowDecl } from '../../../contracts/contributions';
import type {
  SettingLeaf,
  UserConfigRead,
} from '../../../contracts/user-config';
import type {
  SettingControlKind,
  SettingKindEditor,
  SettingKindRead,
} from '../../settings/contract';
import type { FeatureStrategies, Strategy } from '../contract';
import { strategyKind, workflowListKind } from './control-kinds';

function strategy(id: string, label: string, value: unknown): Strategy<never> {
  return {
    id,
    label,
    source: {
      pluginName: id,
      pluginKey: `${id}@market`,
      version: '1.0.0',
      root: `/plugins/${id}`,
      harnessId: 'fake',
    },
    value: value as never,
  };
}

// A declared workflow with only the fields the list reads filled.
function workflow(id: string, label: string): WorkflowDecl {
  return { id, label } as WorkflowDecl;
}

// The kind's picker; throws for a kind that edits in a box.
function pickerOf(
  kind: SettingControlKind,
): Extract<SettingKindEditor, { type: 'picker' }> {
  if (kind.edit.type !== 'picker') {
    throw new Error(`${kind.id} has no picker`);
  }
  return kind.edit;
}

const OFF_PATH = 'workflow.off';

// What a picker reads with the user layer holding `off` at `workflow.off`,
// or nothing there when `off` is null.
function readWith(off: string[] | null): SettingKindRead {
  const leaf: SettingLeaf = {
    path: OFF_PATH,
    label: 'Off',
    description: 'Workflows switched off',
    control: { kind: 'strategy-list:workflows', choices: null },
    fallback: { value: [] },
  };
  const config: UserConfigRead = {
    settings: {
      state: 'ok',
      layer: off === null ? null : { workflow: { off } },
      text: null,
    },
    keymap: { state: 'ok', layer: null, text: null },
    themes: [],
    layoutNames: {},
  };
  return { leaf, config };
}

describe('strategyKind', () => {
  const retro: FeatureStrategies = {
    key: 'retro',
    label: 'Retro',
    strategies: [strategy('wigley', 'Wigley retro', {})],
  };
  const kind = strategyKind('retro', () => retro);

  // Catches a missing pick shown as if it were installed.
  it.each([
    { value: '', text: 'Automatic' },
    { value: 'wigley', text: 'Wigley retro' },
    { value: 'gone', text: 'gone (not installed)' },
  ])('prints $value as $text', ({ value, text }) => {
    expect(kind.text(value)).toBe(text);
    expect(pickerOf(kind).label(value)).toBe(text);
  });

  it("is the feature's kind, listing automatic and each installed id", () => {
    expect(kind.id).toBe('strategy:retro');
    expect(pickerOf(kind).items(readWith(null))).toEqual(['', 'wigley']);
  });

  it('lists only automatic before the feature is in the slot', () => {
    const empty = strategyKind('backlog', () => undefined);

    expect(pickerOf(empty).items(readWith(null))).toEqual(['']);
  });
});

describe('workflowListKind', () => {
  const workflows: FeatureStrategies = {
    key: 'workflows',
    label: 'Workflows',
    strategies: [
      strategy('wigley', 'wigley', [
        workflow('large', 'Large'),
        workflow('small', 'Small'),
      ]),
    ],
  };
  const kind = workflowListKind(() => workflows);
  const picker = pickerOf(kind);

  it.each([
    { value: [], text: 'All on' },
    { value: ['wigley:large', 'wigley:small'], text: '2 off' },
  ])('prints $value as $text', ({ value, text }) => {
    expect(kind.text(value)).toBe(text);
  });

  // Catches a pick that replaces the list instead of toggling one row.
  it('toggles each row in the whole next off list', () => {
    const items = picker.items(readWith(['wigley:large']));

    expect(items).toEqual([[], ['wigley:large', 'wigley:small']]);
    expect(items.map((item) => picker.label(item))).toEqual([
      'Large · wigley · on',
      'Small · wigley · off',
    ]);
  });

  it("reads the leaf's fallback when the user layer holds no value", () => {
    expect(picker.items(readWith(null))).toEqual([
      ['wigley:large'],
      ['wigley:small'],
    ]);
  });

  it('lists no row with no workflows feature', () => {
    const none = workflowListKind(() => undefined);

    expect(pickerOf(none).items(readWith([]))).toEqual([]);
  });
});
