import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../contract';
import {
  activationTarget,
  echoesAfterReply,
  fillPlan,
  liveWaits,
  type PaneSessions,
  paneOf,
  panesToClose,
  pickerRows,
  pressedFocusAction,
  restorePlan,
  savedPaneSessions,
  selectionAction,
  selectionTarget,
  shownElsewhere,
} from './pane-sessions';

const ROWS: SessionRow[] = ['1', '2', '3', '4'].map((n) => ({
  sessionId: `s${n}`,
  label: `s${n}`,
  project: 'project',
  harness: null,
  marked: false,
  markToast: null,
  projectDir: null,
  hostSessionId: `h${n}`,
  titles: { user: null, agent: null, firstMessage: null },
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

  it.each([
    {
      name: 'a pane whose session came back shows it, one whose did not waits, one saved empty closes',
      saved: new Map([
        ['p1', 'h2'],
        ['p2', 'h9'],
        ['p3', null],
      ]),
      expected: {
        kind: 'restore',
        sessions: new Map([
          ['p1', 's2'],
          ['p2', null],
          ['p3', null],
        ]),
        waiting: new Map([['p2', 'h9']]),
        closing: ['p3'],
      },
    },
    {
      name: 'panes that all wait keep the saved layout',
      saved: new Map([
        ['p1', 'h8'],
        ['p2', 'h9'],
      ]),
      expected: {
        kind: 'restore',
        sessions: new Map([
          ['p1', null],
          ['p2', null],
        ]),
        waiting: new Map([
          ['p1', 'h8'],
          ['p2', 'h9'],
        ]),
        closing: [],
      },
    },
    {
      name: 'no saved pane names a session: one pane holds the selection',
      saved: new Map([
        ['p1', null],
        ['p2', null],
      ]),
      expected: { kind: 'fallback' },
    },
    {
      name: 'nothing valid saved: one pane holds the selection',
      saved: null,
      expected: { kind: 'fallback' },
    },
  ])('restorePlan: $name', ({ saved, expected }) => {
    expect(restorePlan(saved, ROWS)).toEqual(expected);
  });

  it('restorePlan shows the first row holding a host session id', () => {
    const rows = [
      ...ROWS,
      { ...ROWS[0], sessionId: 's5', hostSessionId: 'h2' },
    ];

    const plan = restorePlan(new Map([['p1', 'h2']]), rows);

    expect(plan).toMatchObject({ sessions: new Map([['p1', 's2']]) });
  });

  it.each([
    {
      name: 'a waiting pane loads its session when it arrives',
      waiting: new Map([
        ['p3', 'h4'],
        ['p4', 'h9'],
      ]),
      expected: { ended: ['p3'], loads: [['p3', 's4']] },
    },
    {
      name: 'a session another pane shows ends the wait and loads nowhere',
      waiting: new Map([['p3', 'h2']]),
      expected: { ended: ['p3'], loads: [] },
    },
    {
      name: 'two panes waiting for one session: the first loads it',
      waiting: new Map([
        ['p3', 'h3'],
        ['p4', 'h3'],
      ]),
      expected: { ended: ['p3', 'p4'], loads: [['p3', 's3']] },
    },
    {
      name: 'no awaited session arrived',
      waiting: new Map([['p3', 'h9']]),
      expected: { ended: [], loads: [] },
    },
  ])('fillPlan: $name', ({ waiting, expected }) => {
    const panes = new Map([...PANES, ['p4', null]]);

    expect(fillPlan(waiting, ROWS, panes)).toEqual(expected);
  });

  it('liveWaits keeps only the waits of panes still open and empty', () => {
    const waiting = new Map([
      ['p1', 'h7'],
      ['p3', 'h8'],
      ['p9', 'h9'],
    ]);

    expect(liveWaits(waiting, PANES)).toEqual(new Map([['p3', 'h8']]));
  });

  it.each([
    {
      name: 'a waiting pane saves the host session it waits for',
      waiting: new Map([['p3', 'h9']]),
      expected: { p1: 'h1', p2: 'h2', p3: 'h9' },
    },
    {
      name: 'an empty pane that waits for nothing saves null',
      waiting: new Map<string, string>(),
      expected: { p1: 'h1', p2: 'h2', p3: null },
    },
  ])('savedPaneSessions: $name', ({ waiting, expected }) => {
    expect(savedPaneSessions(PANES, waiting, ROWS)).toEqual(expected);
  });

  it.each([
    {
      name: 'a pane showing the session takes focus, waits or not',
      panes: PANES,
      focused: 'p3',
      waiting: ['p3'],
      sessionId: 's2',
      expected: { kind: 'focus', paneId: 'p2' },
    },
    {
      name: 'a focused pane that waits for nothing loads it',
      panes: PANES,
      focused: 'p3',
      waiting: [],
      sessionId: 's4',
      expected: { kind: 'load', paneId: 'p3' },
    },
    {
      name: 'a focused waiting pane is passed over for the first pane that does not wait',
      panes: new Map([
        ['p1', null],
        ['p2', 's2'],
        ['p3', null],
      ]),
      focused: 'p3',
      waiting: ['p1', 'p3'],
      sessionId: 's4',
      expected: { kind: 'load', paneId: 'p2' },
    },
    {
      name: 'a focused pane that waits for nothing loads it while another pane waits',
      panes: new Map([
        ['p1', null],
        ['p2', 's2'],
      ]),
      focused: 'p2',
      waiting: ['p1'],
      sessionId: 's4',
      expected: { kind: 'load', paneId: 'p2' },
    },
    {
      name: 'every pane waits: the focused pane loads it and its wait ends',
      panes: new Map([
        ['p1', null],
        ['p2', null],
      ]),
      focused: 'p2',
      waiting: ['p1', 'p2'],
      sessionId: 's4',
      expected: { kind: 'loadEndingWait', paneId: 'p2' },
    },
  ])(
    'selectionTarget: $name',
    ({ panes, focused, waiting, sessionId, expected }) => {
      const waits = new Map(waiting.map((paneId) => [paneId, `h-${paneId}`]));

      expect(selectionTarget(panes, focused, sessionId, waits)).toEqual(
        expected,
      );
    },
  );

  const echoes = (...sessionIds: string[]) =>
    sessionIds.map((sessionId) => ({ sessionId }));

  it.each([
    {
      name: "activate(s2) then activate(s3): main's s2 state keeps the panes",
      change: { before: 's1', next: 's2', removed: [], wasSplit: true },
      pending: echoes('s2', 's3'),
      action: { kind: 'keep' },
      left: echoes('s3'),
    },
    {
      name: 'an echo main never answered is dropped with the answered one',
      change: { before: 's1', next: 's3', removed: [], wasSplit: true },
      pending: echoes('s4', 's3', 's2'),
      action: { kind: 'keep' },
      left: echoes('s2'),
    },
    {
      name: "s1's row closes in a split and main selects s3: main hears the focused session",
      change: { before: 's1', next: 's3', removed: ['s1'], wasSplit: true },
      pending: [],
      action: { kind: 'tellFocused' },
      left: [],
    },
    {
      name: "s1's row closes in one pane and main selects s2: the pane shows s2",
      change: { before: 's1', next: 's2', removed: ['s1'], wasSplit: false },
      pending: [],
      action: { kind: 'place', sessionId: 's2' },
      left: [],
    },
    {
      name: "main's own selection is placed, the echoes kept",
      change: { before: 's1', next: 's4', removed: ['s2'], wasSplit: true },
      pending: echoes('s3'),
      action: { kind: 'place', sessionId: 's4' },
      left: echoes('s3'),
    },
    {
      name: 'an unchanged selection keeps the panes',
      change: { before: 's1', next: 's1', removed: [], wasSplit: true },
      pending: echoes('s3'),
      action: { kind: 'keep' },
      left: echoes('s3'),
    },
    {
      name: 'no selection keeps the panes',
      change: { before: 's1', next: null, removed: ['s1'], wasSplit: false },
      pending: [],
      action: { kind: 'keep' },
      left: [],
    },
  ])('selectionAction: $name', ({ change, pending, action, left }) => {
    expect(selectionAction({ ...change, pendingEchoes: pending })).toEqual({
      action,
      echoes: left,
    });
  });

  const held = { sessionId: 's2' };
  const later = { sessionId: 's3' };

  it.each([
    {
      name: 'a reply ahead of its state keeps the echo',
      echo: held,
      sentState: true,
      left: [held, later],
    },
    {
      name: 'a reply saying main sent none drops that echo alone',
      echo: held,
      sentState: false,
      left: [later],
    },
    {
      name: 'an activation that recorded no echo drops none',
      echo: null,
      sentState: false,
      left: [held, later],
    },
  ])('echoesAfterReply: $name', ({ echo, sentState, left }) => {
    expect(echoesAfterReply([held, later], echo, sentState)).toEqual(left);
  });

  const noFacts = {
    hasSelectionInPane: false,
    isFocusInPane: false,
    doesFocusTakeText: false,
    isChatTabShown: false,
  };

  it.each([
    {
      name: 'a text box the press focused on a Form, Primer or Docs tab',
      facts: { isFocusInPane: true, doesFocusTakeText: true },
      action: 'keep',
    },
    {
      name: 'the Chat box the press focused enters insert mode',
      facts: {
        isFocusInPane: true,
        doesFocusTakeText: true,
        isChatTabShown: true,
      },
      action: 'toBox',
    },
    {
      name: 'a non-text element in the pane lets go',
      facts: { isFocusInPane: true },
      action: 'toBox',
    },
    {
      name: 'nothing focused falls to the box',
      facts: { isChatTabShown: true },
      action: 'toBox',
    },
    {
      name: "the other pane's text box lets go",
      facts: { doesFocusTakeText: true },
      action: 'toBox',
    },
    {
      name: "the other pane's Chat box lets go",
      facts: { doesFocusTakeText: true, isChatTabShown: true },
      action: 'toBox',
    },
    {
      name: 'a selection in the Chat box stays, in its mode',
      facts: {
        hasSelectionInPane: true,
        isFocusInPane: true,
        doesFocusTakeText: true,
        isChatTabShown: true,
      },
      action: 'keep',
    },
    {
      name: 'a selection in a text box on another tab stays',
      facts: {
        hasSelectionInPane: true,
        isFocusInPane: true,
        doesFocusTakeText: true,
      },
      action: 'keep',
    },
    {
      name: 'a selection in the transcript stays with nothing focused',
      facts: { hasSelectionInPane: true, isChatTabShown: true },
      action: 'keep',
    },
  ])('pressedFocusAction: $name', ({ facts, action }) => {
    expect(pressedFocusAction({ ...noFacts, ...facts })).toBe(action);
  });
});
