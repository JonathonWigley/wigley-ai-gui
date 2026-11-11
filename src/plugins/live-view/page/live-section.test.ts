import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { LivePick } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, LiveViewInput } from '../layouts/layout';
import { createLiveSection } from './live-section';

const SESSION = 'row-1';

// A portrait Game View cut from a landscape editor window.
const STREAM_PICK: LivePick = {
  kind: 'stream',
  sourceId: 'window:7:0',
  summary: 'Game View · proj',
  windowSize: { width: 1000, height: 500 },
  crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.5 },
};

const BLOCKED_PICK: LivePick = { kind: 'blocked' };

// A macrotask, so every pending promise chain settles first.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// A `<video>` that counts `play` calls and takes a stream size the test sets.
class FakeVideo extends FakeElement {
  srcObject: unknown = null;
  videoWidth = 0;
  videoHeight = 0;
  plays = 0;

  play() {
    this.plays += 1;
    return Promise.resolve();
  }
}

// A track that records `stop` in `events`, and fires `ended` on `end`.
class FakeTrack {
  readyState = 'live';
  private endedListeners: (() => void)[] = [];

  constructor(private readonly events: string[]) {}

  stop() {
    this.readyState = 'ended';
    this.events.push('stop');
  }

  addEventListener(type: string, listener: () => void) {
    if (type === 'ended') {
      this.endedListeners.push(listener);
    }
  }

  end() {
    this.readyState = 'ended';
    for (const listener of this.endedListeners) {
      listener();
    }
  }
}

interface PendingOpen {
  sourceId: string;
  resolve(media: MediaStream): void;
  reject(error: unknown): void;
}

// A section built for SESSION over a pick the test sets, drawn by a user
// layout whose part is `userPart`, else one that records each input.
// `openStream` stays pending until the test resolves it, and the intersection
// hook reports what the test says, to every slot drawn and not yet disposed.
// `events` records each open and each track stop, in order.
function setUp(
  initial: LivePick | undefined,
  userPart?: Layout['liveView'],
) {
  let pick = initial;
  let isVisible = true;
  const events: string[] = [];
  const logged: string[] = [];
  const inputs: LiveViewInput[] = [];
  const opens: PendingOpen[] = [];
  const videos: FakeVideo[] = [];
  const observed: {
    target: HTMLElement;
    report: (isIntersecting: boolean) => void;
    isDisposed: boolean;
  }[] = [];
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'video') {
        return new FakeElement(tag);
      }
      const video = new FakeVideo(tag);
      videos.push(video);
      return video;
    },
    createElementNS: (_namespace: string, tag: string) => new FakeElement(tag),
  });
  const section = createLiveSection({
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys: recordingAnchors().keys,
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: () => undefined,
      },
      platform: 'macos',
      state: noLayoutState,
    },
    log: (message) => logged.push(message),
    nameOf: () => 'proj',
    pick: () => pick,
    openStream: (sourceId) =>
      new Promise((resolve, reject) => {
        events.push('open');
        opens.push({ sourceId, resolve, reject });
      }),
    observeIntersection: (target, report) => {
      const observation = { target, report, isDisposed: false };
      observed.push(observation);
      return {
        dispose: () => {
          observation.isDisposed = true;
        },
      };
    },
    isPageVisible: () => isVisible,
  });
  const recording: Layout = {
    liveView:
      userPart ??
      ((parent, input, kit) => {
        inputs.push(input);
        const element = kit.el(parent, 'div', 'recorded-live-view');
        const videoSlot = kit.el(element, 'div', 'recorded-slot');
        return { element, videoSlot };
      }),
  };
  section.setLayouts(withUser<Layout>(defaultLayout, recording));
  const parent = new FakeElement('div');
  const summaries: (string | null)[] = [];
  const built = section.part.build(asHtml(parent), SESSION, {
    setSummary: (text) => summaries.push(text),
  });
  const video = () => videos.at(-1)!;
  return {
    section,
    built,
    parent,
    summaries,
    logged,
    inputs,
    opens,
    events,
    video,
    setPick(next: LivePick | undefined) {
      pick = next;
      section.pickUpdated(SESSION);
    },
    setVisible(next: boolean) {
      isVisible = next;
      section.pageVisibilityChanged();
    },
    intersect(isIntersecting: boolean) {
      for (const each of observed.filter(({ isDisposed }) => !isDisposed)) {
        each.report(isIntersecting);
      }
    },
    // Resolves the open at `index`, the last when left out, with a stream of
    // one video track.
    async resolveOpen(index = opens.length - 1) {
      const track = new FakeTrack(events);
      const media = {
        getTracks: () => [track],
        getVideoTracks: () => [track],
      } as unknown as MediaStream;
      opens[index]!.resolve(media);
      await settle();
      return { track, media };
    },
    // Reports the stream's size as the video's first metadata.
    loadMetadata(width: number, height: number) {
      const shown = video();
      shown.videoWidth = width;
      shown.videoHeight = height;
      shown.fire('loadedmetadata');
    },
  };
}

