import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Files } from '../../contracts/files';
import { FakeProcesses } from '../../shared/fake-processes';
import { createMemoryFiles } from '../../shared/memory-files';
import { fakeDrivenWindow } from './fake-driven-window';
import { createFrameRecorder } from './frame-recorder';

const RUN_DIR = '/run';
const FRAMES = '/run/videos/demo-frames';
const LIST = `${FRAMES}/frames.txt`;
const VIDEO = '/run/videos/demo.mp4';
const FFMPEG_ARGS = [
  '-y',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  LIST,
  '-fps_mode',
  'vfr',
  '-vf',
  'pad=ceil(iw/2)*2:ceil(ih/2)*2',
  '-pix_fmt',
  'yuv420p',
  VIDEO,
];

// A recorder over a fake window, with ffmpeg answering success to the demo
// recording's arguments. The list goes with the frames folder, so `written`
// keeps each text file written.
function setUp() {
  const fake = fakeDrivenWindow();
  const stored = createMemoryFiles();
  const written = new Map<string, string>();
  const files: Files = {
    ...stored,
    write: async (path, text) => {
      written.set(path, text);
      await stored.write(path, text);
    },
  };
  const processes = new FakeProcesses();
  processes.script('ffmpeg', FFMPEG_ARGS, {
    code: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  });
  const recorder = createFrameRecorder({
    window: fake.window,
    files,
    processes,
    runDir: RUN_DIR,
  });
  return { fake, files, written, processes, recorder };
}

// The `file` and `duration` lines of the concat list, in order.
function listLines(written: Map<string, string>, prefix: string): string[] {
  return (written.get(LIST) ?? '')
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createFrameRecorder', () => {
  it('stop_FramesAt0And40And100MsStoppedAt250_ListsTheirDurationsUntilTheStopAndRunsFfmpegOnce', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const { fake, files, written, processes, recorder } = setUp();

    recorder.start('demo');
    fake.paint(new Uint8Array([1]), 1000);
    fake.paint(new Uint8Array([2]), 1040);
    fake.paint(new Uint8Array([3]), 1100);
    vi.setSystemTime(1250);
    const video = await recorder.stop();

    expect(listLines(written, 'duration ').map(Number)).toEqual([
      0.04, 0.06, 0.15,
    ]);
    expect(processes.runs).toHaveLength(1);
    expect(processes.runs[0].args).toEqual(FFMPEG_ARGS);
    expect(video).toBe(VIDEO);
    expect(await files.stat(FRAMES)).toBeNull();
  });

  it('stop_StillPageCapturedAtStartAndNothingPainted_ShowsTheStartFrameUntilTheStop', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const { fake, written, recorder } = setUp();
    fake.screen.captured = new Uint8Array([9]);

    recorder.start('demo');
    vi.setSystemTime(1500);
    const video = await recorder.stop();

    expect(listLines(written, 'file ')).toEqual([
      `'${FRAMES}/start.png'`,
      `'${FRAMES}/start.png'`,
    ]);
    expect(listLines(written, 'duration ').map(Number)).toEqual([0.5]);
    expect(video).toBe(VIDEO);
  });

  it('start_NameLeavingTheVideosFolder_ThrowsAndRecordsNothing', () => {
    const { recorder } = setUp();

    expect(() => recorder.start('../escape')).toThrow('../escape');
    expect(recorder.isRecording()).toBe(false);
  });
});
