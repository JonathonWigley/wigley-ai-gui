import { describe, expect, it, vi } from 'vitest';
import type { CaptureWindow, WindowList } from '../../contracts/screen-capture';
import { createScreenCapture, type OsWindow } from './screen-capture';

const FRONT: OsWindow = {
  number: 31,
  processId: 701,
  title: 'Front',
  bounds: { x: 10, y: 20, width: 300, height: 400 },
};
const MIDDLE: OsWindow = {
  number: 40,
  processId: 802,
  title: 'Middle',
  bounds: { x: 50, y: 60, width: 700, height: 500 },
};
const BACK: OsWindow = {
  number: 52,
  processId: 701,
  title: 'Back',
  bounds: { x: 90, y: 110, width: 1200, height: 800 },
};
const SHORT_NUMBER: OsWindow = { ...FRONT, number: 12, title: 'Twelve' };
const LONG_NUMBER: OsWindow = { ...MIDDLE, number: 123, title: 'Long' };

function captureOf(window: OsWindow, sourceId: string): CaptureWindow {
  return {
    sourceId,
    processId: window.processId,
    title: window.title,
    bounds: window.bounds,
  };
}

function depsOf(
  access: 'granted' | 'blocked',
  blockedWhenNoSources: boolean,
  windows: readonly OsWindow[],
  sourceIds: readonly string[],
) {
  return {
    windows: { list: vi.fn(async () => windows) },
    sources: vi.fn(async () => sourceIds.map((id) => ({ id }))),
    access: vi.fn(() => access),
    blockedWhenNoSources,
    openSettings: vi.fn(async () => {}),
  };
}

describe('createScreenCapture', () => {
  it.each<{
    case: string;
    access: 'granted' | 'blocked';
    blockedWhenNoSources: boolean;
    windows: readonly OsWindow[];
    sourceIds: readonly string[];
    expected: WindowList;
    osReads: number;
  }>([
    {
      case: 'access blocked',
      access: 'blocked',
      blockedWhenNoSources: true,
      windows: [FRONT, MIDDLE],
      sourceIds: ['window:31:0', 'window:40:0'],
      expected: { access: 'blocked' },
      osReads: 0,
    },
    {
      case: 'sources for two of three windows',
      access: 'granted',
      blockedWhenNoSources: true,
      windows: [FRONT, MIDDLE, BACK],
      sourceIds: ['window:52:0', 'screen:1:0', 'window:31:0'],
      expected: {
        access: 'granted',
        windows: [
          captureOf(FRONT, 'window:31:0'),
          captureOf(BACK, 'window:52:0'),
        ],
      },
      osReads: 1,
    },
    {
      case: 'no window source where that means no grant',
      access: 'granted',
      blockedWhenNoSources: true,
      windows: [FRONT, MIDDLE],
      sourceIds: ['screen:1:0'],
      expected: { access: 'blocked' },
      osReads: 1,
    },
    {
      case: 'no window source where access is always granted',
      access: 'granted',
      blockedWhenNoSources: false,
      windows: [FRONT, MIDDLE],
      sourceIds: ['screen:1:0'],
      expected: { access: 'granted', windows: [] },
      osReads: 1,
    },
    {
      case: "a window number that prefixes another's",
      access: 'granted',
      blockedWhenNoSources: false,
      windows: [SHORT_NUMBER, LONG_NUMBER],
      sourceIds: ['window:123:0'],
      expected: {
        access: 'granted',
        windows: [captureOf(LONG_NUMBER, 'window:123:0')],
      },
      osReads: 1,
    },
  ])(
    'screenCapture_ListsTheWindowsWithASource: $case',
    async ({
      access,
      blockedWhenNoSources,
      windows,
      sourceIds,
      expected,
      osReads,
    }) => {
      const deps = depsOf(access, blockedWhenNoSources, windows, sourceIds);

      const list = await createScreenCapture(deps).listWindows();

      expect({
        list,
        windowLists: deps.windows.list.mock.calls.length,
        sourceLists: deps.sources.mock.calls.length,
      }).toEqual({
        list: expected,
        windowLists: osReads,
        sourceLists: osReads,
      });
    },
  );

  it.each<{ case: string; rejecting: 'windows' | 'sources' }>([
    { case: 'the window lister', rejecting: 'windows' },
    { case: 'the sources', rejecting: 'sources' },
  ])('screenCapture_RejectsWithTheOsError: $case', async ({ rejecting }) => {
    const failure = new Error('osascript exited with code 1: no access');
    const deps = depsOf('granted', true, [FRONT], ['window:31:0']);
    if (rejecting === 'windows') {
      deps.windows.list.mockRejectedValue(failure);
    } else {
      deps.sources.mockRejectedValue(failure);
    }

    await expect(createScreenCapture(deps).listWindows()).rejects.toBe(failure);
  });
});
