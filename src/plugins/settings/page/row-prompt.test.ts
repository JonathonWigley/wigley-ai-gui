import { describe, expect, it } from 'vitest';
import { rowPromptActions } from './row-prompt';

const none = () => {};

describe('rowPromptActions', () => {
  it('rowPromptActions_SettingRow_EditThenReset', () => {
    expect(rowPromptActions({ open: none, edit: none, reset: none })).toEqual([
      'edit',
      'reset',
    ]);
  });

  it('rowPromptActions_KeyRow_AddRemoveReset', () => {
    expect(
      rowPromptActions({
        open: none,
        edit: none,
        addBind: none,
        removeBind: none,
        reset: none,
      }),
    ).toEqual(['addBind', 'removeBind', 'reset']);
  });

  it('rowPromptActions_NoActions_Empty', () => {
    expect(rowPromptActions({})).toEqual([]);
  });

  it('rowPromptActions_EditOnly_Edit', () => {
    expect(rowPromptActions({ open: none, edit: none })).toEqual(['edit']);
  });
});
