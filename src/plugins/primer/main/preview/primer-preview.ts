import type {
  AgentFormService,
  AgentFormSession,
} from '../../../../contracts/agent-forms';
import type { Log } from '../../../../contracts/log';
import { errorText } from '../../../../shared/error-text';
import type {
  ConnectedSession,
  SessionInfo,
  SessionsMainExports,
} from '../../../sessions/contract';
import type { PrimerPayload } from '../../contract';
import { PREVIEW_PRIMER_ARGS } from './preview-primer';

// The row label is projectDir's basename.
const PREVIEW_SESSION: SessionInfo = {
  sessionId: 'primer-preview',
  projectDir: 'Primer preview',
  deadlineSeconds: null,
  harness: null,
};

// `primer` is a service of the preview's own, whose forms raise no alert and
// write no file.
export interface PrimerPreviewDeps {
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>;
  primer: AgentFormService<PrimerPayload>;
  log: Log;
}

interface OpenPreview {
  connected: ConnectedSession;
  primer: AgentFormSession<PrimerPayload>;
  // Nothing aborts it: the sample stays open until the user sends or cancels
  // it.
  signal: AbortSignal;
}

// The sample primer in a session of its own. The first open connects the
// session, selects its row and opens the sample there; an open while it shows
// selects its row only, keeping the user's edits. A send or cancel ends the
// session, and the next open starts over.
export function createPrimerPreview(deps: PrimerPreviewDeps): {
  open(): void;
} {
  const { log } = deps;
  let preview: OpenPreview | null = null;

  const end = (ended: OpenPreview) => {
    if (preview === ended) {
      preview = null;
    }
    ended.primer.end();
    ended.connected.end();
  };

  // A draft (the deadline passed) waits on; any other outcome ends the
  // session.
  const settle = (shown: OpenPreview, answer: Promise<PrimerPayload>) => {
    answer.then(
      (payload) => {
        if (payload.outcome === 'draft') {
          settle(shown, shown.primer.collect(true, shown.signal));
          return;
        }
        end(shown);
      },
      (error: unknown) => {
        log('primer', `preview primer failed: ${errorText(error)}`);
        end(shown);
      },
    );
  };

  return {
    open() {
      if (preview !== null) {
        deps.sessions.activate(preview.connected.session.id);
        return;
      }
      const connected = deps.sessions.connect(PREVIEW_SESSION);
      const opened: OpenPreview = {
        connected,
        primer: deps.primer.startSession(connected.session),
        signal: new AbortController().signal,
      };
      preview = opened;
      deps.sessions.activate(connected.session.id);
      settle(
        opened,
        opened.primer.open(PREVIEW_PRIMER_ARGS, null, opened.signal),
      );
    },
  };
}
