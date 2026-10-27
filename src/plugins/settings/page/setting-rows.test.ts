import { describe, expect, it } from 'vitest';
import type { SettingLeaf } from '../../../contracts/user-config';
import { parseBoxText, settingRows } from './setting-rows';

function leaf(path: string, fallback: SettingLeaf['fallback']): SettingLeaf {
  return {
    path,
    label: path,
    description: `${path} description`,
    control: { kind: 'number' },
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

describe('parseBoxText', () => {
  it('parseBoxText_Number', () => {
    const number = { kind: 'number' } as const;

    expect(parseBoxText(' 12 ', number)).toEqual({ type: 'value', value: 12 });
    expect(parseBoxText('', number)).toEqual({ type: 'unset' });
    expect(parseBoxText('1e', number)).toEqual({
      type: 'problem',
      problem: 'Enter a number',
    });
  });

  it('parseBoxText_Json', () => {
    const json = { kind: 'json' } as const;

    expect(parseBoxText('[{"a":1}]', json)).toEqual({
      type: 'value',
      value: [{ a: 1 }],
    });
    const broken = parseBoxText('[', json);
    expect(broken.type).toBe('problem');
    expect(broken.type === 'problem' && broken.problem).toEqual(
      expect.any(String),
    );
  });
});
