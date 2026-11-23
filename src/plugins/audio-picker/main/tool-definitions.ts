import {
  type OfflineAnswer,
  textResult,
  type ToolDefinition,
} from '../../sessions/contract';
import {
  AUDIO_EXTENSIONS,
  COLLECT_AUDIO_PICKER_TOOL,
  MAX_CANDIDATES,
  MAX_MOMENTS,
  MAX_PITCH_SEMITONES,
  MAX_VARIANT_FILES,
  OPEN_AUDIO_PICKER_TOOL,
  PLAY_MODES,
} from '../contract';

const OPEN_AUDIO_PICKER_DESCRIPTION =
  "Open the audio picker in the wigley-ai-gui app's picker popup and wait " +
  "for the user's picks, as on a forms round. Call it once you have a " +
  'shortlist of candidate sounds, before wiring any sound; the ' +
  'auri:audio-picker skill holds the steps. One picker ' +
  'covers every moment of the feature. Each moment lists 1 to ' +
  `${MAX_CANDIDATES} candidates (aim for 2 to ${MAX_CANDIDATES}) and ` +
  "'recommend', the 1-based candidate you would pick. Every file is an " +
  'absolute path to a file that exists now, ending in one of ' +
  `${AUDIO_EXTENSIONS.join(' ')}. 'play' is how the game will play the ` +
  "candidate, and the picker plays it the same way: 'one-shot' plays its " +
  "one file once, 'loop' loops its one file seamlessly, and 'variants' " +
  `plays one of its 2 to ${MAX_VARIANT_FILES} files at random each time. ` +
  "'volume' is the game's volume, 0 to 1, and 'pitch' a random range in " +
  'semitones each play picks from. The result holds one pick per moment: ' +
  "'choice' is the 1-based candidate the user chose, and 0 means None of " +
  "these: search again with that pick's note, then open a new picker for " +
  "those moments only. On outcome 'draft', call collect_last_audio_picker. " +
  "Outcome 'auto_answered' means no one chose: the session is headless and " +
  'each pick is your own recommendation. Re-sending a picker is safe: the ' +
  'same picker re-attaches to the one still open, returns the picks of the ' +
  "picker just finished, or opens pre-filled with the user's saved answers. " +
  "When the result carries 'earlier_heading', those picks belong to an " +
  'earlier picker you never received; read them, then send your picker ' +
  "again. Outcome 'needs_manual_open' means the relay could not start the " +
  "app and no picker exists: do what its 'next' says.";

const COLLECT_AUDIO_PICKER_DESCRIPTION =
  'Re-attach to the audio picker already open in the app and wait for the ' +
  "picks, or return the last finished picker's picks again. Takes no " +
  'required arguments. Call this after open_audio_picker returns outcome ' +
  "'draft', and after any failure that lost the picks. Outcome " +
  "'no_audio_picker' means no picker is open and no finished picks are " +
  'waiting: send the picker again with open_audio_picker, and the ' +
  "user's saved answers fill in.";

const PITCH_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['min', 'max'],
  properties: {
    min: {
      type: 'number',
      minimum: -MAX_PITCH_SEMITONES,
      maximum: MAX_PITCH_SEMITONES,
    },
    max: {
      type: 'number',
      minimum: -MAX_PITCH_SEMITONES,
      maximum: MAX_PITCH_SEMITONES,
    },
  },
  description: 'Semitones, min no greater than max; leave out for no pitch.',
};

const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'library', 'files', 'play', 'volume'],
  properties: {
    name: { type: 'string', minLength: 1 },
    library: {
      type: 'string',
      minLength: 1,
      description: 'The sound library the files come from.',
    },
    files: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_VARIANT_FILES,
      items: { type: 'string', minLength: 1 },
      description:
        "Absolute paths: 1 for 'one-shot' and 'loop', 2 or more for " +
        "'variants'.",
    },
    play: { type: 'string', enum: [...PLAY_MODES] },
    volume: { type: 'number', minimum: 0, maximum: 1 },
    pitch: PITCH_SCHEMA,
    loudness_lufs: { type: ['number', 'null'] },
    drive_url: {
      type: ['string', 'null'],
      description: "The file's Google Drive link.",
    },
  },
};

const MOMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'reason', 'recommend', 'candidates'],
  properties: {
    title: { type: 'string', minLength: 1 },
    reason: {
      type: 'string',
      minLength: 1,
      description: 'What the sound is for in the feature.',
    },
    recommend: {
      type: 'integer',
      minimum: 1,
      description: 'The 1-based candidate you would pick.',
    },
    candidates: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_CANDIDATES,
      items: CANDIDATE_SCHEMA,
    },
  },
};

// The two audio picker tools as MCP tools/list publishes them. Parse checks
// every rule these schemas state, and more, except `additionalProperties`:
// it ignores a field it does not know.
export const AUDIO_PICKER_TOOLS: ToolDefinition[] = [
  {
    name: OPEN_AUDIO_PICKER_TOOL,
    description: OPEN_AUDIO_PICKER_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['heading', 'moments'],
      properties: {
        heading: { type: 'string', minLength: 1 },
        overview: { type: ['string', 'null'] },
        moments: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_MOMENTS,
          items: MOMENT_SCHEMA,
        },
      },
    },
  },
  {
    name: COLLECT_AUDIO_PICKER_TOOL,
    description: COLLECT_AUDIO_PICKER_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        wait: {
          type: 'boolean',
          default: true,
          description:
            'false returns the current draft at once instead of waiting.',
        },
      },
    },
  },
];

// open_audio_picker's answer while the app is closed: the agent takes each
// moment's recommended candidate, as a headless session does. A fixed answer
// cannot carry the picks, so the text points at the agent's own recommends.
// collect_last_audio_picker has none, so it answers that it did not run.
export const OPEN_AUDIO_PICKER_OFFLINE: OfflineAnswer = {
  result: textResult(
    "The app is closed, so no audio picker was shown. Take each moment's recommended candidate, wire it as its play, volume and pitch say, and list every pick as a Decided notice in your reply.",
  ),
  replay: false,
};
