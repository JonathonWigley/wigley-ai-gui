import { AUDIO_PICKER_ERROR_NAME } from '../contract';

// A malformed open_audio_picker call. The message names the field, the bad
// value and the rule: it is the calling model's only repair signal.
export class AudioPickerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = AUDIO_PICKER_ERROR_NAME;
  }
}
