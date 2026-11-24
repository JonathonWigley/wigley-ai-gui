import { describe, expect, it } from 'vitest';
import { saveState } from '../../../shared/page/autosave';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { NoteDraft, NoteFields, NoteHome, NoteSession } from '../contract';
import { emptyDraft } from '../draft';
import {
  applyPopupAction,
  attachSession,
  detachSession,
  imageCursorAfterRemove,
  initialPopupState,
  launchFolders,
  moveField,
  openFields,
  sessionOptions,
  toggleTag,
} from './popup-state';

const GUI_CLONE = '/Users/u/Documents/ai-dev/wigley-ai-gui';
const OTHER_CLONE = '/Users/u/Documents/dev/other';

const A: NoteHome = {
  repo: 'wigley-ai-gui',
  root: `${GUI_CLONE}/docs/features`,
  folder: GUI_CLONE,
  followups: [],
};
const B: NoteHome = {
  repo: 'wigley-agents',
  root: '/Users/u/wigley-features/wigley-agents',
  folder: null,
  followups: [],
};
const HOMES = [A, B];

function row(sessionId: string, projectDir: string | null): NoteSession {
  return {
    sessionId,
    harness: 'claude',
    hostSessionId: `host-${sessionId}`,
    projectDir,
  };
}

function fields(overrides: Partial<NoteFields>): NoteFields {
  return { ...emptyDraft(1), fresh: false, ...overrides };
}

describe('moveField', () => {
  it.each([
    { field: 'title', step: 1, expected: 'body' },
    { field: 'target', step: -1, expected: 'target' },
    { field: 'session', step: 1, expected: 'session' },
  ] as const)('$field by $step is $expected', ({ field, step, expected }) => {
    expect(moveField(field, step)).toBe(expected);
  });
});

describe('imageCursorAfterRemove', () => {
  it.each([
    { case: 'a middle image', count: 3, removedIndex: 1, expected: 1 },
    { case: 'the last image', count: 2, removedIndex: 2, expected: 1 },
    { case: 'the only image', count: 0, removedIndex: 0, expected: -1 },
  ])(
    'is $expected after removing $case',
    ({ count, removedIndex, expected }) => {
      expect(imageCursorAfterRemove(count, removedIndex)).toBe(expected);
    },
  );
});

describe('openFields', () => {
  it('openFields_FreshDraft_SelectedSessionAndItsHome', () => {
    const selected = row('s1', GUI_CLONE);
    const opened = openFields(emptyDraft(1), selected, HOMES, posixPaths);
    expect(opened.session).toBe(selected);
    expect(opened.target).toBe(A.root);
    expect(opened.fresh).toBe(false);
  });

  it('openFields_FreshDraftPickedTarget_KeepsTarget', () => {
    const draft: NoteDraft = {
      ...emptyDraft(1),
      target: B.root,
      targetPicked: true,
    };
    const opened = openFields(draft, row('s1', GUI_CLONE), HOMES, posixPaths);
    expect(opened.target).toBe(B.root);
  });

  it('openFields_KeptDraft_Unchanged', () => {
    const draft: NoteDraft = { ...emptyDraft(1), fresh: false, title: 'kept' };
    const opened = openFields(draft, row('s1', GUI_CLONE), HOMES, posixPaths);
    expect(opened.session).toBeNull();
    expect(opened.title).toBe('kept');
  });
});

describe('attachSession', () => {
  it('attachSession_PickedTarget_TargetStays', () => {
    const picked = fields({ target: B.root, targetPicked: true });
    const attached = attachSession(
      picked,
      row('s1', GUI_CLONE),
      HOMES,
      posixPaths,
    );
    expect(attached.target).toBe(B.root);
  });

  it('attachSession_NullOnDefaultedTarget_TargetNull', () => {
    const defaulted = fields({ target: A.root, session: row('s1', GUI_CLONE) });
    const attached = attachSession(defaulted, null, HOMES, posixPaths);
    expect(attached.session).toBeNull();
    expect(attached.target).toBeNull();
  });

  it('attachSession_DefaultedTarget_FollowsSession', () => {
    const defaulted = fields({ target: B.root });
    const attached = attachSession(
      defaulted,
      row('s1', GUI_CLONE),
      HOMES,
      posixPaths,
    );
    expect(attached.target).toBe(A.root);
  });
});

