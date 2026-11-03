import { describe, expect, it } from 'vitest';
import type { ChatEntry, SessionControl } from '../../../contracts/agent';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import {
  applyEntry,
  changedControls,
  controlText,
  folderName,
  isTurnUnderway,
  isWorking,
  oldestPendingPermission,
  rowActivity,
  unseenAfterRest,
  unseenAfterTurnEnd,
} from './chat-state';

function user(id: string, text: string): ChatEntry {
  return { kind: 'user', id, at: 1000, text, images: [], raw: [] };
}

function permission(id: string, answered: boolean): ChatEntry {
  return {
    kind: 'permission',
    id,
    at: 1000,
    toolName: 'Bash',
    input: {},
    answer: answered ? { allowed: true, reason: null } : null,
    raw: [],
  };
}

function control(id: string, value: string | null): SessionControl {
  return { id, label: id, choices: [], value };
}

describe('chat state', () => {
  it('applyEntry_SameIdReplacesInPlace', () => {
    const a = user('a', 'first');
    const b = user('b', 'second');
    const aAgain = user('a', 'first, edited');

    expect(applyEntry([a, b], aAgain)).toEqual({
      entries: [aAgain, b],
      added: false,
    });
  });

  it('applyEntry_NewIdAppends', () => {
    const a = user('a', 'first');
    const b = user('b', 'second');
    const c = user('c', 'third');

    expect(applyEntry([a, b], c)).toEqual({ entries: [a, b, c], added: true });
  });

  it('oldestPendingPermission_FirstUnansweredInOrder', () => {
    const entries = [
      user('u', 'hello'),
      permission('permission-1', true),
      permission('permission-2', false),
      permission('permission-3', false),
    ];

    expect(oldestPendingPermission(entries)?.id).toBe('permission-2');
  });

  it('oldestPendingPermission_NonePending_Null', () => {
    const entries = [user('u', 'hello'), permission('permission-1', true)];

    expect(oldestPendingPermission(entries)).toBeNull();
  });

  it('controlText_ChoiceLabelOrRawValue', () => {
    const effort = (value: string | null): SessionControl => ({
      id: 'effort',
      label: 'Effort',
      choices: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
      value,
    });

    expect(controlText(effort('high'))).toContain('High');
    expect(controlText(effort('max'))).toContain('max');
  });

  it('changedControls_NewOrChangedOnly', () => {
    const before = [control('mode', 'auto'), control('effort', 'medium')];
    const after = [
      control('mode', 'auto'),
      control('effort', 'high'),
      control('model', 'opus'),
    ];

    expect(changedControls(before, after)).toEqual([
      control('effort', 'high'),
      control('model', 'opus'),
    ]);
  });

  it('changedControls_NothingBefore_All', () => {
    const after = [control('mode', 'auto'), control('effort', 'high')];

    expect(changedControls([], after)).toEqual(after);
  });

  it.each([
    { running: true, activity: 'working', expected: true },
    { running: true, activity: 'waiting', expected: false },
    { running: true, activity: 'idle', expected: false },
    { running: false, activity: 'working', expected: false },
  ] as const)(
    'isWorking_RunningAndActivity_TrueOnlyWhenRunningAndWorking: running $running, $activity → $expected',
    ({ running, activity, expected }) => {
      expect(isWorking({ running, activity })).toBe(expected);
    },
  );

  it.each([
    { running: true, activity: 'working', expected: true },
    { running: true, activity: 'waiting', expected: true },
    { running: true, activity: 'idle', expected: false },
    { running: false, activity: 'working', expected: false },
    { running: false, activity: 'waiting', expected: false },
  ] as const)(
    'isTurnUnderway_RunningAndActivity_TrueWhenRunningAndNotIdle: running $running, $activity → $expected',
    ({ running, activity, expected }) => {
      expect(isTurnUnderway({ running, activity })).toBe(expected);
    },
  );

  it.each([
    { activity: 'waiting', background: 0, unseen: null, expected: 'needs you' },
    {
      activity: 'waiting',
      background: 1,
      unseen: 'error',
      expected: 'needs you',
    },
    { activity: 'working', background: 0, unseen: null, expected: 'working' },
    { activity: 'working', background: 0, unseen: 'done', expected: 'working' },
    { activity: 'idle', background: 2, unseen: null, expected: 'working' },
    { activity: 'idle', background: 0, unseen: 'done', expected: 'done' },
    { activity: 'idle', background: 0, unseen: 'error', expected: 'error' },
    { activity: 'idle', background: 0, unseen: null, expected: null },
  ] as const)(
    'rowActivity_ActivityBackgroundAndUnseen_TheRowsWord: $activity, background $background, unseen $unseen → $expected',
    ({ activity, background, unseen, expected }) => {
      expect(rowActivity({ activity, background, unseen })?.word ?? null).toBe(
        expected,
      );
    },
  );

  it.each([
    { unseen: null, focused: false, background: 0, expected: 'done' },
    { unseen: null, focused: false, background: 1, expected: null },
    { unseen: null, focused: true, background: 0, expected: null },
    { unseen: 'error', focused: false, background: 1, expected: 'error' },
    { unseen: 'error', focused: true, background: 0, expected: 'error' },
    { unseen: 'done', focused: true, background: 0, expected: null },
  ] as const)(
    'unseenAfterTurnEnd_ErrorStaysElseDoneUnlessFocusedOrBackground: $unseen, focused $focused, background $background → $expected',
    ({ unseen, focused, background, expected }) => {
      expect(unseenAfterTurnEnd(unseen, focused, background)).toBe(expected);
    },
  );

  it.each([
    { unseen: null, error: 'boom', wasActive: false, expected: 'error' },
    { unseen: null, error: null, wasActive: true, expected: 'error' },
    { unseen: 'done', error: null, wasActive: false, expected: 'done' },
    { unseen: null, error: null, wasActive: false, expected: null },
  ] as const)(
    'unseenAfterRest_ErrorOrMidTurn_Error: $unseen, error $error, active $wasActive → $expected',
    ({ unseen, error, wasActive, expected }) => {
      expect(unseenAfterRest(unseen, error, wasActive)).toBe(expected);
    },
  );

  it('folderName_LastSegmentTrailingSlashIgnored', () => {
    expect(folderName('/Users/u/dev/app/', posixPaths)).toBe('app');
  });

  it('folderName_WindowsFolder_LastSegment', () => {
    expect(folderName('C:\\_root\\dev\\wigley-ai-gui', windowsPaths)).toBe(
      'wigley-ai-gui',
    );
  });
});
