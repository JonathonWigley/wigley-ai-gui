import path from 'node:path';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { createAgentFormChannelPresenter } from '../../../shared/agent-forms/channel-presenter';
import { createChatFormWake } from '../../../shared/agent-forms/chat-wake';
import { createAgentFormService } from '../../../shared/agent-forms/form-service';
import { createFolderFormStore } from '../../../shared/agent-forms/form-store';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import { chatMainKey } from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import { type AudioPickerChannel, MAX_AUDIO_BYTES } from '../contract';
import { audioPickerManifest } from '../manifest';
import { createAudioReads, withAudioFileCheck } from './audio-reads';
import { audioPickerAutoAnswer, createAudioPickerType } from './picker-type';
import { AUDIO_PICKER_TOOLS } from './tool-definitions';

type AudioPickerApi = MainApi<
  typeof audioPickerManifest,
  AudioPickerChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Serves open_audio_picker and collect_last_audio_picker to every agent
// session, checking each listed file exists before a picker opens; saves each
// picker in the picker folder and shows it on the page; serves the page the
// bytes of the files an open picker lists; wakes a picker's chat session when
// the picker finishes with no call waiting; answers a headless chat session's
// pickers with their recommendations; refuses a switch-off while an agent's
// picker is open.
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
    const service = createAgentFormService({
      type,
      presenter: reads.watch(presenter),
      store,
      wake: createChatFormWake(chat, services.log),
      defaultDeadlineSeconds: () => api.settings().deadlineSeconds,
      timers: services.timers,
      autoAnswer: audioPickerAutoAnswer((id) => chat.isHeadless(id)),
    });
    api.channel.handle('readAudio', reads.readAudio);
    sessions.contributeTools(AUDIO_PICKER_TOOLS, (session) =>
      withAudioFileCheck(
        createAgentFormToolSession(service.startSession(session), type),
        type.parse,
        services.files,
      ),
    );
    return {
      commands: {},
      mayStop: () => presenter.mayStop(),
      dispose: (stop) => {
        if (stop === 'quit') {
          service.detach();
        }
      },
    };
  },
};