describe('detachSession', () => {
  it('detachSession_KeepsDefaultedTarget', () => {
    const defaulted = fields({ target: A.root, session: row('s1', GUI_CLONE) });
    const detached = detachSession(defaulted);
    expect(detached.session).toBeNull();
    expect(detached.target).toBe(A.root);
  });
});

describe('toggleTag', () => {
  it.each([
    { tags: ['ui', 'bug'], tag: 'ui', expected: ['bug'] },
    { tags: ['ui'], tag: 'bug', expected: ['ui', 'bug'] },
  ])('toggles $tag in $tags', ({ tags, tag, expected }) => {
    expect(toggleTag(tags, tag)).toEqual(expected);
  });
});

describe('sessionOptions', () => {
  it('sessionOptions_Attached_LeftOut', () => {
    const first = row('s1', GUI_CLONE);
    const second = row('s2', OTHER_CLONE);
    const third = row('s3', null);
    expect(sessionOptions([first, second, third], second)).toEqual([
      first,
      third,
    ]);
  });

  it('sessionOptions_NoneAttached_EveryRow', () => {
    const rows = [row('s1', GUI_CLONE), row('s2', OTHER_CLONE)];
    expect(sessionOptions(rows, null)).toEqual(rows);
  });
});

describe('launchFolders', () => {
  it('launchFolders_AttachedFirst_NoNullsOrRepeats', () => {
    const rows = [
      row('s1', OTHER_CLONE),
      row('s2', null),
      row('s3', GUI_CLONE),
      row('s4', OTHER_CLONE),
    ];
    expect(launchFolders(row('s3', GUI_CLONE), rows)).toEqual([
      GUI_CLONE,
      OTHER_CLONE,
    ]);
  });

  it('launchFolders_NoneAttached_RowFolders', () => {
    expect(launchFolders(null, [row('s1', OTHER_CLONE)])).toEqual([
      OTHER_CLONE,
    ]);
  });
});

describe('applyPopupAction', () => {
  it('applyPopupAction_Edited_Unsaved', () => {
    const state = initialPopupState(emptyDraft(1));
    const edited = applyPopupAction(state, {
      type: 'edited',
      fields: fields({ title: 'typed' }),
    });
    expect(saveState(edited)).toBe('unsaved');
  });

  it('applyPopupAction_LoadedAfterEdit_Saved', () => {
    const edited = applyPopupAction(initialPopupState(emptyDraft(1)), {
      type: 'edited',
      fields: fields({ title: 'typed' }),
    });
    const loaded = applyPopupAction(edited, {
      type: 'loaded',
      draft: emptyDraft(3),
    });
    expect(saveState(loaded)).toBe('saved');
    expect(loaded.fields.title).toBe('');
  });

  it('applyPopupAction_LoadedFewerImages_CursorClamped', () => {
    const withImages: NoteDraft = {
      ...emptyDraft(4),
      images: [
        { id: 1, hasMarkup: false },
        { id: 2, hasMarkup: false },
        { id: 3, hasMarkup: false },
      ],
    };
    const atLast = applyPopupAction(initialPopupState(withImages), {
      type: 'imagesChanged',
      images: withImages.images,
      imageIndex: 2,
    });
    const loaded = applyPopupAction(atLast, {
      type: 'loaded',
      draft: { ...withImages, images: [{ id: 1, hasMarkup: false }] },
    });
    expect(loaded.imageIndex).toBe(0);
  });
});
