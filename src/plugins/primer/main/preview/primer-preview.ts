import type { AgentFormService } from '../../../../contracts/agent-forms';
import type { PluginLog } from '../../../../contracts/log';
import { createAgentFormPreview } from '../../../../shared/agent-forms/agent-form-preview';
import type {
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
  log: PluginLog;
}

// The sample primer in a session of its own. The first open connects the
// session, selects its row and opens the sample there; an open while it shows
// selects its row only, keeping the user's edits. A send or cancel ends the
// session, and the next open starts over.
export function createPrimerPreview(deps: PrimerPreviewDeps): {
  open(): void;
} {
  const preview = createAgentFormPreview({
    session: PREVIEW_SESSION,
    sessions: deps.sessions,
    forms: deps.primer,
    log: deps.log,
    noun: 'primer',
  });
  return {
    open() {
      if (preview.show()) {
        preview.ask(PREVIEW_PRIMER_ARGS);
      }
    },
  };
}
