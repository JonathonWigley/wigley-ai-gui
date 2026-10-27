import { describe, expect, it } from 'vitest';
import type { FollowupItem } from '../../../shared/followups/followup-file';
import { commitMessage } from './commit-message';

function item(title: string, fields: Partial<FollowupItem> = {}): FollowupItem {
  return {
    title,
    oneLine: `${title} gist`,
    tags: [],
    body: '',
    line: 1,
    endLine: 1,
    done: false,
    ...fields,
  };
}

describe('commitMessage', () => {
  it('commitMessage_AddedRemovedTagged_PartsInOrder', () => {
    const before = [item('A'), item('B')];
    const after = [item('A', { tags: ['agent-ready'], line: 7 }), item('C')];

    expect(commitMessage([{ before, after }], [])).toBe(
      'Follow-ups edited in Backlog: added C; removed B; tagged A',
    );
  });

  it('commitMessage_EveryPartAcrossFiles_AddedEditedRemovedTagged', () => {
    const changes = [
      {
        before: [item('Tag me'), item('Drop me')],
        after: [item('Tag me', { tags: ['x'] }), item('New one')],
      },
      {
        before: [item('Edit me')],
        after: [item('Edit me', { body: 'More detail.' }), item('Another')],
      },
    ];

    expect(commitMessage(changes, [])).toBe(
      'Follow-ups edited in Backlog: added New one, Another; edited Edit me; removed Drop me; tagged Tag me',
    );
  });

  it.each([
    ['oneLine', { oneLine: 'new gist' }],
    ['body', { body: 'new body' }],
    ['done', { done: true }],
    ['tags and body', { tags: ['x'], body: 'new body' }],
  ])('commitMessage_%sChanged_Edited', (_, fields) => {
    const changes = [{ before: [item('A')], after: [item('A', fields)] }];

    expect(commitMessage(changes, [])).toBe(
      'Follow-ups edited in Backlog: edited A',
    );
  });

  it('commitMessage_OnlyLinesMoved_PlainSubject', () => {
    const changes = [
      { before: [item('A')], after: [item('A', { line: 4, endLine: 6 })] },
    ];

    expect(commitMessage(changes, [])).toBe('Follow-ups edited in Backlog');
  });

  it('commitMessage_ImagesOnly_ImagesPart', () => {
    expect(commitMessage([], ['F'])).toBe(
      'Follow-ups edited in Backlog: images F',
    );
  });

  it('commitMessage_ItemsAndImages_ImagesPartLast', () => {
    const changes = [{ before: [], after: [item('A')] }];

    expect(commitMessage(changes, ['F', 'G'])).toBe(
      'Follow-ups edited in Backlog: added A; images F, G',
    );
  });

  it('commitMessage_NothingChanged_PlainSubject', () => {
    expect(commitMessage([], [])).toBe('Follow-ups edited in Backlog');
  });
});
