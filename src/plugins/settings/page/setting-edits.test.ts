import { describe, expect, it } from 'vitest';
import type { SettingLeaf } from '../../../contracts/user-config';
import { withSetting, withoutSetting } from './setting-edits';

const windowWidth: SettingLeaf = {
  path: 'window.width',
  label: 'Window width',
  description: 'Width of a new window',
  control: { kind: 'number' },
  fallback: { value: 900 },
};

describe('withSetting', () => {
  it('withSetting_CreatesNestedObjects', () => {
    expect(withSetting(null, windowWidth, 1200)).toEqual({
      window: { width: 1200 },
    });
  });

  it('withSetting_DefaultValue_RemovesKey', () => {
    const layer = { window: { width: 1200 } };

    const result = withSetting(layer, windowWidth, 900);

    expect(result).toEqual({});
    expect(layer).toEqual({ window: { width: 1200 } });
  });
});

describe('withoutSetting', () => {
  it('withoutSetting_DropsEmptiedParents', () => {
    expect(
      withoutSetting({ fonts: { ui: 'X' }, theme: 't' }, 'fonts.ui'),
    ).toEqual({ theme: 't' });
  });
});
