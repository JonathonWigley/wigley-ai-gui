import type { CommandKey } from '../../contracts/commands';
import type {
  AgentFormInvoke,
  AgentFormMessages,
  PresentedAgentForm,
} from '../../contracts/agent-forms';
import type { ChannelShape, DependencyKey } from '../../contracts/plugin';
import type { KeyedSlotKey } from '../../contracts/state';

// The audio picker's shapes: the open_audio_picker call, the body the page
// sends back, the payload both tools return, and the page part's exports.
// Tool args are snake_case (loudness_lufs, drive_url); parse turns them into
// the camelCase form below.

export type PlayMode = 'one-shot' | 'loop' | 'variants';

export const PLAY_MODES: readonly PlayMode[] = ['one-shot', 'loop', 'variants'];

// Semitones, min <= max.
export type PitchRange = { min: number; max: number };

export type AudioCandidate = {
  name: string;
  library: string;
  // Absolute paths: 1 for one-shot and loop, 2 to MAX_VARIANT_FILES for
  // variants.
  files: string[];
  play: PlayMode;
  // 0 to 1, the volume the game sets.
  volume: number;
  pitch: PitchRange | null;
  loudnessLufs: number | null;
  driveUrl: string | null;
};

// `recommend` is 1-based.
export type AudioMoment = {
  title: string;
  reason: string;
  candidates: AudioCandidate[];
  recommend: number;
};

export type AudioPickerForm = {
  heading: string;
  overview: string;
  moments: AudioMoment[];
};

// `choice` is the 1-based candidate, 0 for None of these.
export type MomentAnswer = { choice: number; note: string };

export type AudioPickerBody = { answers: MomentAnswer[] };

// 0-based in every field.
export type AudioPosition = { moment: number; candidate: number; file: number };

// Lowercase; .aif, .aiff and .m4a may not decode in Chromium.
export const AUDIO_EXTENSIONS: readonly string[] = [
  '.wav',
  '.mp3',
  '.ogg',
  '.flac',
  '.aif',
  '.aiff',
  '.m4a',
];

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
export const MAX_MOMENTS = 20;
export const MAX_CANDIDATES = 5;
export const MAX_VARIANT_FILES = 8;
// pitch.min and pitch.max lie in -12 to 12.
export const MAX_PITCH_SEMITONES = 12;

export const AUDIO_PICKER_ERROR_NAME = 'AudioPickerError';
export const OPEN_AUDIO_PICKER_TOOL = 'open_audio_picker';
export const COLLECT_AUDIO_PICKER_TOOL = 'collect_last_audio_picker';

// Only the wigley-forms relay returns `needs_manual_open`, when it cannot
// start the app; the app never does.
export type AudioPickerOutcome =
  | 'submitted'
  | 'draft'
  | 'cancelled'
  | 'auto_answered'
  | 'needs_manual_open'
  | 'no_audio_picker';

// `choice` as MomentAnswer's; `candidate` is null for None of these.
export type AudioPick = {
  moment: string;
  choice: number;
  candidate: AudioCandidate | null;
  note: string;
};

export type AudioPickerPayload = {
  outcome: AudioPickerOutcome;
  summary: string;
  next: string;
  picks?: AudioPick[];
  earlier_heading?: string;
};

export type PresentedAudioPicker = PresentedAgentForm<
  AudioPickerForm,
  AudioPickerBody
>;

// The agent form channel, the page's audio reads, and `openPreview` from the
// preview key.
export interface AudioPickerChannel extends ChannelShape {
  invoke: AgentFormInvoke<AudioPickerForm, AudioPickerBody> & {
    // `sessionId` is the app's, PresentedAgentForm.sessionId.
    readAudio(sessionId: string, at: AudioPosition): Promise<Uint8Array>;
    openPreview(): void;
  };
  messages: AgentFormMessages<AudioPickerForm, AudioPickerBody>;
}

export interface AudioPickerPageExports {
  activePicker(): PresentedAudioPicker | null;
}

export const audioPickerPageKey: DependencyKey<
  AudioPickerPageExports,
  'page',
  'audio-picker'
> = { id: 'audio-picker', process: 'page' };

// Where an open picker's page left it, 0-based; `row` equal to the moment's
// candidate count is its None of these row, and `confirm` is the cancel prompt.
export type AudioPickerPlace = {
  moment: number;
  row: number;
  view: 'list' | 'confirm';
};

// Each open picker's place, by the picker's form id.
export const audioPickerPlaceSlot: KeyedSlotKey<
  AudioPickerPlace,
  'page',
  'audio-picker'
> = { id: 'audio-picker.place', process: 'page', kind: 'keyed' };

// Moves the cursor to the 0-based row of the 0-based moment and chooses it,
// as a click on the row does.
export const audioPickerSelectRowCommand: CommandKey<
  { moment: number; row: number },
  'audio-picker.selectRow'
> = { id: 'audio-picker.selectRow' };

// Plays or stops the 0-based candidate of the 0-based moment, as a click on
// its row's play button does.
export const audioPickerPlayRowCommand: CommandKey<
  { moment: number; candidate: number },
  'audio-picker.playRow'
> = { id: 'audio-picker.playRow' };
