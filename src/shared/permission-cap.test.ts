import { describe, expect, it } from 'vitest';
import { capPermission, type PermissionRule } from './permission-cap';

const RULE: PermissionRule = {
  controlId: 'mode',
  order: ['low', 'mid', 'high'],
  launchDefault: 'high',
};

describe('capPermission', () => {
  it.each([
    {
      controls: { mode: 'high', x: '1' },
      cap: { mode: 'mid', x: '2' },
      expected: { mode: 'mid', x: '1' },
    },
    {
      controls: { mode: 'low' },
      cap: { mode: 'mid' },
      expected: { mode: 'low' },
    },
    {
      controls: { mode: 'mid' },
      cap: { mode: 'mid' },
      expected: { mode: 'mid' },
    },
    { controls: {}, cap: { mode: 'mid' }, expected: { mode: 'mid' } },
    { controls: {}, cap: {}, expected: {} },
    { controls: { mode: 'high' }, cap: {}, expected: { mode: 'high' } },
    {
      controls: { mode: 'other' },
      cap: { mode: 'high' },
      expected: { mode: 'high' },
    },
    {
      controls: { mode: 'mid' },
      cap: { mode: 'other' },
      expected: { mode: 'low' },
    },
  ])(
    'capPermission_$controls.mode_Under_$cap.mode',
    ({ controls, cap, expected }) => {
      expect(capPermission(controls, cap, RULE)).toEqual(expected);
    },
  );

  it('capPermission_LoweredValue_ReturnsACopy', () => {
    const controls = { mode: 'high', x: '1' };

    const capped = capPermission(controls, { mode: 'low' }, RULE);

    expect(capped).not.toBe(controls);
    expect(controls).toEqual({ mode: 'high', x: '1' });
  });
});
