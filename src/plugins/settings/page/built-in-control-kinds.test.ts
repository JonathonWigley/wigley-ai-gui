import { describe, expect, it } from 'vitest';
import type {
  SettingLeaf,
  UserConfigRead,
} from '../../../contracts/user-config';
import type { SettingBoxValue, SettingControlKind } from '../contract';
import { BUILT_IN_CONTROL_KINDS } from './built-in-control-kinds';

function builtIn(id: string): SettingControlKind {
  const kind = BUILT_IN_CONTROL_KINDS.find((each) => each.id === id);
  if (kind === undefined) {
    throw new Error(`no built-in control kind ${id}`);
  }
  return kind;
}

function leafWith(choices: readonly string[] | null): SettingLeaf {
  return {
    path: 'p.mode',
    label: 'Mode',
    description: 'A mode',
    control: { kind: 'choice', choices },
    fallback: null,
  };
}

function configWith(themes: readonly string[]): UserConfigRead {
  return {
    settings: { state: 'ok', layer: null, text: null },
    keymap: { state: 'ok', layer: null, text: null },
    themes,
  };
}

describe('BUILT_IN_CONTROL_KINDS', () => {
  it('builtInControlKinds_Ids_AreTheSixInOrder', () => {
    expect(BUILT_IN_CONTROL_KINDS.map((kind) => kind.id)).toEqual([
      'number',
      'string',
      'boolean',
      'choice',
      'theme',
      'json',
    ]);
  });

  it.each<[string, string, SettingBoxValue]>([
    ['number', '', { type: 'unset' }],
    ['number', ' 12 ', { type: 'value', value: 12 }],
    ['number', 'x', { type: 'problem', problem: 'Enter a number' }],
    ['string', '', { type: 'unset' }],
    ['string', 'a', { type: 'value', value: 'a' }],
    ['json', '  ', { type: 'unset' }],
    ['json', '[1]', { type: 'value', value: [1] }],
    [
      'json',
      '{',
      { type: 'problem', problem: expect.stringMatching(/^Not valid JSON: /) },
    ],
  ])(
    'builtInControlKind_Parse_CommitsOrNamesTheProblem: %s %j',
    (id, text, expected) => {
      const { edit } = builtIn(id);
      if (edit.type !== 'box') {
        throw new Error(`${id} opens no box`);
      }

      expect(edit.parse(text)).toEqual(expected);
    },
  );

  it.each<[string, string, (kind: SettingControlKind) => string, string]>([
    ['json text', 'json', (kind) => kind.text(['a']), '["a"]'],
    [
      'json box text',
      'json',
      (kind) => (kind.edit.type === 'box' ? kind.edit.text({ a: 1 }) : ''),
      '{\n  "a": 1\n}',
    ],
    ['number text', 'number', (kind) => kind.text(3), '3'],
  ])('builtInControlKind_Text_PrintsTheValue: %s', (_case, id, print, text) => {
    expect(print(builtIn(id))).toBe(text);
  });

  it.each<[string, string, SettingLeaf, UserConfigRead, readonly unknown[]]>([
    ['boolean', 'boolean', leafWith(null), configWith([]), [true, false]],
    ['choice', 'choice', leafWith(['a', 'b']), configWith([]), ['a', 'b']],
    ['choice with no choices', 'choice', leafWith(null), configWith([]), []],
    ['theme', 'theme', leafWith(null), configWith(['mocha']), ['mocha']],
  ])(
    'builtInControlKind_PickerItems_ReadTheLeafAndTheConfig: %s',
    (_case, id, leaf, config, items) => {
      const { edit } = builtIn(id);
      if (edit.type !== 'picker') {
        throw new Error(`${id} opens no picker`);
      }

      expect(edit.items({ leaf, config })).toEqual(items);
    },
  );
});
