import type { Timers } from '../../../contracts/ambient';
import { themeVariable } from '../../../shared/theme-variables';

// A source id the fake ScreenCapture hands out for a window of that size,
// `sample:<width>x<height>`.
const SAMPLE_PREFIX = 'sample:';
const SAMPLE_SIZE = /^(\d+)x(\d+)$/;

const SAMPLE_TEXT = 'Live sample';
// Grid squares across the card's shorter side.
const GRID_SQUARES = 8;
// How far the sweeping bar moves each frame, in canvas pixels.
const SWEEP_STEP = 4;
// Below 1, the sample card redraws in a tight loop and a desktop capture fails.
const MIN_FRAME_RATE = 1;

// `timers` ticks a sample source's test card.
export interface StreamSourceDeps {
  timers: Timers;
}

// `openStream` opens the stream of a capture source at most `frameRate`
// frames a second, 1 at least: a sample source's moving test card, drawn on a
// canvas, or the desktop capture of any other source.
export interface StreamSource {
  openStream(sourceId: string, frameRate: number): Promise<MediaStream>;
}

export function createStreamSource(deps: StreamSourceDeps): StreamSource {
  return {
    async openStream(sourceId, frameRate) {
      const rate = Math.max(MIN_FRAME_RATE, frameRate);
      if (sourceId.startsWith(SAMPLE_PREFIX)) {
        return sampleStream(
          sourceId.slice(SAMPLE_PREFIX.length),
          rate,
          deps.timers,
        );
      }
      return desktopStream(sourceId, rate);
    },
  };
}

function desktopStream(
  sourceId: string,
  frameRate: number,
): Promise<MediaStream> {
  // Electron's desktop capture takes Chromium's `mandatory` constraints, which
  // the DOM types lack.
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: frameRate,
      },
    },
  };
  return navigator.mediaDevices.getUserMedia(
    constraints as unknown as MediaStreamConstraints,
  );
}

// The canvas's stream, its test card drawn `frameRate` times a second from
// now until its track stops or ends.
function sampleStream(
  size: string,
  frameRate: number,
  timers: Timers,
): MediaStream {
  const match = SAMPLE_SIZE.exec(size);
  if (match === null) {
    throw new Error(`sample source size "${size}" is not <width>x<height>`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Number(match[1]);
  canvas.height = Number(match[2]);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('the sample source has no 2d canvas context');
  }
  const stream = canvas.captureStream(frameRate);
  const [track] = stream.getVideoTracks();
  // Live: it reads the theme as it is at each frame.
  const theme = getComputedStyle(document.documentElement);
  let frame = 0;
  const tick = () => {
    if (track?.readyState !== 'live') {
      return;
    }
    drawTestCard(context, theme, frame);
    frame += 1;
    timers.set(tick, 1000 / frameRate);
  };
  tick();
  return stream;
}

// A test card that changes every frame, so a frozen stream shows: the theme's
// block background, a grid, a bar sweeping across, `Live sample` and the
// frame's number.
function drawTestCard(
  context: CanvasRenderingContext2D,
  theme: CSSStyleDeclaration,
  frame: number,
) {
  const { width, height } = context.canvas;
  const square = Math.max(
    1,
    Math.round(Math.min(width, height) / GRID_SQUARES),
  );
  context.fillStyle = themeColour(theme, 'block-background');
  context.fillRect(0, 0, width, height);
  context.strokeStyle = themeColour(theme, 'border-subtle');
  context.lineWidth = 1;
  context.beginPath();
  for (let x = square; x < width; x += square) {
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
  }
  for (let y = square; y < height; y += square) {
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
  }
  context.stroke();
  context.fillStyle = themeColour(theme, 'accent');
  context.fillRect((frame * SWEEP_STEP) % width, 0, square / 4, height);
  context.fillStyle = themeColour(theme, 'fg');
  context.font = `${Math.round(square / 2)}px ${theme.getPropertyValue(themeVariable('font-ui'))}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(SAMPLE_TEXT, width / 2, height / 2);
  context.fillText(String(frame), width / 2, height / 2 + square);
}

function themeColour(theme: CSSStyleDeclaration, token: string): string {
  return theme.getPropertyValue(themeVariable(token)).trim();
}
