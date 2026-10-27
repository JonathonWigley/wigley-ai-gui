import { describe, expect, it } from 'vitest';
import type { NoteDraft, NoteFields, SendKind } from './contract';
import {
  emptyDraft,
  fieldsOf,
  parseDraft,
  sendRefusal,
  withFields,
  withImageAdded,
  withImageRemoved,
  withMarkup,
} from './draft';

const FULL: NoteDraft = {
  target: '/r/docs/features',
  targetPicked: true,
  title: 'Save hint',
  body: 'The hint sits low.',
  tags: ['ui', 'polish'],
  session: {
    sessionId: 'row-1',
    harness: 'claude',
    hostSessionId: 'host-1',
    projectDir: '/r',
  },
  fresh: false,
  images: [
    { id: 3, hasMarkup: true },
    { id: 5, hasMarkup: false },
  ],
  nextImageId: 6,
};

function textWith(change: Record<string, unknown>): string {
  return JSON.stringify({ ...FULL, ...change });
}

const ALL_KINDS: SendKind[] = ['followup', 'append', 'session'];

describe('emptyDraft', () => {
  it('emptyDraft_CarriesNextImageId_EverythingElseEmpty', () => {
    expect(emptyDraft(7)).toEqual({
      target: null,
      targetPicked: false,
      title: '',
      body: '',
      tags: [],
      session: null,
      fresh: true,
      images: [],
      nextImageId: 7,
    });
  });
});

describe('parseDraft', () => {
  it('parseDraft_FullDraft_RoundTrips', () => {
    expect(parseDraft(JSON.stringify(FULL))).toEqual(FULL);
  });

  it('parseDraft_NullSessionAndTarget_Parses', () => {
    const draft = { ...FULL, target: null, session: null };
    expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it('parseDraft_NullHarnessAndFolder_Parses', () => {
    const session = { ...FULL.session!, harness: null, projectDir: null };
    expect(parseDraft(textWith({ session }))?.session).toEqual(session);
  });

  it('parseDraft_ExtraFields_Dropped', () => {
    const text = JSON.stringify({
      ...FULL,
      extra: 1,
      session: { ...FULL.session, extra: 2 },
      images: [{ id: 3, hasMarkup: true, extra: 3 }],
    });
    const draft = parseDraft(text);
    expect(draft).not.toHaveProperty('extra');
    expect(draft?.session).not.toHaveProperty('extra');
    expect(draft?.images).toEqual([{ id: 3, hasMarkup: true }]);
  });

  it('parseDraft_BadJson_Null', () => {
    expect(parseDraft('{not json')).toBeNull();
    expect(parseDraft('[]')).toBeNull();
  });

  it('parseDraft_MissingField_Null', () => {
    const { title: _title, ...rest } = FULL;
    expect(parseDraft(JSON.stringify(rest))).toBeNull();
  });

  it('parseDraft_WrongType_Null', () => {
    expect(parseDraft(textWith({ fresh: 'yes' }))).toBeNull();
    expect(parseDraft(textWith({ tags: [1] }))).toBeNull();
    expect(parseDraft(textWith({ nextImageId: 6.5 }))).toBeNull();
    expect(
      parseDraft(textWith({ images: [{ id: 0, hasMarkup: false }] })),
    ).toBeNull();
  });

  it('parseDraft_ImageIdNotBelowNextImageId_Null', () => {
    expect(parseDraft(textWith({ nextImageId: 5 }))).toBeNull();
  });

  it('parseDraft_UnknownHarness_Null', () => {
    const session = { ...FULL.session, harness: 'gemini' };
    expect(parseDraft(textWith({ session }))).toBeNull();
  });
});

describe('images', () => {
  it('withImageAdded_Twice_IdsCountUp', () => {
    const first = withImageAdded(emptyDraft(4));
    const second = withImageAdded(first.draft);
    expect([first.id, second.id]).toEqual([4, 5]);
    expect(second.draft.images).toEqual([
      { id: 4, hasMarkup: false },
      { id: 5, hasMarkup: false },
    ]);
    expect(second.draft.nextImageId).toBe(6);
  });

  it('withImageRemoved_KnownId_DropsItAndGivesIt', () => {
    const { draft, image } = withImageRemoved(FULL, 3);

    expect(draft.images).toEqual([{ id: 5, hasMarkup: false }]);
    expect(image).toEqual({ id: 3, hasMarkup: true });
  });

  it('withImageRemoved_UnknownId_Throws', () => {
    expect(() => withImageRemoved(FULL, 4)).toThrow('No image 4 in the draft');
  });

  it('withMarkup_KnownId_MarksIt', () => {
    expect(withMarkup(FULL, 5).images).toEqual([
      { id: 3, hasMarkup: true },
      { id: 5, hasMarkup: true },
    ]);
  });

  it('withMarkup_UnknownId_Throws', () => {
    expect(() => withMarkup(FULL, 9)).toThrow('No image 9 in the draft');
  });
});

describe('fields', () => {
  it('withFields_ReplacesFields_KeepsImages', () => {
    const fields: NoteFields = { ...fieldsOf(emptyDraft(1)), title: 'New' };
    const draft = withFields(FULL, fields);
    expect(fieldsOf(draft)).toEqual(fields);
    expect(draft.images).toEqual(FULL.images);
    expect(draft.nextImageId).toBe(6);
  });

  it('fieldsOf_Draft_LeavesOutImages', () => {
    expect(fieldsOf(FULL)).not.toHaveProperty('images');
    expect(fieldsOf(FULL)).not.toHaveProperty('nextImageId');
  });
});

describe('sendRefusal', () => {
  it('sendRefusal_NoTarget_PickATarget', () => {
    const fields = { ...fieldsOf(FULL), target: null, title: '' };
    for (const kind of ALL_KINDS) {
      expect(sendRefusal(fields, kind)).toBe('Pick a target first');
    }
  });

  it('sendRefusal_FollowupWithBlankTitle_NeedsATitle', () => {
    const fields = { ...fieldsOf(FULL), title: '  ' };
    expect(sendRefusal(fields, 'followup')).toBe('A follow-up needs a title');
    expect(sendRefusal(fields, 'append')).toBeNull();
    expect(sendRefusal(fields, 'session')).toBeNull();
  });

  it('sendRefusal_TargetTitleEmptyBody_NullForEveryKind', () => {
    const fields = { ...fieldsOf(FULL), body: '' };
    for (const kind of ALL_KINDS) {
      expect(sendRefusal(fields, kind)).toBeNull();
    }
  });
});
