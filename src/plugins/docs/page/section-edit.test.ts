import { describe, expect, it } from 'vitest';
import type { DocSection } from '../sections';
import {
  hiddenBlockFlags,
  relocateSection,
  sectionMoveTarget,
} from './section-edit';

describe('hiddenBlockFlags', () => {
  const section: DocSection = {
    title: 'S',
    level: 2,
    startLine: 5,
    endLine: 8,
  };

  it.each([
    {
      name: 'blocks inside the section',
      lines: [1, 3, 5, 7],
      flags: [false, true, true, false],
    },
    {
      name: 'a block with no line after a hidden one',
      lines: [3, null, 7],
      flags: [true, true, false],
    },
    {
      name: 'a first block with no line',
      lines: [null, 3],
      flags: [false, true],
    },
    {
      name: 'an outer block that starts above the section',
      lines: [1, 9],
      flags: [true, false],
    },
  ])('$name', ({ lines, flags }) => {
    expect(hiddenBlockFlags(lines, section, 3)).toEqual(flags);
  });
});

describe('relocateSection', () => {
  it.each([
    {
      name: 'the section moved down by inserted lines',
      from: '# T\n\n## A\nx\n\n## B\ny',
      startLine: 6,
      to: '# T\n\nnew\nnew\n\n## A\nx\n\n## B\ny',
      expected: { title: 'B', level: 2, startLine: 9, endLine: 10 },
    },
    {
      name: 'two sections with one title, the second asked',
      from: '## A\nx\n## A\ny',
      startLine: 3,
      to: '## A\nx\nz\n## A\ny',
      expected: { title: 'A', level: 2, startLine: 4, endLine: 5 },
    },
    {
      name: 'the heading removed',
      from: '## A\nx\n## B\ny',
      startLine: 3,
      to: '## A\nx\ny',
      expected: null,
    },
  ])('$name', ({ from, startLine, to, expected }) => {
    expect(relocateSection(from, startLine, to)).toEqual(expected);
  });
});

describe('sectionMoveTarget', () => {
  const headings = [
    { startLine: 1, top: 0 },
    { startLine: 5, top: 100 },
    { startLine: 9, top: 200 },
  ];

  it.each([
    { scrollTop: 150, direction: 1, heldLine: null, target: 9 },
    { scrollTop: 150, direction: -1, heldLine: null, target: 5 },
    { scrollTop: 100, direction: -1, heldLine: null, target: 1 },
    { scrollTop: 200, direction: 1, heldLine: null, target: null },
    { scrollTop: 0, direction: -1, heldLine: null, target: null },
    { scrollTop: 60, direction: 1, heldLine: 5, target: 9 },
    { scrollTop: 60, direction: -1, heldLine: 5, target: 1 },
  ] as const)(
    'from $scrollTop going $direction, holding $heldLine, lands on $target',
    ({ scrollTop, direction, heldLine, target }) => {
      expect(sectionMoveTarget(headings, scrollTop, direction, heldLine)).toBe(
        target,
      );
    },
  );
});
