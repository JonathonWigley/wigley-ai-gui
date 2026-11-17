import type {
  AgentFormAutoAnswer,
  AgentFormType,
} from '../../../contracts/agent-forms';
import {
  type AudioPickerBody,
  type AudioPickerForm,
  type AudioPickerPayload,
  COLLECT_AUDIO_PICKER_TOOL,
  OPEN_AUDIO_PICKER_TOOL,
} from '../contract';
import {
  audioPickerFingerprint,
  audioPickerHandedBackPayload,
  audioPickerNotShownPayload,
  audioPickerPayload,
  autoAnsweredPayload,
  noAudioPickerPayload,
  parseAudioPicker,
  type PickerPaths,
  readAudioPickerBody,
  recommendedBody,
  savedAudioPickerHeading,
} from './picker';
import { AudioPickerError } from './picker-error';

// The audio picker as an agent form type: `open_audio_picker` opens one and
// `collect_last_audio_picker` collects it. `parse` checks each file path by
// `paths`; a saved body pre-fills as it is.
export function createAudioPickerType(
  paths: PickerPaths,
): AgentFormType<AudioPickerForm, AudioPickerBody, AudioPickerPayload> {
  return {
    openTool: OPEN_AUDIO_PICKER_TOOL,
    collectTool: COLLECT_AUDIO_PICKER_TOOL,
    noun: 'audio picker',
    argsErrorText: (error) =>
      error instanceof AudioPickerError ? error.message : null,
    parse: (args) => parseAudioPicker(args, paths),
    fingerprint: audioPickerFingerprint,
    heading: (form) => form.heading,
    savedHeading: savedAudioPickerHeading,
    readBody: readAudioPickerBody,
    prefill: (_form, saved) => saved,
    payload: audioPickerPayload,
    handedBackPayload: audioPickerHandedBackPayload,
    noFormPayload: noAudioPickerPayload,
    notShownPayload: audioPickerNotShownPayload,
  };
}

// Answers each picker with its recommended picks, showing none, while `isOn`
// holds for the session.
export function audioPickerAutoAnswer(
  isOn: (sessionId: string) => boolean,
): AgentFormAutoAnswer<AudioPickerForm, AudioPickerBody, AudioPickerPayload> {
  return { isOn, body: recommendedBody, payload: autoAnsweredPayload };
}
