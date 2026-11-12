import { createHash } from 'node:crypto';
import type { AgentFormEndKind } from '../../../contracts/agent-forms';
import type { Paths } from '../../../contracts/paths';
import { isJsonObject, type JsonObject } from '../../../shared/json';
import {
  AUDIO_EXTENSIONS,
  type AudioCandidate,
  type AudioMoment,
  type AudioPick,
  type AudioPickerBody,
  type AudioPickerForm,
  type AudioPickerPayload,
  MAX_CANDIDATES,
  MAX_MOMENTS,
  MAX_PITCH_SEMITONES,
  MAX_VARIANT_FILES,
  type MomentAnswer,
  PLAY_MODES,
  type PitchRange,
  type PlayMode,
} from '../contract';
import { AudioPickerError } from './picker-error';

export type PickerPaths = Pick<Paths, 'isAbsolute' | 'normalize' | 'base'>;

interface CountRange {
  min: number;
  max: number;
}

const FILE_COUNTS: Record<PlayMode, CountRange> = {
  'one-shot': { min: 1, max: 1 },
  loop: { min: 1, max: 1 },
  variants: { min: 2, max: MAX_VARIANT_FILES },
};

const NEXT_ON_SUBMITTED =
  'Wire each chosen candidate as its play, volume and pitch say. For each ' +
  'pick with choice 0 (None of these), search again with its note, then open ' +
  'a new picker for those moments only.';

const NEXT_ON_DRAFT =
  'The user has not sent the picks yet. Call collect_last_audio_picker to ' +
  'keep waiting. Do not open a second picker.';

const NEXT_ON_CANCELLED =
  'The user cancelled the audio picker: wire nothing, and ask the user how ' +
  'to proceed.';

const NEXT_ON_AUTO_ANSWERED =
  'No one chose: the session is headless, so the app showed no picker and ' +
  'each pick is your own recommendation. Wire them as their play, volume and ' +
  'pitch say.';

const NEXT_ON_NO_AUDIO_PICKER =
  'No audio picker is open for this session, and no finished picks are ' +
  'waiting for it. If you sent a picker whose picks you never received, send ' +
  "the same picker again with open_audio_picker: the user's saved answers " +
  'fill in.';

const NEXT_BY_OUTCOME: Record<AgentFormEndKind | 'draft', string> = {
  submitted: NEXT_ON_SUBMITTED,
  draft: NEXT_ON_DRAFT,
  cancelled: NEXT_ON_CANCELLED,
};

// The bad value as a message shows it: a string quoted, anything else as JSON.
function shown(value: unknown): string {
  if (value === undefined) {
    return '(missing)';
  }
  return typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
}

function reject(where: string, value: unknown, rule: string): never {
  throw new AudioPickerError(`${where} ${shown(value)} ${rule}.`);
}

function countText({ min, max }: CountRange): string {
  return min === max ? `exactly ${min}` : `${min} to ${max}`;
}

function listOf(
  value: unknown,
  where: string,
  rule: string,
  range: CountRange,
): unknown[] {
  if (!Array.isArray(value)) {
    reject(where, value, rule);
  }
  if (value.length < range.min || value.length > range.max) {
    throw new AudioPickerError(`${where} holds ${value.length}; it ${rule}.`);
  }
  return value;
}

function requiredText(source: JsonObject, key: string, where: string): string {
  const value = source[key];
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    reject(where, value, 'must be a non-empty string');
  }
  return text;
}

function isPlayMode(value: unknown): value is PlayMode {
  return PLAY_MODES.some((mode) => mode === value);
}

function hasAudioExtension(base: string): boolean {
  const dot = base.lastIndexOf('.');
  return dot > 0 && AUDIO_EXTENSIONS.includes(base.slice(dot).toLowerCase());
}

function parseFile(value: unknown, where: string, paths: PickerPaths): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    reject(where, value, 'must be a non-empty string');
  }
  if (!paths.isAbsolute(text)) {
    reject(where, text, 'must be an absolute path');
  }
  const path = paths.normalize(text);
  if (!hasAudioExtension(paths.base(path))) {
    reject(where, text, `must end in one of ${AUDIO_EXTENSIONS.join(' ')}`);
  }
  return path;
}

function parseVolume(value: unknown, where: string): number {
  if (typeof value !== 'number' || !(value >= 0 && value <= 1)) {
    reject(where, value, 'must be a number from 0 to 1');
  }
  return value;
}

function parseSemitones(value: unknown, where: string): number {
  if (typeof value !== 'number' || !(Math.abs(value) <= MAX_PITCH_SEMITONES)) {
    reject(
      where,
      value,
      `must be a number from -${MAX_PITCH_SEMITONES} to ${MAX_PITCH_SEMITONES}`,
    );
  }
  return value;
}

