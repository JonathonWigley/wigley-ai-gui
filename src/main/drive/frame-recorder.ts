import path from 'node:path';
import type { Disposable } from '../../contracts/disposable';
import type { Files } from '../../contracts/files';
import type { ProcessRunner } from '../../contracts/processes';
import type { DrivenWindow } from './driven-window';
import { SCREENSHOT_NAME } from './page-driver';

// Records the frames a window paints into an MP4 under `<runDir>/videos/`.
// Paths are joined with `/`, which every OS's file calls and ffmpeg take.
export interface FrameRecorder {
  // Captures the window as the first frame, then writes each painted frame to
  // `videos/<name>-frames/`; `name` defaults to `recording-<n>`, n counting
  // from 1. Throws while a recording runs, and for a `name` that is not
  // lowercase letters and digits in words joined by -, which could leave
  // `videos/`.
  start(name?: string): void;
  // Ends the recording, encodes its frames through ffmpeg, each frame showing
  // until the next and the last until the stop, so the video lasts as long as
  // the recording ran; removes the frames, and resolves to the MP4's path.
  // Rejects with no recording running, with no frame captured or painted,
  // when ffmpeg is not on PATH, and with ffmpeg's last stderr line when it
  // fails; on a failure the frames folder stays.
  stop(): Promise<string>;
  isRecording(): boolean;
}

export interface FrameRecorderDeps {
  window: DrivenWindow;
  files: Files;
  processes: ProcessRunner;
  runDir: string;
}

interface Frame {
  file: string;
  // Milliseconds since the epoch.
  at: number;
}

interface Recording {
  name: string;
  framesFolder: string;
  // The window as the recording started; null when the capture came back
  // empty or failed.
  startFrame: Promise<Frame | null>;
  frames: Frame[];
  writes: Promise<void>[];
  painting: Disposable;
}

export function createFrameRecorder(deps: FrameRecorderDeps): FrameRecorder {
  const videos = path.posix.join(deps.runDir, 'videos');
  let started = 0;
  let recording: Recording | null = null;
  return {
    start: (name) => {
      if (recording !== null) {
        throw new Error(
          `Already recording ${recording.name}; stop it before starting another`,
        );
      }
      if (name !== undefined && !SCREENSHOT_NAME.test(name)) {
        throw new Error(
          `Recording name "${name}" is not lowercase letters and digits in words joined by -`,
        );
      }
      started += 1;
      const recordingName = name ?? `recording-${started}`;
      const framesFolder = path.posix.join(videos, `${recordingName}-frames`);
      const frames: Frame[] = [];
      const writes: Promise<void>[] = [];
      const painting = deps.window.onFrame((png, at) => {
        const file = path.posix.join(framesFolder, `${frames.length}.png`);
        frames.push({ file, at });
        writes.push(deps.files.writeBytes(file, png()));
      });
      recording = {
        name: recordingName,
        framesFolder,
        startFrame: captureStartFrame(deps, framesFolder),
        frames,
        writes,
        painting,
      };
    },
    stop: async () => {
      if (recording === null) {
        throw new Error('Not recording; `record start` starts one');
      }
      const stoppedAt = Date.now();
      const finished = recording;
      recording = null;
      finished.painting.dispose();
      const startFrame = await finished.startFrame;
      await Promise.all(finished.writes);
      const frames =
        startFrame === null
          ? finished.frames
          : [startFrame, ...finished.frames];
      if (frames.length === 0) {
        throw new Error('No frames captured or painted while recording');
      }
      const list = path.posix.join(finished.framesFolder, 'frames.txt');
      await deps.files.write(list, concatList(frames, stoppedAt));
      const video = path.posix.join(videos, `${finished.name}.mp4`);
      await encode(deps.processes, list, video);
      await deps.files.trash(finished.framesFolder);
      return video;
    },
    isRecording: () => recording !== null,
  };
}

// The window captured into `framesFolder` as `start.png`, stamped with the
// time the capture began; null when the capture is empty or fails, since the
// painted frames still make a video.
async function captureStartFrame(
  deps: FrameRecorderDeps,
  framesFolder: string,
): Promise<Frame | null> {
  const at = Date.now();
  const png = await deps.window.capture().catch(() => null);
  if (png === null) {
    return null;
  }
  const file = path.posix.join(framesFolder, 'start.png');
  await deps.files.writeBytes(file, png);
  return { file, at };
}

// An ffmpeg concat list showing each frame until the next one and the last
// until `stoppedAt`, at least a millisecond. The concat demuxer ignores the
// last entry's duration, so the last file is listed again after it.
function concatList(frames: Frame[], stoppedAt: number): string {
  const lines: string[] = [];
  frames.forEach(({ file, at }, index) => {
    const next = frames[index + 1];
    const durationMs =
      next === undefined ? Math.max(stoppedAt - at, 1) : next.at - at;
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
