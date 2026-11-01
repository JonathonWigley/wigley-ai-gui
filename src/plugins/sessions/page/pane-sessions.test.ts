import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../contract';
import {
  activationTarget,
  type PaneSessions,
  paneOf,
  panesToClose,
  pickerRows,
  restorePanes,
  shownElsewhere,
} from './pane-sessions';

const ROWS: SessionRow[] = ['1', '2', '3', '4'].map((n) => ({
  sessionId: `s${n}`,
  label: `s${n}`,
  harness: null,
  marked: false,
  projectDir: null,
  hostSessionId: `h${n}`,
}));

// p1 shows s1, p2 shows s2, p3 is empty.
const PANES: PaneSessions = new Map([
  ['p1', 's1'],
  ['p2', 's2'],
  ['p3', null],
]);

describe('pane-sessions', () => {
  it.each([
    { sessionId: 's2', expected: 'p2' },
    { sessionId: 's1', expected: 'p1' },
    { sessionId: 's3', expected: null },
  ])('paneOf $sessionId gives $expected', ({ sessionId, expected }) => {
    expect(paneOf(PANES, sessionId)).toBe(expected);
  });

  it.each([
    {
      focused: 'p1',
      sessionId: 's2',
      expected: { kind: 'focus', paneId: 'p2' },
    },
    {
      focused: 'p1',
      sessionId: 's1',
      expected: { kind: 'focus', paneId: 'p1' },
    },
    {
      focused: 'p1',
      sessionId: 's3',
      expected: { kind: 'load', paneId: 'p1' },
    },
    {
      focused: 'p3',
      sessionId: 's4',
      expected: { kind: 'load', paneId: 'p3' },
    },
  ])(
    'activationTarget of $sessionId with $focused focused gives $expected',
    ({ focused, sessionId, expected }) => {
      expect(activationTarget(PANES, focused, sessionId)).toEqual(expected);
    },
  );

  it.each([
    { focused: 'p1', expected: ['s2'] },
    { focused: 'p2', expected: ['s1'] },
    { focused: 'p3', expected: ['s1', 's2'] },
  ])(
    'shownElsewhere with $focused focused gives $expected',
    ({ focused, expected }) => {
      expect(shownElsewhere(PANES, focused)).toEqual(new Set(expected));
    },
  );

  it.each([
    { removed: ['s2', 's1'], expected: ['p1', 'p2'] },
    { removed: ['s2', 's4'], expected: ['p2'] },
    { removed: [], expected: [] },
  ])('panesToClose of $removed gives $expected', ({ removed, expected }) => {
    expect(panesToClose(PANES, removed)).toEqual(expected);
  });

  it.each([
    { panes: PANES, expected: ['s3', 's4'] },
    {
      panes: new Map([
        ['p1', 's3'],
        ['p2', null],
      ]),
      expected: ['s1', 's2', 's4'],
    },
  ])('pickerRows with $panes gives $expected', ({ panes, expected }) => {
    expect(pickerRows(ROWS, panes).map((row) => row.sessionId)).toEqual(
      expected,
    );
  });

  it('restorePanes maps each saved host id to its row, else to null', () => {
    const saved = new Map([
      ['p1', 'h2'],
      ['p2', 'h9'],
      ['p3', null],
    ]);

    expect(restorePanes(saved, ROWS)).toEqual(
      new Map([
        ['p1', 's2'],
        ['p2', null],
        ['p3', null],
      ]),
    );
  });
});
