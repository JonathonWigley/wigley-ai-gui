import { describe, expect, it } from 'vitest';
import type { SettingLeaf } from '../../../contracts/user-config';
import { settingRows, valueText } from './setting-rows';

function leaf(path: string, fallback: SettingLeaf['fallback']): SettingLeaf {
  return {
    path,
    label: path,
    description: `${path} description`,
    control: { kind: 'number', choices: null },
    fallback,
  };
}

describe('settingRows', () => {
  it('settingRows_UserValue_IsSet', () => {
    const section = {
      id: 'forms',
      title: 'Forms',
      leaves: [
        leaf('forms.autosaveDelayMs', { value: 500 }),
        leaf('forms.width', { value: 40 }),
      ],
    };

    const rows = settingRows(section, { forms: { autosaveDelayMs: 900 } });

    expect(rows[0]).toMatchObject({ value: 900, isSet: true });
    expect(rows[1]).toMatchObject({ value: 40, isSet: false });
  });

  it('settingRows_UnsetOptional_ValueUndefined', () => {
    const section = {
      id: 'core',
      title: 'Core',
      leaves: [leaf('fonts.ui', null)],
    };

    const [row] = settingRows(section, null);

    expect(row.value).toBeUndefined();
    expect(row.isSet).toBe(false);
  });
});

describe('valueText', () => {
  it.each<[string, unknown, string]>([
    ['undefined', undefined, 'Not set'],
    ['null', null, 'Not set'],
    ['an object with no kind', { a: 1 }, '{"a":1}'],
  ])('valueText_UnsetOrUnknownKind: %s', (_case, value, text) => {
    expect(valueText(value, undefined)).toBe(text);
  });
});
