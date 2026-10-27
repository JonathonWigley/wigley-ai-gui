import type { Paths } from '../../../contracts/paths';
import {
  type DraftRevisions,
  finishSave,
  startSave,
} from '../../../shared/page/autosave';
import type {
  NoteDraft,
  NoteFields,
  NoteHome,
  NoteImage,
  NoteSession,
} from '../contract';
import { fieldsOf } from '../draft';
import { defaultTarget } from '../note-targets';

// The popup's rows, top to bottom, as the field cursor walks them.
export const NOTE_FIELDS = [
  'target',
  'title',
  'body',
  'tags',
  'images',
  'session',
] as const;

export type NoteField = (typeof NOTE_FIELDS)[number];

// The field `step` rows from `field`, clamped at the first and the last.
export function moveField(field: NoteField, step: 1 | -1): NoteField {
  const index = NOTE_FIELDS.indexOf(field) + step;
  return NOTE_FIELDS[Math.min(Math.max(index, 0), NOTE_FIELDS.length - 1)];
}

// The image cursor once the image at `removedIndex` is gone and `count`
// images are left: the same index, clamped to the new last image; -1 when no
// image is left.
export function imageCursorAfterRemove(
  count: number,
  removedIndex: number,
): number {
  return Math.min(removedIndex, count - 1);
}

// The fields a popup opening `draft` edits: a fresh draft takes `selected` as
// its session and, unless the user picked its target, the target that
// session's folder defaults to; either way it is no longer fresh.
export function openFields(
  draft: NoteDraft,
  selected: NoteSession | null,
  homes: readonly NoteHome[],
  paths: Paths,
): NoteFields {
  const fields = fieldsOf(draft);
  if (!draft.fresh) {
    return fields;
  }
  return { ...attachSession(fields, selected, homes, paths), fresh: false };
}

// `fields` naming `session`; a target the user has not picked follows the
// session's folder, null when no home matches it.
export function attachSession(
  fields: NoteFields,
  session: NoteSession | null,
  homes: readonly NoteHome[],
  paths: Paths,
): NoteFields {
  if (fields.targetPicked) {
    return { ...fields, session };
  }
  const home = defaultTarget(homes, session?.projectDir ?? null, paths);
  return { ...fields, session, target: home?.root ?? null };
}

// `fields` naming no session; the target stays as it was, defaulted or
// picked.
export function detachSession(fields: NoteFields): NoteFields {
  return { ...fields, session: null };
}

// `tags` without `tag` when it holds it, else with `tag` at the end.
export function toggleTag(tags: readonly string[], tag: string): string[] {
  return tags.includes(tag)
    ? tags.filter((held) => held !== tag)
    : [...tags, tag];
}

// The open rows the Session picker offers, in row order, the attached one
// left out.
export function sessionOptions(
  rows: readonly NoteSession[],
  attached: NoteSession | null,
): NoteSession[] {
  return rows.filter(
    (row) => attached === null || row.sessionId !== attached.sessionId,
  );
}

// The folders a launched session may start in: the attached session's first,
// then each open row's, with no null and no repeat.
export function launchFolders(
  attached: NoteSession | null,
  rows: readonly NoteSession[],
): string[] {
  const folders = [attached, ...rows].map(
    (session) => session?.projectDir ?? null,
  );
  const known = folders.filter((folder): folder is string => folder !== null);
  return [...new Set(known)];
}

// The popup's page state: the draft's fields and images as the page holds
// them, autosave's revisions, the field cursor, and the image cursor (-1 with
// no image).
export interface PopupState extends DraftRevisions {
  fields: NoteFields;
  images: readonly NoteImage[];
  field: NoteField;
  imageIndex: number;
}

// `loaded` takes a draft main holds as saved; `edited` is an edit the page
// made, to save. `imagesChanged` takes main's image list with the cursor on
// `imageIndex`.
export type PopupAction =
  | { type: 'loaded'; draft: NoteDraft }
  | { type: 'edited'; fields: NoteFields }
  | {
      type: 'imagesChanged';
      images: readonly NoteImage[];
      imageIndex: number;
    }
  | { type: 'fieldMoved'; field: NoteField }
  | { type: 'imageMoved'; step: 1 | -1 }
  | { type: 'saveStarted'; revision: number }
  | { type: 'saveFinished'; revision: number; error: string | null };

export function initialPopupState(draft: NoteDraft): PopupState {
  return {
    fields: fieldsOf(draft),
    images: draft.images,
    field: 'body',
    imageIndex: draft.images.length === 0 ? -1 : 0,
    revision: 0,
    savingRevision: null,
    savedRevision: 0,
    saveError: null,
  };
}

function clampImage(index: number, count: number): number {
  return count === 0 ? -1 : Math.min(Math.max(index, 0), count - 1);
}

export function applyPopupAction(
  state: PopupState,
  action: PopupAction,
): PopupState {
  switch (action.type) {
    case 'loaded': {
      const revision = state.revision + 1;
      return {
        ...state,
        fields: fieldsOf(action.draft),
        images: action.draft.images,
        imageIndex: clampImage(state.imageIndex, action.draft.images.length),
        revision,
        savedRevision: revision,
        savingRevision: null,
        saveError: null,
      };
    }
    case 'edited':
      return { ...state, fields: action.fields, revision: state.revision + 1 };
    case 'imagesChanged':
      return {
        ...state,
        images: action.images,
        imageIndex: clampImage(action.imageIndex, action.images.length),
      };
    case 'fieldMoved':
      return action.field === state.field
        ? state
        : { ...state, field: action.field };
    case 'imageMoved': {
      const imageIndex = clampImage(
        state.imageIndex + action.step,
        state.images.length,
      );
      return imageIndex === state.imageIndex ? state : { ...state, imageIndex };
    }
    case 'saveStarted':
      return startSave(state, action.revision);
    case 'saveFinished':
      return finishSave(state, action.revision, action.error);
  }
}
