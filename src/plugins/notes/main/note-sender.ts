import type { ChatImage } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type {
  BacklogMainExports,
  BacklogWriteResult,
  NoteTarget,
} from '../../backlog/contract';
import type { ChatMainExports } from '../../chat/contract';
import type { FollowupRequest, NoteDraft, NoteSendResult } from '../contract';
import { sendRefusal } from '../draft';
import { sessionLine } from '../session-ref';
import type { DraftStore } from './draft-store';
import { firstSentence, followupText, launchText } from './note-text';

// `homeDir` is the real home path, its links resolved.
export interface NoteSenderDeps {
  store: DraftStore;
  backlog: Pick<BacklogMainExports, 'fileNote'>;
  chat: Pick<ChatMainExports, 'launch' | 'profileNames' | 'profileOf'>;
  launchBrief(): string;
  paths: Paths;
  homeDir: Promise<string>;
  log: Log;
}

// Sends the kept draft and clears it once the send succeeded; a refused or
// failed send keeps it. `flattened` holds one entry per draft image, in strip
// order: the PNG with its markup drawn in, or null to send the stored image.
// Each throws when `flattened` and the draft hold different image counts.
export interface NoteSender {
  toFollowup(
    request: FollowupRequest,
    flattened: readonly (Uint8Array | null)[],
  ): Promise<NoteSendResult>;
  toSession(
    projectDir: string,
    flattened: readonly (Uint8Array | null)[],
  ): Promise<NoteSendResult>;
}

function refused(reason: string): NoteSendResult {
  return { type: 'refused', reason };
}

// The bytes to send for each draft image, in strip order.
function imagesToSend(
  store: DraftStore,
  draft: NoteDraft,
  flattened: readonly (Uint8Array | null)[],
): Promise<Uint8Array[]> {
  if (flattened.length !== draft.images.length) {
    throw new Error(
      `flattened holds ${String(flattened.length)} images; the draft holds ${String(draft.images.length)}`,
    );
  }
  return Promise.all(
    draft.images.map(
      (image, index) => flattened[index] ?? store.image(image.id),
    ),
  );
}

function followupTarget(
  draft: NoteDraft,
  request: FollowupRequest,
): NoteTarget {
  return request.type === 'create'
    ? {
        type: 'create',
        title: draft.title.trim(),
        oneLine: firstSentence(draft.body),
        tags: draft.tags,
      }
    : { type: 'append', path: request.path, title: request.title };
}

// The refusal a non-applied write gives, or the toast an applied one shows.
function followupOutcome(
  result: BacklogWriteResult,
  target: NoteTarget,
): { refusal: string } | { toast: string } {
  switch (result.type) {
    case 'applied':
      return {
        toast:
          target.type === 'create'
            ? `Follow-up added: ${target.title}`
            : `Added to ${target.title}`,
      };
    case 'missing':
      return { refusal: `No follow-up named ${result.title}` };
    case 'titleTaken':
      return { refusal: `A follow-up named ${result.title} already exists` };
    case 'refused':
      return { refusal: result.reason };
    case 'changed':
      return { refusal: `${target.title} changed on disk; send again` };
  }
}

function asPng(bytes: Uint8Array): ChatImage {
  return {
    mediaType: 'image/png',
    data: Buffer.from(bytes).toString('base64'),
  };
}

export function createNoteSender(deps: NoteSenderDeps): NoteSender {
  const { store, backlog, chat, paths, log } = deps;

  async function lineOf(draft: NoteDraft): Promise<string | null> {
    return draft.session === null
      ? null
      : sessionLine(draft.session, paths, await deps.homeDir);
  }

  return {
    async toFollowup(request, flattened) {
      const draft = await store.draft();
      const refusal = sendRefusal(
        draft,
        request.type === 'create' ? 'followup' : 'append',
      );
      // sendRefusal refuses a draft with no target.
      if (refusal !== null || draft.target === null) {
        return refused(refusal ?? 'Pick a target first');
      }
      const images = await imagesToSend(store, draft, flattened);
      const line = await lineOf(draft);
      const target = followupTarget(draft, request);
      let result: BacklogWriteResult;
      try {
        result = await backlog.fileNote(
          draft.target,
          target,
          followupText(draft, line, request.type),
          images,
        );
      } catch (error) {
        log('notes', `follow-up not filed: ${errorText(error)}`);
        return refused(errorText(error));
      }
      const outcome = followupOutcome(result, target);
      if ('refusal' in outcome) {
        return refused(outcome.refusal);
      }
      return { type: 'sent', draft: await store.clear(), toast: outcome.toast };
    },

    async toSession(projectDir, flattened) {
      const draft = await store.draft();
      const refusal = sendRefusal(draft, 'session');
      if (refusal !== null) {
        return refused(refusal);
      }
      const images = await imagesToSend(store, draft, flattened);
      const owner =
        draft.session === null ? null : chat.profileOf(draft.session.sessionId);
      const profile = owner ?? chat.profileNames().at(0);
      if (profile === undefined) {
        return refused('Chat has no profiles');
      }
      const line = await lineOf(draft);
      const message = {
        text: launchText(deps.launchBrief(), draft, line),
        images: images.map(asPng),
      };
      try {
        await chat.launch({ projectDir, profile, message });
      } catch (error) {
        log('notes', `session not started: ${errorText(error)}`);
        return refused(errorText(error));
      }
      const home = await deps.homeDir;
      return {
        type: 'sent',
        draft: await store.clear(),
        toast: `Session started in ${paths.tilde(projectDir, home)}`,
      };
    },
  };
}
