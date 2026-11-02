import { describe, expect, it } from 'vitest';
import { typedSkill, type TypedSkill } from './typed-skill';

interface Row {
  case: string;
  text: string;
  expected: TypedSkill | null;
}

describe('typedSkill', () => {
  it.each<Row>([
    {
      case: 'skill and path',
      text: '/wigley:make /p/plan-x',
      expected: { skill: 'wigley:make', args: '/p/plan-x' },
    },
    {
      case: 'skill alone',
      text: '/wigley:feature',
      expected: { skill: 'wigley:feature', args: '' },
    },
    {
      case: 'args trimmed',
      text: '/wigley:feature   two words  ',
      expected: { skill: 'wigley:feature', args: 'two words' },
    },
    {
      case: 'newline ends the skill',
      text: '/wigley:retro\nthe run went well',
      expected: { skill: 'wigley:retro', args: 'the run went well' },
    },
    { case: 'plain text', text: 'make the plan', expected: null },
    {
      case: 'slash later in the text',
      text: 'see /wigley:make',
      expected: null,
    },
    { case: 'leading space', text: ' /wigley:make', expected: null },
    { case: 'slash alone', text: '/', expected: null },
    { case: 'slash then space', text: '/ wigley:make', expected: null },
  ])('typedSkill_$case', ({ text, expected }) => {
    expect(typedSkill(text)).toEqual(expected);
  });
});
