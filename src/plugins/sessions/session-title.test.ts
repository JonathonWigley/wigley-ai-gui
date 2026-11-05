import { describe, expect, it } from 'vitest';
import { editableTitle, type SessionTitles } from './contract';
import { shownTitle, titleLimit, titleProblem } from './session-title';

const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

describe('shownTitle', () => {
  it.each<{ name: string; titles: SessionTitles; expected: string | null }>([
    {
      name: 'the user title wins',
      titles: { user: 'A', agent: 'B', firstMessage: 'C' },
      expected: 'A',
    },
    {
      name: 'the agent title over the first message',
      titles: { user: null, agent: 'B', firstMessage: 'C' },
      expected: 'B',
    },
    {
      name: 'a first message past the limit is cut to max - 1 plus an ellipsis',
      titles: { ...NO_TITLES, firstMessage: 'abcdefghij'.repeat(4) + 'klmno' },
      expected: 'abcdefghij'.repeat(3) + 'abcdefghi…',
    },
    {
      name: 'a first message of exactly the limit is unchanged',
      titles: { ...NO_TITLES, firstMessage: 'abcdefghij'.repeat(4) },
      expected: 'abcdefghij'.repeat(4),
    },
    {
      name: 'a cut landing after a space drops the space',
      titles: {
        ...NO_TITLES,
        firstMessage: 'abcdefghij'.repeat(3) + 'abcdefgh ' + 'xyz'.repeat(5),
      },
      expected: 'abcdefghij'.repeat(3) + 'abcdefgh…',
    },
    {
      name: 'an emoji counts as one character in the cut',
      titles: { ...NO_TITLES, firstMessage: '😀'.repeat(45) },
      expected: '😀'.repeat(39) + '…',
    },
    { name: 'no title', titles: NO_TITLES, expected: null },
  ])('$name', ({ titles, expected }) => {
    expect(shownTitle(titles, 40)).toBe(expected);
  });
});

describe('titleLimit', () => {
  it.each<[number, number]>([
    [40, 40],
    [12.7, 12],
    [1, 2],
    [0, 2],
    [-5, 2],
  ])('%s → %s', (setting, expected) => {
    expect(titleLimit(setting)).toBe(expected);
  });
});

describe('editableTitle', () => {
  it.each<{ name: string; titles: SessionTitles; expected: string }>([
    {
      name: 'the user title wins',
      titles: { user: 'A', agent: 'B', firstMessage: 'C' },
      expected: 'A',
    },
    {
      name: 'the first message uncut',
      titles: { ...NO_TITLES, firstMessage: 'a'.repeat(60) },
      expected: 'a'.repeat(60),
    },
    { name: 'none is empty', titles: NO_TITLES, expected: '' },
  ])('$name', ({ titles, expected }) => {
    expect(editableTitle(titles)).toBe(expected);
  });
});

describe('titleProblem', () => {
  it.each<{ name: string; text: string; expected: string | null }>([
    {
      name: 'empty after normalizing',
      text: ' \n\t ',
      expected: 'The title is empty.',
    },
    {
      name: 'past the limit, an emoji counted as one',
      text: 'a'.repeat(40) + '😀',
      expected: 'The title is 41 characters; the limit is 40.',
    },
    {
      name: 'at the limit after normalizing',
      text: `  ${'a'.repeat(20)}   ${'b'.repeat(19)}  `,
      expected: null,
    },
  ])('$name', ({ text, expected }) => {
    expect(titleProblem(text, 40)).toBe(expected);
  });
});
