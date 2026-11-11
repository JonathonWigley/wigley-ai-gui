import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamSource } from './stream-source';

// Stubs a canvas whose stream records the frame rate it was captured at, a 2d
// context that takes every draw, and `getUserMedia`, which records its
// constraints; returns what each path hands back and records, and the canvas
// stream's track.
function stubMedia() {
  const canvasTrack = { readyState: 'live' };
  const canvasStream = { getVideoTracks: () => [canvasTrack] };
  const desktopStream = { getVideoTracks: () => [] };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    captureStream: vi.fn((_frameRate: number) => canvasStream),
  };
  const context: object = new Proxy(
    { canvas },
    {
      get: (target, key) =>
        key in target ? target[key as 'canvas'] : () => undefined,
      set: () => true,
    },
  );
  const getUserMedia = vi.fn(async (_constraints: unknown) => desktopStream);
  vi.stubGlobal('document', {
    createElement: () => canvas,
    documentElement: {},
  });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  return { canvas, canvasStream, canvasTrack, desktopStream, getUserMedia };
}

describe('createStreamSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'sample source',
      sourceId: 'sample:405x760',
      expected: {
        stream: 'canvas',
        canvasSize: [405, 760],
        capturedAt: [[24]],
        constraints: [],
      },
    },
    {
      name: 'window source',
      sourceId: 'window:7:0',
      expected: {
        stream: 'desktop',
        canvasSize: [0, 0],
        capturedAt: [],
        constraints: [
          {
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: 'window:7:0',
                maxFrameRate: 24,
              },
            },
          },
        ],
      },
    },
  ])('openStream_RoutesBySourceId: $name', async ({ sourceId, expected }) => {
    const media = stubMedia();
    const source = createStreamSource({
      timers: { set: () => 1, clear: () => undefined },
    });

    const stream: unknown = await source.openStream(sourceId, 24);

    expect({
      stream:
        stream === media.canvasStream
          ? 'canvas'
          : stream === media.desktopStream
            ? 'desktop'
            : 'other',
      canvasSize: [media.canvas.width, media.canvas.height],
      capturedAt: media.canvas.captureStream.mock.calls,
      constraints: media.getUserMedia.mock.calls.map((call) => call[0]),
    }).toEqual(expected);
  });

  it('sampleStream_TrackEnded_SchedulesNoFurtherFrame', async () => {
    const media = stubMedia();
    const scheduled: (() => void)[] = [];
    const source = createStreamSource({
      timers: {
        set: (run) => scheduled.push(run),
        clear: () => undefined,
      },
    });

    await source.openStream('sample:405x760', 24);
    const scheduledWhileLive = scheduled.length;
    media.canvasTrack.readyState = 'ended';
    scheduled[0]!();

    expect([scheduledWhileLive, scheduled.length]).toEqual([1, 1]);
  });
});
