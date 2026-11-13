// The notes plugin's records and its channel between its main and page parts.

import type { ChannelShape, EventShape } from '../../contracts/plugin';
import type { SlotKey } from '../../contracts/state';
import type { Harness } from '../sessions/contract';

// The session a note names. `sessionId` is the sessions plugin's row id;
// `hostSessionId` the harness's own id.
export interface NoteSession {
  sessionId: string;
  harness: Harness | null;
  hostSessionId: string;
  projectDir: string | null;
}

// `id` names `images/<id>.png` and `images/<id>.markup.json` in notes' data
// folder.
export interface NoteImage {
  id: number;
  hasMarkup: boolean;
}

// What the page edits. `target` is a features home's root. `targetPicked`:
// the user chose the target in the Target picker. `fresh`: no popup has opened
// this draft yet.
export interface NoteFields {
  target: string | null;
  targetPicked: boolean;
  title: string;
  body: string;
  tags: string[];
  session: NoteSession | null;
  fresh: boolean;
}

// The kept draft, in strip order. `nextImageId` is the id the next image
// takes.
export interface NoteDraft extends NoteFields {
  images: NoteImage[];
  nextImageId: number;
}

export interface NoteFollowup {
  path: string;
  title: string;
}

// One repo's create-target home. `folder` is the folder above its in-git
// `docs/features`: the clone, or the project folder in a clone of several
// projects; null for a home outside its repo.
export interface NoteHome {
  repo: string;
  root: string;
  folder: string | null;
  followups: NoteFollowup[];
}

// `message`: the docs index load's line, null when none.
export interface NoteHomes {
  homes: NoteHome[];
  message: string | null;
}

export type SendKind = 'followup' | 'append' | 'session';

export type FollowupRequest =
  | { type: 'create' }
  | { type: 'append'; path: string; title: string };

// `sent`: the draft was cleared, `draft` the fresh one, `toast` the line the
// page shows.
export type NoteSendResult =
  | { type: 'sent'; draft: NoteDraft; toast: string }
  | { type: 'refused'; reason: string };

// A send that landed, its draft cleared: a note filed as a follow-up, or sent to
// a new session in `projectDir`. A refused send fires none.
export interface NotesMainEvents extends EventShape {
  noteSent: { projectDir: string };
  noteFiled: { request: FollowupRequest };
}

// Every method rejects with main's own error text when its handler throws.
// Each draft-store call runs in call order (one queue), so a save invoked
// before a send or discard lands before it; an invoke made during one can
// land mid-send.
// `flattened` holds one entry per draft image, in strip order: the PNG with
// its markup drawn in, or null for an image with no markup.
export interface NotesChannel extends ChannelShape {
  invoke: {
    loadDraft(): Promise<NoteDraft>;
    saveDraft(fields: NoteFields): Promise<void>;
    image(id: number): Promise<Uint8Array>;
    addImage(png: Uint8Array): Promise<NoteDraft>;
    removeImage(id: number): Promise<NoteDraft>;
    // The image's markup JSON; null when it has none.
    markup(id: number): Promise<string | null>;
    saveMarkup(id: number, json: string): Promise<NoteDraft>;
    // Grabs the window and adds it as the draft's last image.
    capture(): Promise<NoteDraft>;
    discard(): Promise<NoteDraft>;
    homes(): Promise<NoteHomes>;
    // The tags Backlog's tag setting offers, in settings order.
    tags(): string[];
    sendToFollowup(
      request: FollowupRequest,
      flattened: readonly (Uint8Array | null)[],
    ): Promise<NoteSendResult>;
    sendToSession(
      projectDir: string,
      flattened: readonly (Uint8Array | null)[],
    ): Promise<NoteSendResult>;
  };
  messages: Record<never, never>;
}

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

// Where the user was in the note popup, so a page reload puts them back: the
// popup open, the field cursor, and the image cursor (-1 with no image). The
// fields and images themselves are main's kept draft.
export interface NotesPlace {
  isOpen: boolean;
  field: NoteField;
  imageIndex: number;
}

export const notesPlaceSlot: SlotKey<NotesPlace, 'page', 'notes'> = {
  id: 'notes.place',
  process: 'page',
  kind: 'value',
};
