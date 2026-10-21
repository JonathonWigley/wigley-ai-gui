import { describe, expect, it } from 'vitest';
import {
  filterPicker,
  movePicker,
  openPicker,
  visibleIndexes,
} from './list-picker-state';

const labels = ['~/dev/app', '~/dev/api', 'Choose folder…'];

describe('picker state', () => {
  it('openPicker_SelectedInRange', () => {
    expect(openPicker(labels, 1)).toEqual({ labels, filter: '', cursor: 1 });
  });

  it('openPicker_SelectedOutOfRange_First', () => {
    expect(openPicker(labels, 7).cursor).toBe(0);
  });

  it('openPicker_NoLabels_NoCursor', () => {
    expect(openPicker([], 0).cursor).toBe(-1);
  });

  it('filterPicker_CaseInsensitiveTrimmedSubstring', () => {
    const filtered = filterPicker(openPicker(labels, 1), ' AP ');

    expect(visibleIndexes(filtered)).toEqual([0, 1]);
  });

  it('filterPicker_KeepsVisibleCursor', () => {
    expect(filterPicker(openPicker(labels, 1), ' AP ').cursor).toBe(1);
  });

  it('filterPicker_MovesHiddenCursorToFirst', () => {
    const filtered = filterPicker(openPicker(labels, 1), 'choose');

    expect(visibleIndexes(filtered)).toEqual([2]);
    expect(filtered.cursor).toBe(2);
  });

  it('filterPicker_NothingVisible_NoCursor', () => {
    const filtered = filterPicker(openPicker(labels, 1), 'zzz');

    expect(visibleIndexes(filtered)).toEqual([]);
    expect(filtered.cursor).toBe(-1);
  });

  it('movePicker_StepsOverVisibleOnly', () => {
    const filtered = filterPicker(openPicker(labels, 0), 'ap');

    const once = movePicker(filtered, 1);
    const twice = movePicker(once, 1);

    expect(once.cursor).toBe(1);
    expect(twice.cursor).toBe(1);
  });

  it('movePicker_ClampsAtEnds', () => {
    const filtered = filterPicker(openPicker(labels, 0), 'ap');

    expect(movePicker(filtered, -1).cursor).toBe(0);
  });

  it('movePicker_NothingVisible_Unchanged', () => {
    const filtered = filterPicker(openPicker(labels, 0), 'zzz');

    expect(movePicker(filtered, 1)).toBe(filtered);
  });
});
