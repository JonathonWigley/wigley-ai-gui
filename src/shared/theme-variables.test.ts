import { describe, expect, it } from 'vitest';
import type { ThemeToken } from '../contracts/theme';
import { themeVariable } from './theme-variables';

describe('themeVariable', () => {
  it.each<[ThemeToken, string]>([
    ['text', '--wg-text'],
    ['bg.base', '--wg-bg-base'],
    ['editor.activeLine', '--wg-editor-activeLine'],
    ['text.onAccent', '--wg-text-onAccent'],
  ])('maps %s to %s', (token, variable) => {
    expect(themeVariable(token)).toBe(variable);
  });
});
