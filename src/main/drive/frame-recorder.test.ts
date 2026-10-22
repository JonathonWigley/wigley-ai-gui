import { describe, expect, it } from 'vitest';
import type { Files } from '../../contracts/files';
import { FakeProcesses } from '../../shared/fake-processes';
import { createMemoryFiles } from '../../shared/memory-files';
import { fakeDrivenWindow } from './fake-driven-window';
import { createFrameRecorder } from './frame-recorder';

const RUN_DIR = '/run';
const FRAMES = '/run/videos/demo-frames';
const LIST = `${FRAMES}/frames.txt`;
const VIDEO = '/run/videos/demo.mp4';

describe('createFrameRecorder', () => {
  it('stop_FramesAt0And40And100Ms_ListsTheirDurationsAndRunsFfmpegOnce', async () => {
    const { window, paint } = fakeDrivenWindow();
    const stored = createMemoryFiles();
    // The list goes with the frames folder, so the test keeps what was
    // written.
    const written = new Map<string, string>();
    const files: Files = {
      ...stored,
      write: async (path, text) => {
        written.set(path, text);
        await stored.write(path, text);
      },
    };
    const processes = new FakeProcesses();
    const ffmpegArgs = [
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
    processes.script('ffmpeg', ffmpegArgs, { code: 0, stdout: '', stderr: '' });
    const recorder = createFrameRecorder({
      window,
      files,
      processes,
      runDir: RUN_DIR,
    });

    recorder.start('demo');
    paint(new Uint8Array([1]), 1000);
    paint(new Uint8Array([2]), 1040);
    paint(new Uint8Array([3]), 1100);
    const video = await recorder.stop();

    const durations = (written.get(LIST) ?? '')
      .split('\n')
      .filter((line) => line.startsWith('duration '))
      .map((line) => Number(line.slice('duration '.length)));
    expect(durations).toEqual([0.04, 0.06, 0.1]);
    expect(processes.runs).toHaveLength(1);
    expect(processes.runs[0].args).toEqual(ffmpegArgs);
    expect(video).toBe(VIDEO);
    expect(await files.stat(FRAMES)).toBeNull();
  });
});
