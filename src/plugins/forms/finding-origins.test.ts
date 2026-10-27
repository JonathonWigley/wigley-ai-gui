import { describe, expect, it } from 'vitest';
import { actionLabel } from './finding-origins';

describe('actionLabel', () => {
  it('labels an action the origin does not offer as null', () => {
    expect(actionLabel('nit', 'follow_up')).toBeNull();
  });
});
