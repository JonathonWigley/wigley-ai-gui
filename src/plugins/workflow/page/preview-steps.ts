// The layout preview's steps (`Space z l w`): one sample flow per press.
import type { Clock } from '../../../contracts/ambient';
import type { PluginLog } from '../../../contracts/log';
import { CHAT_PREVIEW_HOST_ID } from '../../chat/contract';
import type { SessionFlow } from '../contract';

// `openChatPreview` runs chat's preview command, which opens chat's preview
// session or selects its row, and reports a failure itself.
// `previewSessionId` is that session's row, null while none is heard of.
// `showFlow` draws a flow in the view; `closed` draws the session's own flow
// again. `samples` is every workflow's samples for the session at `now`, read
// once per step.
export interface PreviewDeps {
  openChatPreview(): void;
  previewSessionId(): string | null;
  showFlow(flow: SessionFlow): void;
  closed(sessionId: string): void;
  clock: Clock;
  samples(sessionId: string, now: number): readonly SessionFlow[];
  log: PluginLog;
}

// `press` is the preview key: the first press opens chat's preview session
// and shows the first sample in it, each next press the next sample, and the
// press after the last closes the preview. A step past the end of the samples,
// none at all included, closes it too. A press while chat's preview row
// is not yet heard of asks chat again, so a preview that failed to open
// opens on the next press. `sessionAdded` shows the first sample in chat's
// preview row when it arrives after a press. `flowOf` is the sample the
// session shows, null for a session outside the preview.
export interface Preview {
  press(): void;
  sessionAdded(sessionId: string, hostSessionId: string | null): void;
  sessionRemoved(sessionId: string): void;
  flowOf(sessionId: string): SessionFlow | null;
}

// `total` is the length of the samples this step read.
interface ShownSample {
  sessionId: string;
  index: number;
  total: number;
  flow: SessionFlow;
}

export function createPreview(deps: PreviewDeps): Preview {
  const { log } = deps;
  // Made once per step, so its countdown runs down.
  let shown: ShownSample | null = null;
  let awaitingRow = false;

  const close = (sessionId: string) => {
    shown = null;
    deps.closed(sessionId);
    log('workflow preview closed');
  };

  const showStep = (sessionId: string, index: number) => {
    const samples = deps.samples(sessionId, deps.clock.now());
    if (index >= samples.length) {
      close(sessionId);
      return;
    }
    const flow = samples[index];
    shown = { sessionId, index, total: samples.length, flow };
    deps.showFlow(flow);
    log(
      `workflow preview step ${index + 1} of ${samples.length}: ${flow.stage}`,
    );
  };

  const open = () => {
    if (awaitingRow) {
      log('workflow preview still waits on the chat preview: asked again');
    }
    deps.openChatPreview();
    const sessionId = deps.previewSessionId();
    awaitingRow = sessionId === null;
    if (sessionId !== null) {
      showStep(sessionId, 0);
    }
  };

  return {
    press() {
      if (shown === null) {
        open();
        return;
      }
      const { sessionId, index, total } = shown;
      if (index + 1 < total) {
        showStep(sessionId, index + 1);
      } else {
        close(sessionId);
      }
    },
    sessionAdded(sessionId, hostSessionId) {
      if (awaitingRow && hostSessionId === CHAT_PREVIEW_HOST_ID) {
        awaitingRow = false;
        showStep(sessionId, 0);
      }
    },
    sessionRemoved(sessionId) {
      if (shown?.sessionId === sessionId) {
        shown = null;
      }
    },
    flowOf: (sessionId) => (shown?.sessionId === sessionId ? shown.flow : null),
  };
}