// An optional field takes a JSON null as absent: agents often send one.
function parsePitch(value: unknown, where: string): PitchRange | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isJsonObject(value)) {
    reject(where, value, 'must be an object with min and max semitones');
  }
  const min = parseSemitones(value.min, `${where}.min`);
  const max = parseSemitones(value.max, `${where}.max`);
  if (min > max) {
    reject(where, value, 'must have min no greater than max');
  }
  return { min, max };
}

function parseLoudness(value: unknown, where: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject(where, value, 'must be a finite number');
  }
  return value;
}

function parseDriveUrl(value: unknown, where: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    reject(where, value, 'must be a non-empty string');
  }
  return text;
}

function parseCandidate(
  value: unknown,
  where: string,
  paths: PickerPaths,
): AudioCandidate {
  if (!isJsonObject(value)) {
    reject(where, value, 'must be an object');
  }
  const name = requiredText(value, 'name', `${where}.name`);
  const library = requiredText(value, 'library', `${where}.library`);
  const { play } = value;
  if (!isPlayMode(play)) {
    reject(
      `${where}.play`,
      play,
      `must be one of ${PLAY_MODES.map((mode) => `'${mode}'`).join(', ')}`,
    );
  }
  const fileCount = FILE_COUNTS[play];
  const unit = fileCount.max === 1 ? 'file' : 'files';
  const files = listOf(
    value.files,
    `${where}.files`,
    `must list ${countText(fileCount)} ${unit} for play '${play}'`,
    fileCount,
  ).map((file, i) => parseFile(file, `${where}.files[${i + 1}]`, paths));
  return {
    name,
    library,
    files,
    play,
    volume: parseVolume(value.volume, `${where}.volume`),
    pitch: parsePitch(value.pitch, `${where}.pitch`),
    loudnessLufs: parseLoudness(value.loudness_lufs, `${where}.loudness_lufs`),
    driveUrl: parseDriveUrl(value.drive_url, `${where}.drive_url`),
  };
}

function parseMoment(
  value: unknown,
  where: string,
  paths: PickerPaths,
): AudioMoment {
  if (!isJsonObject(value)) {
    reject(where, value, 'must be an object');
  }
  const title = requiredText(value, 'title', `${where}.title`);
  const reason = requiredText(value, 'reason', `${where}.reason`);
  const candidates = listOf(
    value.candidates,
    `${where}.candidates`,
    `must list 1 to ${MAX_CANDIDATES} candidates`,
    { min: 1, max: MAX_CANDIDATES },
  ).map((candidate, i) =>
    parseCandidate(candidate, `${where}.candidates[${i + 1}]`, paths),
  );
  const { recommend } = value;
  const isCandidateNumber =
    typeof recommend === 'number' &&
    Number.isInteger(recommend) &&
    recommend >= 1 &&
    recommend <= candidates.length;
  if (!isCandidateNumber) {
    reject(
      `${where}.recommend`,
      recommend,
      `must be an integer from 1 to ${candidates.length}, a 1-based candidate`,
    );
  }
  return { title, reason, candidates, recommend };
}

function parseOverview(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    reject('overview', value, 'must be a string');
  }
  return value.trim();
}

// Every error fires here, before anything is shown, so a malformed picker
// costs the caller one retry and the user sees nothing. Messages name each
// list entry 1-based. Whether each file exists is `withAudioFileCheck`'s.
export function parseAudioPicker(
  args: unknown,
  paths: PickerPaths,
): AudioPickerForm {
  if (!isJsonObject(args)) {
    reject('args', args, "must be an object with 'heading' and 'moments'");
  }
  const heading = requiredText(args, 'heading', 'heading');
  const overview = parseOverview(args.overview);
  const moments = listOf(
    args.moments,
    'moments',
    `must list 1 to ${MAX_MOMENTS} moments`,
    { min: 1, max: MAX_MOMENTS },
  ).map((moment, i) => parseMoment(moment, `moments[${i + 1}]`, paths));
  return { heading, overview, moments };
}

// The whole parsed form: a change to any file, volume, pitch or the heading is
// a new picker, and a re-send of the same args re-attaches.
export function audioPickerFingerprint(form: AudioPickerForm): string {
  return createHash('sha256')
    .update(JSON.stringify(form), 'utf8')
    .digest('hex');
}

export function savedAudioPickerHeading(args: unknown): string | null {
  const heading = isJsonObject(args) ? args.heading : undefined;
  return typeof heading === 'string' && heading.trim() !== ''
    ? heading.trim()
    : null;
}

