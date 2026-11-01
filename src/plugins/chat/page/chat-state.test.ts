import { describe, expect, it } from 'vitest';
import type { ChatEntry, SessionControl } from '../../../contracts/agent';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import {
  applyEntry,
  changedControls,
  controlText,
  folderName,
  isWorking,
  oldestPendingPermission,
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

  it('folderName_LastSegmentTrailingSlashIgnored', () => {
    expect(folderName('/Users/u/dev/app/', posixPaths)).toBe('app');
  });

  it('folderName_WindowsFolder_LastSegment', () => {
    expect(folderName('C:\\_root\\dev\\wigley-ai-gui', windowsPaths)).toBe(
      'wigley-ai-gui',
    );
  });
});
