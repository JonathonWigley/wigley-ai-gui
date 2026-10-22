import path from 'node:path';
import type { Disposable } from '../../contracts/disposable';
import type { Files } from '../../contracts/files';
import type { ProcessRunner } from '../../contracts/processes';
import type { DrivenWindow } from './driven-window';

// How long the last frame of a recording shows.
const LAST_FRAME_MS = 100;

// Records the frames a window paints into an MP4 under `<runDir>/videos/`.
export interface FrameRecorder {
  // Starts writing each painted frame to `videos/<name>-frames/`; `name`
  // defaults to `recording-<n>`, n counting from 1. Throws while a recording
  // runs.
  start(name?: string): void;
  // Ends the recording, encodes its frames through ffmpeg, each frame showing
  // until the next, removes the frames, and resolves to the MP4's path.
  // Rejects with no recording running, with no frame painted, when ffmpeg is
  // not on PATH, and with ffmpeg's last stderr line when it fails; on a
  // failure the frames folder stays.
  stop(): Promise<string>;
  isRecording(): boolean;
}

export interface FrameRecorderDeps {
  window: DrivenWindow;
  files: Files;
  processes: ProcessRunner;
  runDir: string;
}

interface Recording {
  name: string;
  framesFolder: string;
  frames: { file: string; at: number }[];
  writes: Promise<void>[];
  painting: Disposable;
}

export function createFrameRecorder(deps: FrameRecorderDeps): FrameRecorder {
  const videos = path.join(deps.runDir, 'videos');
  let started = 0;
  let recording: Recording | null = null;
  return {
    start: (name) => {
      if (recording !== null) {
        throw new Error(
          `Already recording ${recording.name}; stop it before starting another`,
        );
      }
      started += 1;
      const recordingName = name ?? `recording-${started}`;
      const framesFolder = path.join(videos, `${recordingName}-frames`);
      const frames: Recording['frames'] = [];
      const writes: Promise<void>[] = [];
      const painting = deps.window.onFrame((png, at) => {
        const file = path.join(framesFolder, `${frames.length}.png`);
        frames.push({ file, at });
        writes.push(deps.files.writeBytes(file, png()));
      });
      recording = {
        name: recordingName,
        framesFolder,
        frames,
        writes,
        painting,
      };
    },
    stop: async () => {
      if (recording === null) {
        throw new Error('Not recording; `record start` starts one');
      }
      const finished = recording;
      recording = null;
      finished.painting.dispose();
      await Promise.all(finished.writes);
      if (finished.frames.length === 0) {
        throw new Error('No frames painted while recording');
      }
      const list = path.join(finished.framesFolder, 'frames.txt');
      await deps.files.write(list, concatList(finished.frames));
      const video = path.join(videos, `${finished.name}.mp4`);
      await encode(deps.processes, list, video);
      await deps.files.trash(finished.framesFolder);
      return video;
    },
    isRecording: () => recording !== null,
  };
}

// An ffmpeg concat list showing each frame until the next one and the last
// for `LAST_FRAME_MS`. The concat demuxer ignores the last entry's duration,
// so the last file is listed again after it.
function concatList(frames: Recording['frames']): string {
  const lines: string[] = [];
  frames.forEach(({ file, at }, index) => {
    const next = frames[index + 1];
    const durationMs = next === undefined ? LAST_FRAME_MS : next.at - at;
    lines.push(
      `file ${quoted(file)}`,
      `duration ${Number((durationMs / 1000).toFixed(3))}`,
    );
  });
  lines.push(`file ${quoted(frames[frames.length - 1].file)}`);
  return `${lines.join('\n')}\n`;
}

// A concat list path in single quotes, each `'` inside written as `'\''`.
function quoted(file: string): string {
  return `'${file.replaceAll("'", "'\\''")}'`;
}

// `-fps_mode vfr` keeps each frame's own duration (ffmpeg 9 dropped
// `-vsync`); the pad evens an odd width or height, which yuv420p H.264 refuses.
function ffmpegArgs(list: string, video: string): string[] {
  return [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-fps_mode',
    'vfr',
    '-vf',
    'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-pix_fmt',
    'yuv420p',
    video,
  ];
}

async function encode(
  processes: ProcessRunner,
  list: string,
  video: string,
): Promise<void> {
  let result;
  try {
    result = await processes.run('ffmpeg', ffmpegArgs(list, video));
  } catch {
    throw new Error('ffmpeg is not on PATH; install it to record video');
  }
  if (result.code !== 0) {
    const lastLine = result.stderr.trim().split('\n').at(-1);
    throw new Error(lastLine || `ffmpeg exited ${result.code}`);
  }
}