function readAnswer(moment: AudioMoment, raw: unknown): MomentAnswer {
  const sent = isJsonObject(raw) ? raw : {};
  const { choice, note } = sent;
  const isChoice =
    typeof choice === 'number' &&
    Number.isInteger(choice) &&
    choice >= 0 &&
    choice <= moment.candidates.length;
  return {
    choice: isChoice ? choice : moment.recommend,
    note: typeof note === 'string' ? note : '',
  };
}

// The page's answers by moment index; any answer missing or malformed takes
// the moment's recommendation with an empty note.
export function readAudioPickerBody(
  form: AudioPickerForm,
  raw: unknown,
): AudioPickerBody {
  const sent =
    isJsonObject(raw) && Array.isArray(raw.answers) ? raw.answers : [];
  return {
    answers: form.moments.map((moment, i) => readAnswer(moment, sent[i])),
  };
}

// Every moment on its recommended candidate: the body a headless session's
// picker is answered with.
export function recommendedBody(form: AudioPickerForm): AudioPickerBody {
  return readAudioPickerBody(form, {});
}

function picksOf(form: AudioPickerForm, body: AudioPickerBody): AudioPick[] {
  const read = readAudioPickerBody(form, body);
  return form.moments.map((moment, i) => {
    const { choice, note } = read.answers[i];
    return {
      moment: moment.title,
      choice,
      candidate: choice === 0 ? null : moment.candidates[choice - 1],
      note,
    };
  });
}

function summarise(picks: AudioPick[], stillOpen: boolean): string {
  const noneOfThese = picks.filter((pick) => pick.choice === 0).length;
  const moments = picks.length === 1 ? 'moment' : 'moments';
  const line =
    `${picks.length} ${moments}: ${picks.length - noneOfThese} chosen, ` +
    `${noneOfThese} None of these.`;
  return stillOpen ? `${line} The picker is still open.` : line;
}

// The tool result for a picker that ran: one pick per moment, in form order.
export function audioPickerPayload(
  form: AudioPickerForm,
  outcome: AgentFormEndKind | 'draft',
  body: AudioPickerBody,
): AudioPickerPayload {
  const picks = picksOf(form, body);
  return {
    outcome,
    summary: summarise(picks, outcome === 'draft'),
    next: NEXT_BY_OUTCOME[outcome],
    picks,
  };
}

// A picker the app answered with `body` and never showed.
export function autoAnsweredPayload(
  form: AudioPickerForm,
  body: AudioPickerBody,
): AudioPickerPayload {
  return {
    ...audioPickerPayload(form, 'submitted', body),
    outcome: 'auto_answered',
    next: NEXT_ON_AUTO_ANSWERED,
  };
}

// An earlier picker's finished picks, returned by an open_audio_picker that
// did not open its own picker.
export function audioPickerHandedBackPayload(
  form: AudioPickerForm,
  outcome: AgentFormEndKind,
  body: AudioPickerBody,
): AudioPickerPayload {
  const { heading } = form;
  return {
    ...audioPickerPayload(form, outcome, body),
    next:
      `These picks are for an earlier audio picker, '${heading}', that you ` +
      `never received. Read them as that picker's picks. The picker you just ` +
      `sent was not opened: send it again with open_audio_picker.`,
    earlier_heading: heading,
  };
}

// collect_last_audio_picker with nothing to collect: a normal payload, not an
// error.
export function noAudioPickerPayload(): AudioPickerPayload {
  return {
    outcome: 'no_audio_picker',
    summary: 'No audio picker is open.',
    next: NEXT_ON_NO_AUDIO_PICKER,
  };
}

// The draft a call returns when its picker was never shown, so it holds the
// agent's own recommendations; it names the blocking picker, when one is open,
// for the agent to point the user at.
export function audioPickerNotShownPayload(
  form: AudioPickerForm,
  blockingHeading: string | null,
): AudioPickerPayload {
  const other =
    blockingHeading === null
      ? 'another audio picker'
      : `the audio picker '${blockingHeading}'`;
  return {
    ...audioPickerPayload(form, 'draft', recommendedBody(form)),
    summary:
      `This audio picker, '${form.heading}', was not shown: ${other} is ` +
      `still open in the app.`,
    next:
      `The user has not finished ${other} in the app, so this picker was not ` +
      `opened and has no picks. Send this picker again with ` +
      `open_audio_picker, and again after every draft like this one. Once ` +
      `the user finishes ${other}, a send may return that picker's picks ` +
      `instead, marked with earlier_heading: act on them, then send this ` +
      `picker again. If ${other} is no longer needed, ask the user to cancel ` +
      `it in the app. ` +
      `Do not call collect_last_audio_picker for this picker: that returns ` +
      `the other picker's picks.`,
  };
}
