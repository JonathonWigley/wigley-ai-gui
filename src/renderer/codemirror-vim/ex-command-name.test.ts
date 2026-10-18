import { describe, expect, it } from 'vitest';
import { exCommandName } from './ex-command-name';

describe('exCommandName', () => {
  it('spells a digit as a word', () => {
    expect(exCommandName('forms.choose1')).toBe('formschooseone');
  });

  it('spells each digit of a number', () => {
    expect(exCommandName('forms.choose10')).toBe('formschooseonezero');
  });

  it('gives commands differing only by a digit different names', () => {
    expect(exCommandName('forms.choose2')).not.toBe(
      exCommandName('forms.choose3'),
    );
  });

  it('drops punctuation and lowercases letters', () => {
    expect(exCommandName('forms.reviewJump')).toBe('formsreviewjump');
    expect(exCommandName('box-Next_item')).toBe('boxnextitem');
  });
});
