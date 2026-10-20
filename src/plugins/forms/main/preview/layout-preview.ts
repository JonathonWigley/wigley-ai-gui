import type { Log } from '../../../../contracts/log';
import { errorText } from '../../../../shared/error-text';
import type {
  ConnectedSession,
  SessionInfo,
  SessionsMainExports,
} from '../../../sessions/contract';
import type {
  AnswersPayload,
  FormsService,
  FormsSession,
} from '../../contract';
import { parseRound } from '../round';
import { PREVIEW_ROUND_ARGS } from './preview-round';

// The row label is projectDir's basename.
const PREVIEW_SESSION: SessionInfo = {
  sessionId: 'layout-preview',
  projectDir: 'Layout preview',
  deadlineSeconds: null,
  harness: null,
};

// What `cursor` holds while the sample shows.
const SAMPLE = -1;

interface OpenPreview {
  connected: ConnectedSession;
  forms: FormsSession;
  // Aborting it closes the round the preview shows.
  asking: AbortController;
}

// The sample when `cursor` is past the last saved round, else the first saved
// round after `cursor` that parses, logging each one skipped.
function nextRound(
  cursor: number,
  saved: unknown[],
  log: Log,
): { cursor: number; args: unknown } {
  for (let index = cursor + 1; index < saved.length; index++) {
    try {
      parseRound(saved[index]);
      return { cursor: index, args: saved[index] };
    } catch (error) {
      log('forms', `preview skipped a saved round: ${errorText(error)}`);
    }
  }
  return { cursor: SAMPLE, args: PREVIEW_ROUND_ARGS };
}

// A round source over its own FormsService: the first open shows the sample in
// a session of its own, and each further open swaps in the next saved round,
// wrapping back to the sample. A submit or cancel ends the session.
export function createLayoutPreview(deps: {
  sessions: Pick<SessionsMainExports, 'connect'>;
  forms: FormsService;
  savedArgs(): unknown[];
  log: Log;
}): { open(): void } {
  const { log } = deps;
  let preview: OpenPreview | null = null;
  let cursor = SAMPLE;

  const end = (ended: OpenPreview) => {
    if (preview === ended) {
      preview = null;
    }
    ended.forms.end();
    ended.connected.end();
  };

  // A draft (the deadline passed) waits on; any other outcome ends the
  // session. An answer to an ask the next open aborted is ignored.
  const settle = (shown: OpenPreview, answer: Promise<AnswersPayload>) => {
    answer.then(
      (payload) => {
        if (shown.asking.signal.aborted) {
          return;
        }
        if (payload.outcome === 'draft') {
          settle(
            shown,
            shown.forms.collectLastRound(true, shown.asking.signal),
          );
          return;
        }
        end(shown);
      },
      (error: unknown) => {
        if (shown.asking.signal.aborted) {
          return;
        }
        log('forms', `preview round failed: ${errorText(error)}`);
        end(shown);
      },
    );
  };

  const ask = (shown: OpenPreview, args: unknown) => {
    settle(shown, shown.forms.askRound(args, null, shown.asking.signal));
  };

  return {
    open() {
      if (preview === null) {
        const connected = deps.sessions.connect(PREVIEW_SESSION);
        preview = {
          connected,
          forms: deps.forms.startSession(connected.session),
          asking: new AbortController(),
        };
        cursor = SAMPLE;
        ask(preview, PREVIEW_ROUND_ARGS);
        return;
      }
      preview.asking.abort();
      preview = { ...preview, asking: new AbortController() };
      const next = nextRound(cursor, deps.savedArgs(), log);
      cursor = next.cursor;
      ask(preview, next.args);
    },
  };
}
