import type { Disposable } from '../../../../contracts/disposable';
import type { PluginLog } from '../../../../contracts/log';
import { errorText } from '../../../../shared/error-text';
import { createAgentFormPreview } from '../../../../shared/agent-forms/agent-form-preview';
import type {
  SessionInfo,
  SessionsMainExports,
} from '../../../sessions/contract';
import type { FormsService } from '../../contract';
import { parseRound, requireKnownLayouts } from '../round';
import { PREVIEW_ROUND_ARGS } from './preview-round';

// No project, so the row and its title bar carry the label alone.
const PREVIEW_SESSION: SessionInfo = {
  sessionId: 'layout-preview',
  projectDir: null,
  harness: null,
  rowId: null,
  label: 'Layout preview',
};

// What `cursor` holds while the sample shows.
const SAMPLE = -1;

// The sample when `cursor` is past the last saved round, else the first saved
// round after `cursor` that parses and names only layouts in `layoutNames`,
// logging each one skipped.
function nextRound(
  cursor: number,
  saved: unknown[],
  layoutNames: readonly string[],
  log: PluginLog,
): { cursor: number; args: unknown } {
  for (let index = cursor + 1; index < saved.length; index++) {
    try {
      requireKnownLayouts(parseRound(saved[index]), layoutNames);
      return { cursor: index, args: saved[index] };
    } catch (error) {
      log(`preview skipped a saved round: ${errorText(error)}`);
    }
  }
  return { cursor: SAMPLE, args: PREVIEW_ROUND_ARGS };
}

// A round source over its own FormsService: the first open shows the sample in
// a session of its own, and each further open swaps in the next saved round,
// wrapping back to the sample. Every open selects the session's row. A submit
// or cancel ends the session, and `dispose` ends one still open.
export function createLayoutPreview(deps: {
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>;
  forms: FormsService;
  savedArgs(): unknown[];
  // The layouts folder's layout names now.
  layoutNames(): readonly string[];
  log: PluginLog;
}): { open(): void } & Disposable {
  const preview = createAgentFormPreview({
    session: PREVIEW_SESSION,
    sessions: deps.sessions,
    forms: deps.forms,
    log: deps.log,
    noun: 'round',
  });
  let cursor = SAMPLE;
  return {
    open() {
      if (preview.show()) {
        cursor = SAMPLE;
        preview.ask(PREVIEW_ROUND_ARGS);
        return;
      }
      const next = nextRound(
        cursor,
        deps.savedArgs(),
        deps.layoutNames(),
        deps.log,
      );
      cursor = next.cursor;
      preview.ask(next.args);
    },
    dispose: () => preview.dispose(),
  };
}
