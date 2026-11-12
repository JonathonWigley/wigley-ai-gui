import path from 'node:path';
import type {
  DriveHost,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { createAgentFormChannelPresenter } from '../../../shared/agent-forms/channel-presenter';
import {
  createChatFormWake,
  NO_FORM_WAKE,
} from '../../../shared/agent-forms/chat-wake';
import { addAgentFormDriveActions } from '../../../shared/agent-forms/drive-actions';
import { createAgentFormService } from '../../../shared/agent-forms/form-service';
import { createFolderFormStore } from '../../../shared/agent-forms/form-store';
import { createMemoryFormStore } from '../../../shared/agent-forms/memory-form-store';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import { errorText } from '../../../shared/error-text';
import { chatMainKey } from '../../chat/contract';
import {
  DRIVE_SESSION_DEFAULTS,
  type Harness,
  type SessionsMainEvents,
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import {
  type AudioPickerChannel,
  MAX_AUDIO_BYTES,
  OPEN_AUDIO_PICKER_TOOL,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { audioPickerManifest } from '../manifest';
import { createAudioReads, withAudioFileCheck } from './audio-reads';
import {
  samplePickerArgs,
  type SamplePickerArgs,
  sampleSoundsDir,
  writeSampleSounds,
} from './fixtures';
import { audioPickerAutoAnswer, createAudioPickerType } from './picker-type';
import { createAudioPickerPreview } from './preview/audio-picker-preview';
import { previewPickerArgs } from './preview/preview-picker';
import { audioPickerSelfTestScript } from './selftest-script';
import { AUDIO_PICKER_TOOLS } from './tool-definitions';

type AudioPickerApi = MainApi<
  typeof audioPickerManifest,
  AudioPickerChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Opens pickers in a drive run's sessions and reads their answers:
// `audio-picker.openPicker` and `audio-picker.answers`, as
// `addAgentFormDriveActions` runs them. `defaultForm` is the picker opened
// when the caller names none; its files must already exist.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect'>,
  onSessionEnded: (listener: (rowId: string) => void) => void,
  defaultForm: SamplePickerArgs,
): void {
  addAgentFormDriveActions<Harness>({
    host,
    sessions,
    sessionDefaults: DRIVE_SESSION_DEFAULTS,
    onSessionEnded,
    words: {
      pluginId: 'audio-picker',
      openAction: 'openPicker',
      formArg: 'picker',
      defaultForm,
      openTool: OPEN_AUDIO_PICKER_TOOL,
      openDescription:
        'Opens an audio picker in the session sessionId names without waiting for its answers: the live one audio-picker opened before under that id, else the owned session holding it (one sessions.open opened), else a new one; the default picker is the two-moment sample over the sample sounds in the plugin data folder.',
      answersDescription:
        "The latest audio picker's tool result once send or cancel resolved it, else { pending: true }.",
    },
  });
}

// Serves open_audio_picker and collect_last_audio_picker to every agent
// session, checking each listed file exists before a picker opens; saves each
// picker in the picker folder and shows it on the page; serves the page the
// bytes of the files an open picker lists; wakes a picker's chat session when
// the picker finishes with no call waiting; answers a headless chat session's
// pickers with their recommendations; registers the picker layouts; opens the
// layout preview on the page's ask over a service of its own whose store is in
// memory and whose pickers go through the presenter's quiet view; refuses a
// switch-off while an agent's picker is open. Outside a live run it writes the
// sample sounds into the plugin's data folder first; once written, the
// self-test gets its picker and a drive run gets its drive actions.
export const audioPickerMainPart: MainPart<typeof audioPickerManifest> = {
  manifest: audioPickerManifest,
  start(api: AudioPickerApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsMainKey);
    const chat = api.dependency(chatMainKey);
    const store = createFolderFormStore({
      dir: path.join(
        services.homeDir,
        '.agents',
        'wigley-audio-picker',
        'pickers',
      ),
      clock: services.clock,
      randomHex: services.randomHex,
      paths: services.paths,
      log: services.log,
    });
    store.prune();
    const type = createAudioPickerType(services.paths);
    const presenter = createAgentFormChannelPresenter({
      channel: api.channel,
      alerts: services.alerts,
      source: 'audio-picker',
      noun: type.noun,
      markText: (label) => `Audio picker from ${label}`,
      markAction: 'answer',
      log: services.log,
      sessions,
    });
    const reads = createAudioReads({
      files: services.files,
      maxBytes: MAX_AUDIO_BYTES,
    });
    const defaultDeadlineSeconds = () => api.settings().deadlineSeconds;
    const service = createAgentFormService({
      type,
      presenter: reads.watch(presenter),
      store,
      wake: createChatFormWake(chat, services.log),
      defaultDeadlineSeconds,
      timers: services.timers,
      autoAnswer: audioPickerAutoAnswer((id) => chat.isHeadless(id)),
    });
    const soundsDir = sampleSoundsDir(api.dataFolder, services.paths);
    const writeSounds = () =>
      writeSampleSounds(services.files, soundsDir, services.paths);
    const previewService = createAgentFormService({
      type,
      presenter: reads.watch(presenter.quiet),
      store: createMemoryFormStore(
        services.clock,
        services.randomHex,
        services.paths,
      ),
      wake: NO_FORM_WAKE,
      defaultDeadlineSeconds,
      timers: services.timers,
    });
    const preview = createAudioPickerPreview({
      sessions,
      picker: previewService,
      writeSounds,
      args: previewPickerArgs(soundsDir, services.paths),
      log: services.log,
    });
    api.channel.handle('readAudio', reads.readAudio);
    api.channel.handle('openPreview', () => preview.open());
    api.layouts.register({ layoutTypes });
    sessions.contributeTools(AUDIO_PICKER_TOOLS, (session) =>
      withAudioFileCheck(
        createAgentFormToolSession(service.startSession(session), type),
        type.parse,
        services.files,
      ),
    );
    // Always resolves: a failed write is logged, and the open that needs the
    // files then fails on them.
    const ready: Promise<void> =
      services.runMode === 'live'
        ? Promise.resolve()
        : writeSounds().catch((error: unknown) =>
            services.log(`sample sounds not written: ${errorText(error)}`),
          );
    const sampleArgs = samplePickerArgs(soundsDir, services.paths);
    services.selfTest?.run(
      audioPickerSelfTestScript(sessions, ready, sampleArgs),
    );
    // A stop before the write settles adds no drive actions.
    let isDisposed = false;
    ready
      .then(() => {
        if (!isDisposed && api.drive !== null) {
          addDriveActions(
            api.drive,
            sessions,
            (listener) =>
              api.events.on('sessions.ended', ({ sessionId }) =>
                listener(sessionId),
              ),
            sampleArgs,
          );
        }
      })
      .catch((error: unknown) =>
        services.log(`drive actions not added: ${errorText(error)}`),
      );
    return {
      commands: {},
      mayStop: () => presenter.mayStop(),
      dispose: (stop) => {
        isDisposed = true;
        if (stop === 'quit') {
          service.detach();
        }
        preview.dispose();
      },
    };
  },
};