type Section = ReturnType<typeof setUp>;

// Opens SESSION's stream on screen and returns its track.
async function streaming(live: Section) {
  live.intersect(true);
  const { track } = await live.resolveOpen();
  return track;
}

describe('createLiveSection', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('build_NoPick_DrawsNothing', () => {
    const live = setUp(undefined);

    expect(live.parent.childNodes).toEqual([]);
    expect(live.summaries).toEqual([null]);
  });

  it('blockedPick_DrawsTheBlockedNoticeAndOpensNoStream', () => {
    const live = setUp(BLOCKED_PICK);
    live.intersect(true);

    expect(live.inputs.at(-1)).toEqual({
      notice: {
        text: 'Screen Recording is off for Auri. Turn it on in System Settings, then restart Auri.',
        action: {
          label: 'Open System Settings',
          command: 'live-view.openScreenSettings',
        },
      },
    });
    expect([live.video().hidden, live.opens.length, live.summaries]).toEqual([
      true,
      0,
      [null],
    ]);
  });

  it('streamPick_OpensOnlyWhileIntersecting_AndLogsEachChange', async () => {
    const live = setUp(undefined);
    live.setPick(STREAM_PICK);
    const opensOffScreen = live.opens.length;

    live.intersect(true);
    const { track } = await live.resolveOpen();
    live.loadMetadata(1000, 500);
    live.intersect(false);

    expect({
      opensOffScreen,
      opens: live.opens.map(({ sourceId }) => sourceId),
      trackState: track.readyState,
      source: live.video().srcObject,
      summary: live.summaries.at(-1),
      logged: live.logged,
    }).toEqual({
      opensOffScreen: 0,
      opens: ['window:7:0'],
      trackState: 'ended',
      source: null,
      summary: 'Game View · proj',
      logged: ['streaming Game View · proj in proj', 'stream stopped in proj'],
    });
  });

  it('pickDeleted_StopsTheStreamAndDrawsNothing', async () => {
    const live = setUp(STREAM_PICK);
    const track = await streaming(live);

    live.setPick(undefined);

    expect([
      track.readyState,
      live.parent.childNodes.length,
      live.summaries.at(-1),
    ]).toEqual(['ended', 0, null]);
  });

  it.each([
    {
      name: 'same shape',
      size: [2000, 1000],
      notice: null,
      viewBox: 'inset(10% 25% 40% 25%)',
    },
    {
      name: 'resized editor',
      size: [1200, 900],
      notice: {
        text: 'The Game View moved. Live shows the whole editor until the agent shows it again.',
        action: null,
      },
      viewBox: 'none',
    },
  ])(
    'firstFrame_StreamShape_DropsTheCropOnlyWhenMoved: $name',
    async ({ size, notice, viewBox }) => {
      const live = setUp(STREAM_PICK);
      const track = await streaming(live);

      live.loadMetadata(size[0]!, size[1]!);

      expect({
        notice: live.inputs.at(-1)!.notice,
        viewBox: live.video().style['object-view-box'],
        trackState: track.readyState,
      }).toEqual({ notice, viewBox, trackState: 'live' });
    },
  );

  it('rowRemoved_StopsTheStreamAndForgetsTheSection', async () => {
    const live = setUp(STREAM_PICK);
    const track = await streaming(live);

    live.section.forget(SESSION);
    live.setPick({ ...STREAM_PICK });
    live.setVisible(true);

    expect([track.readyState, live.opens.length]).toEqual(['ended', 1]);
  });

  it('trackEnded_ShowsClosedAndOpensNothingUntilANewPick', async () => {
    const live = setUp(STREAM_PICK);
    const track = await streaming(live);

    track.end();
    live.intersect(false);
    live.intersect(true);
    const closed = {
      notice: live.inputs.at(-1)!.notice,
      hidden: live.video().hidden,
      opens: live.opens.length,
    };
    live.setPick({ ...STREAM_PICK });

    expect({ closed, opensAfterNewPick: live.opens.length }).toEqual({
      closed: {
        notice: { text: 'The editor window closed.', action: null },
        hidden: true,
        opens: 1,
      },
      opensAfterNewPick: 2,
    });
  });

  it('openRejects_ShowsAndLogsTheOpenFailedNotice_AndOpensNothingUntilANewPick', async () => {
    const live = setUp(STREAM_PICK);
    live.intersect(true);

    live.opens[0]!.reject(new Error('Permission denied'));
    await settle();
    live.intersect(false);
    live.intersect(true);
    const failed = {
      notice: live.inputs.at(-1)!.notice,
      hidden: live.video().hidden,
      logged: [...live.logged],
      opens: live.opens.length,
    };
    live.setPick({ ...STREAM_PICK });

    const text = 'Live could not start the stream: Permission denied';
    expect({ failed, opensAfterNewPick: live.opens.length }).toEqual({
      failed: {
        notice: { text, action: null },
        hidden: true,
        logged: [`notice in proj: ${text}`],
        opens: 1,
      },
      opensAfterNewPick: 2,
    });
  });

  it('pageHidden_StopsTheStream_VisibleOpensOneAgain', async () => {
    const live = setUp(STREAM_PICK);
    const track = await streaming(live);

    live.setVisible(false);
    const stateWhileHidden = track.readyState;
    live.setVisible(true);
    live.setVisible(true);

    expect([stateWhileHidden, live.opens.length]).toEqual(['ended', 2]);
  });

  it('pickReplaced_StopsTheOldTracksBeforeTheNewOpen', async () => {
    const live = setUp(STREAM_PICK);
    await streaming(live);

    live.setPick({ ...STREAM_PICK, sourceId: 'window:8:0' });

    expect([live.events, live.opens.at(-1)!.sourceId]).toEqual([
      ['open', 'stop', 'open'],
      'window:8:0',
    ]);
  });

  it.each([
    { name: 'pick deleted', goAway: (live: Section) => live.setPick(undefined) },
    { name: 'section disposed', goAway: (live: Section) => live.built.dispose() },
    {
      name: 'session forgotten',
      goAway: (live: Section) => live.section.forget(SESSION),
    },
    { name: 'page hidden', goAway: (live: Section) => live.setVisible(false) },
  ])(
    'openInFlight_ReasonGone_StopsItsTracksOnResolveAndSetsNothing: $name',
    async ({ goAway }) => {
      const live = setUp(STREAM_PICK);
      live.intersect(true);

      goAway(live);
      const { track } = await live.resolveOpen(0);

      expect([track.readyState, live.video().srcObject, live.logged]).toEqual([
        'ended',
        null,
        [],
      ]);
    },
  );

  it('twoSectionsOnOneSession_PickDeleted_StopsBothStreams', async () => {
    const live = setUp(STREAM_PICK);
    live.section.part.build(asHtml(new FakeElement('div')), SESSION, {
      setSummary: () => undefined,
    });
    live.intersect(true);
    const first = await live.resolveOpen(0);
    const second = await live.resolveOpen(1);

    live.setPick(undefined);

    expect([
      live.opens.length,
      first.track.readyState,
      second.track.readyState,
    ]).toEqual([2, 'ended', 'ended']);
  });

  it.each([
    {
      name: 'no videoSlot',
      userPart: ((parent, _input, kit) => ({
        element: kit.el(parent, 'div', 'bad-live-view'),
      })) as Layout['liveView'],
    },
    {
      name: 'videoSlot outside its element',
      userPart: ((parent, _input, kit) => ({
        element: kit.el(parent, 'div', 'bad-live-view'),
        videoSlot: asHtml(new FakeElement('div')),
      })) as Layout['liveView'],
    },
  ])(
    'userPartBadVideoSlot_DrawsDefaultWithTheVideoInIt: $name',
    ({ userPart }) => {
      const live = setUp(STREAM_PICK, userPart);

      const [drawn] = live.parent.childNodes;
      expect({
        drawn: live.parent.childNodes.length,
        layout: drawn?.dataset.layout,
        hasVideo: drawn?.contains(live.video()),
      }).toEqual({ drawn: 1, layout: 'default', hasVideo: true });
    },
  );

  it('noticeRedraw_MovesTheSameVideoIntoTheNewSlotAndPlaysOnce', async () => {
    const live = setUp(STREAM_PICK);
    await streaming(live);
    const firstSlot = live.video().parentNode;
    const playsBefore = live.video().plays;

    live.loadMetadata(1200, 900);

    const [slot] = findAll(live.parent, 'recorded-slot');
    expect({
      isNewSlot: slot !== firstSlot,
      isInSlot: live.video().parentNode === slot,
      plays: live.video().plays - playsBefore,
    }).toEqual({ isNewSlot: true, isInSlot: true, plays: 1 });
  });

  it('crop_SetsTheViewBoxInsetAndTheCroppedShape', () => {
    const live = setUp(STREAM_PICK);

    expect([
      live.video().style['object-view-box'],
      live.video().style.aspectRatio,
    ]).toEqual(['inset(10% 25% 40% 25%)', '2']);
  });
});
