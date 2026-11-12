import type { AgentFormService } from '../../../../contracts/agent-forms';
import type { Disposable } from '../../../../contracts/disposable';
import type { PluginLog } from '../../../../contracts/log';
import { createAgentFormPreview } from '../../../../shared/agent-forms/agent-form-preview';
import { errorText } from '../../../../shared/error-text';
import type {
  SessionInfo,
  SessionsMainExports,
} from '../../../sessions/contract';
import type { AudioPickerPayload } from '../../contract';
import type { SamplePickerArgs } from '../fixtures';

// No project, so the row and its title bar carry the label alone.
const PREVIEW_SESSION: SessionInfo = {
  sessionId: 'audio-picker-preview',
  projectDir: null,
  harness: null,
  label: 'Audio picker preview',
};

// `picker` is a service of the preview's own, whose pickers raise no alert
// and write no file. `writeSounds` writes the files `args` names.
export interface AudioPickerPreviewDeps {
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>;
  picker: AgentFormService<AudioPickerPayload>;
  writeSounds(): Promise<void>;
  args: SamplePickerArgs;
  log: PluginLog;
}

// The sample picker in a session of its own. An open that connects the
// session selects its row, writes the sample sounds and then opens `args`
// there; an open while it shows selects its row only, keeping the user's
// choices. A failed write ends the session, so the next open writes again.
// A send or cancel ends the session, and the next open starts over.
// `dispose` ends one still open, and a write still running then opens
// nothing.
export function createAudioPickerPreview(
  deps: AudioPickerPreviewDeps,
): { open(): void } & Disposable {
  const preview = createAgentFormPreview({
    session: PREVIEW_SESSION,
    sessions: deps.sessions,
    forms: deps.picker,
    log: deps.log,
    noun: 'audio picker',
  });
  // Each connect and each dispose takes a new one, so a write that settles
  // after either asks nothing.
  let token = 0;
  const askOnceWritten = async (opened: number) => {
    try {
      await deps.writeSounds();
    } catch (error) {
      deps.log(`preview sounds not written: ${errorText(error)}`);
      if (opened === token) {
        token++;
        preview.dispose();
      }
      return;
    }
    if (opened !== token) {
      return;
    }
    try {
      preview.ask(deps.args);
    } catch (error) {
      deps.log(`preview not opened: ${errorText(error)}`);
    }
  };
  return {
    open() {
      if (preview.show()) {
        void askOnceWritten(++token);
      }
    },
    dispose() {
      token++;
      preview.dispose();
    },
  };
}
