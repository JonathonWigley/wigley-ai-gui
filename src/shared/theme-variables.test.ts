import { describe, expect, it } from 'vitest';
import { themeVariable } from './theme-variables';

describe('themeVariable', () => {
  it.each([
    ['fg-secondary', '--wg-fg-secondary'],
    ['space-0_5', '--wg-space-0_5'],
    ['forms.origin-caused', '--wg-forms-origin-caused'],
  ])('maps %s to %s', (token, variable) => {
    expect(themeVariable(token)).toBe(variable);
  });
});
