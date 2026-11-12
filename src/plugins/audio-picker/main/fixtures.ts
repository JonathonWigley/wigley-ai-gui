import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import { openFixtureForm } from '../../../shared/agent-forms/drive-actions';
import type { ConnectedSession, ToolResult } from '../../sessions/contract';
import { OPEN_AUDIO_PICKER_TOOL } from '../contract';

// open_audio_picker arguments, as an agent writes them.
export type SamplePickerArgs = {
  heading: string;
  overview: string;
  moments: Record<string, unknown>[];
};

const SAMPLE_RATE = 22050;
const AMPLITUDE = 0.25;
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

// A sine tone as a 16-bit mono PCM WAV at 22050 Hz, amplitude 0.25.
export function sineWav(hz: number, seconds: number): Uint8Array {
  const sampleCount = Math.round(SAMPLE_RATE * seconds);
  const dataBytes = sampleCount * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < sampleCount; i++) {
    const level = AMPLITUDE * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
    view.setInt16(
      WAV_HEADER_BYTES + i * BYTES_PER_SAMPLE,
      Math.round(level * 0x7fff),
      true,
    );
  }
  return bytes;
}

// Every file the sample and preview pickers name; `broken.wav` is not audio,
// so its decode fails.
const SAMPLE_SOUNDS: readonly { file: string; bytes(): Uint8Array }[] = [
  { file: 'tap_a.wav', bytes: () => sineWav(880, 0.15) },
  { file: 'tap_b.wav', bytes: () => sineWav(660, 0.2) },
  { file: 'hum.wav', bytes: () => sineWav(110, 1) },
  { file: 'sparkle_a.wav', bytes: () => sineWav(1320, 0.1) },
  { file: 'sparkle_b.wav', bytes: () => sineWav(1480, 0.1) },
  { file: 'sparkle_c.wav', bytes: () => sineWav(1760, 0.1) },
  { file: 'drone.wav', bytes: () => sineWav(82, 1) },
  { file: 'buzz.wav', bytes: () => sineWav(220, 1) },
  { file: 'chime.wav', bytes: () => sineWav(990, 0.3) },
  { file: 'broken.wav', bytes: () => new TextEncoder().encode('not audio') },
];

// The sample sounds' folder, relative to the plugin's data folder.
const SAMPLE_SOUNDS_FOLDER = 'sample-sounds';

// The full path of the sample sounds' folder in the plugin's data folder
// `dataFolder`, for the files a picker lists.
export function sampleSoundsDir(
  dataFolder: string,
  paths: Pick<Paths, 'join'>,
): string {
  return paths.join(dataFolder, SAMPLE_SOUNDS_FOLDER);
}

// Writes every sample sound into the folder `sampleSoundsDir` names,
// overwriting what is there. `data` is the files service scoped to the
// plugin's data folder (`api.data`), so its paths are `/`-separated and
// relative to that folder.
export async function writeSampleSounds(
  data: Pick<Files, 'writeBytes'>,
): Promise<void> {
  await Promise.all(
    SAMPLE_SOUNDS.map((sound) =>
      data.writeBytes(`${SAMPLE_SOUNDS_FOLDER}/${sound.file}`, sound.bytes()),
    ),
  );
}

// A valid open_audio_picker call over the sample sounds in `dir`: two
// moments, a one-shot pair recommending `tap_a`, and five candidates (the
// most a moment holds, so every row number draws) recommending the loop
// `hum`, the variant set `sparkle` second. Its eight files all decode.
export function samplePickerArgs(
  dir: string,
  paths: Pick<Paths, 'join'>,
): SamplePickerArgs {
  const file = (name: string) => paths.join(dir, name);
  return {
    heading: 'Sample sounds',
    overview: 'A sample picker the tests, the self-test and drive runs open.',
    moments: [
      {
        title: 'Button tap',
        reason: 'A short click that reads as a press.',
        recommend: 1,
        candidates: [
          {
            name: 'tap_a',
            library: 'Sample library',
            files: [file('tap_a.wav')],
            play: 'one-shot',
            volume: 0.8,
            loudness_lufs: -14,
            drive_url: 'https://drive.google.com/file/d/sample-tap-a',
          },
          {
            name: 'tap_b',
            library: 'Sample library',
            files: [file('tap_b.wav')],
            play: 'one-shot',
            volume: 0.8,
            pitch: { min: -2, max: 2 },
          },
        ],
      },
      {
        title: 'Room hum',
        reason: 'A bed under the shop screen.',
        recommend: 1,
        candidates: [
          {
            name: 'hum',
            library: 'Sample library',
            files: [file('hum.wav')],
            play: 'loop',
            volume: 0.4,
          },
          {
            name: 'sparkle',
            library: 'Sample library',
            files: [file('sparkle_a.wav'), file('sparkle_b.wav')],
            play: 'variants',
            volume: 0.6,
            pitch: { min: -1, max: 1 },
          },
          {
            name: 'drone',
            library: 'Sample library',
            files: [file('drone.wav')],
            play: 'loop',
            volume: 0.3,
          },
          {
            name: 'buzz',
            library: 'Sample library',
            files: [file('buzz.wav')],
            play: 'loop',
            volume: 0.3,
          },
          {
            name: 'chime',
            library: 'Sample library',
            files: [file('chime.wav')],
            play: 'one-shot',
            volume: 0.5,
          },
        ],
      },
    ],
  };
}

// Calls open_audio_picker in the session as an agent would, with no tool use
// id and a signal nothing aborts.
export function openFixturePicker(
  session: ConnectedSession,
  args: unknown,
): Promise<ToolResult> {
  return openFixtureForm(session, OPEN_AUDIO_PICKER_TOOL, args);
}
