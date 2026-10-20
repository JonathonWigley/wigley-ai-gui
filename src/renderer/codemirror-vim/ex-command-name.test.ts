import { describe, expect, it } from 'vitest';
import { exBindName } from './ex-command-name';

describe('exBindName', () => {
  it('spells a digit as a word', () => {
    expect(exBindName(0)).toBe('wigleybindzero');
  });

  it('spells each digit of a number', () => {
    expect(exBindName(12)).toBe('wigleybindonetwo');
  });

  it('gives indexes differing only by a digit different names', () => {
    expect(exBindName(2)).not.toBe(exBindName(3));
  });

  it('gives a name of letters only', () => {
    expect(exBindName(12)).toMatch(/^[a-z]+$/);
  });
});
