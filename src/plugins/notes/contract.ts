// The notes plugin's records and its channel between its main and page parts.

import type { ChannelShape } from '../../contracts/plugin';
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

// One repo's create-target home. `folder` is the clone the home sits in, null
// for a home outside its repo.
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
