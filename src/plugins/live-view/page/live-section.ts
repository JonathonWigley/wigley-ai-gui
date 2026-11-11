import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { ShownLayouts } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import type { ChatSidePart, ChatSideSection } from '../../chat/contract';
import type { CaptureCrop, LivePick } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  CompleteLayout,
  Layout,
  LiveViewInput,
  LiveViewPart,
} from '../layouts/layout';
import { liveViewManifest } from '../manifest';
import { streamMoved } from '../window-pick';

const MOVED_TEXT =
  'The Game View moved. Live shows the whole editor until the agent shows it again.';
const CLOSED_TEXT = 'The editor window closed.';
const BLOCKED_TEXT =
  'Screen Recording is off for Auri. Turn it on in System Settings, then restart Auri.';
const OPEN_FAILED_PREFIX = 'Live could not start the stream: ';
const BLOCKED_ACTION = {
  label: 'Open System Settings',
  command: 'live-view.openScreenSettings',
};

type StreamPick = Extract<LivePick, { kind: 'stream' }>;
type Notice = NonNullable<LiveViewInput['notice']>;

// `nameOf` is the session's name in the page log lines; `pick` is a session's
// pick, undefined while its agent shows no Live view. `openStream` opens a
// capture source's stream. `observeIntersection` reports whether `target`
// intersects the viewport, first soon after it starts, until its dispose;
// `isPageVisible` is whether the page's `visibilityState` is `visible`.
export interface LiveSectionDeps {
  kit: OwnerKitServices;
  log: PluginLog;
  nameOf(sessionId: string): string;
  pick(sessionId: string): LivePick | undefined;
  openStream(sourceId: string): Promise<MediaStream>;
  observeIntersection(
    target: HTMLElement,
    report: (isIntersecting: boolean) => void,
  ): Disposable;
  isPageVisible(): boolean;
}

// `part` draws a session's pick into its section of the session hub and
// streams it while the section is on screen. `pickUpdated` redraws a session
// whose pick changed; `pageVisibilityChanged` starts or stops every section's
// stream on the page's visibility; `setLayouts` redraws every section; `forget`
// drops a session that left, and stops its streams.
export interface LiveSection {
  part: ChatSidePart;
  pickUpdated(sessionId: string): void;
  pageVisibilityChanged(): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  forget(sessionId: string): void;
}

// A notice the section raised itself for a session's pick: a later pick
// clears it.
interface RaisedNotice {
  pick: StreamPick;
  kind: 'moved' | 'closed' | 'openFailed';
  text: string;
}

// One section chat built: one per Chat tab showing the session. It keeps its
// own `<video>` across draws, at most one open stream and the pick it
// streams, and at most one open in flight, whose result is dropped once it is
// no longer `opening`.
interface HeldSection {
  readonly sessionId: string;
  readonly parent: HTMLElement;
  readonly section: ChatSideSection;
  readonly video: HTMLVideoElement;
  drawn: DrawnPart<LiveViewPart> | null;
  observing: Disposable | null;
  isIntersecting: boolean;
  stream: { media: MediaStream; pick: StreamPick } | null;
  opening: { pick: StreamPick } | null;
  isDisposed: boolean;
}

// The crop as the inset `object-view-box` cuts from each edge, top first.
function viewBoxOf(crop: CaptureCrop): string {
  const insets = [
    crop.y,
    1 - crop.x - crop.width,
    1 - crop.y - crop.height,
    crop.x,
  ];
  return `inset(${insets.map(percentOf).join(' ')})`;
}

// Rounded so float error (`40.00000000000001%`) stays out of the CSS.
function percentOf(fraction: number): string {
  return `${Math.round(fraction * 1e6) / 1e4}%`;
}

// The shown frame's width over its height: the stream's own once the Game
// View moved and the stream reports a size, as the pick's window size is stale
// then; else the window's, cut to the crop.
function frameAspect(
  pick: StreamPick,
  crop: CaptureCrop | null,
  video: HTMLVideoElement,
  isMoved: boolean,
): number {
  const hasStreamSize = video.videoWidth > 0 && video.videoHeight > 0;
  if (isMoved && hasStreamSize) {
    return video.videoWidth / video.videoHeight;
  }
  const { width, height } = pick.windowSize;
  return crop === null
    ? width / height
    : (width * crop.width) / (height * crop.height);
}

function stopTracks(media: MediaStream) {
  for (const track of media.getTracks()) {
    track.stop();
  }
}

function createVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  video.className = 'live-view-video';
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  return video;
}

// A section with no pick draws nothing, so chat hides it. A pick draws the
// layout's part with its notice, and the section's `<video>` in the part's
// `videoSlot`, hidden with a blocked pick and once a stream closed or failed
// to open. A section streams only while its `videoSlot` intersects the
// viewport, the page is visible, and its pick is a stream with no closed or
// open-failed notice: the stream stops the moment any of these ends, and opens
// again when all hold. Logs `streaming <summary> in <name>` at the stream's
// first metadata, `stream stopped in <name>` when it stops, and
// `notice in <name>: <text>` when a pick's notice first shows.
export function createLiveSection(deps: LiveSectionDeps): LiveSection {
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: liveViewManifest.id,
    defaultLayout,
    log: deps.log,
  });
  const held = new Map<string, Set<HeldSection>>();
  const raised = new Map<string, RaisedNotice>();
  const loggedNotices = new Map<string, { pick: LivePick; text: string }>();

  const raisedFor = (sessionId: string, pick: LivePick | undefined) => {
    const notice = raised.get(sessionId);
    return notice !== undefined && notice.pick === pick ? notice : undefined;
  };

  const noticeOf = (sessionId: string, pick: LivePick): Notice | null => {
    if (pick.kind === 'blocked') {
      return { text: BLOCKED_TEXT, action: BLOCKED_ACTION };
    }
    const notice = raisedFor(sessionId, pick);
    return notice === undefined ? null : { text: notice.text, action: null };
  };

  // Whether a closed or open-failed notice ended the pick's streaming.
  const endedStreaming = (sessionId: string, pick: StreamPick) => {
    const kind = raisedFor(sessionId, pick)?.kind;
    return kind === 'closed' || kind === 'openFailed';
  };

  const wantedPick = (holder: HeldSection): StreamPick | null => {
    const pick = deps.pick(holder.sessionId);
    if (pick?.kind !== 'stream') {
      return null;
    }
    const isOnScreen =
      !holder.isDisposed && holder.isIntersecting && deps.isPageVisible();
    return isOnScreen && !endedStreaming(holder.sessionId, pick) ? pick : null;
  };

  const stopStream = (holder: HeldSection) => {
    const stream = holder.stream;
    if (stream === null) {
      return;
    }
    holder.stream = null;
    holder.video.srcObject = null;
    stopTracks(stream.media);
    deps.log(`stream stopped in ${deps.nameOf(holder.sessionId)}`);
  };

  const openStream = (holder: HeldSection, pick: StreamPick) => {
    const opening = { pick };
    holder.opening = opening;
    void deps.openStream(pick.sourceId).then(
      (media) => {
        if (holder.opening !== opening) {
          stopTracks(media);
          return;
        }
        holder.opening = null;
        holder.stream = { media, pick };
        const [track] = media.getVideoTracks();
        track?.addEventListener('ended', () => trackEnded(holder, media));
        holder.video.srcObject = media;
      },
      (error: unknown) => {
        if (holder.opening !== opening) {
          return;
        }
        holder.opening = null;
        raise(
          holder.sessionId,
          pick,
          'openFailed',
          `${OPEN_FAILED_PREFIX}${errorText(error)}`,
        );
      },
    );
  };

  // Stops a stream the section no longer wants or whose pick was replaced,
  // drops an open in flight likewise, then opens the wanted pick's stream when
  // none is open or opening.
  const syncStream = (holder: HeldSection) => {
    const wanted = wantedPick(holder);
    if (holder.stream !== null && holder.stream.pick !== wanted) {
      stopStream(holder);
    }
    if (holder.opening !== null && holder.opening.pick !== wanted) {
      holder.opening = null;
    }
    if (wanted !== null && holder.stream === null && holder.opening === null) {
      openStream(holder, wanted);
    }
  };

  const trackEnded = (holder: HeldSection, media: MediaStream) => {
    const stream = holder.stream;
    if (stream?.media === media) {
      raise(holder.sessionId, stream.pick, 'closed', CLOSED_TEXT);
    }
  };

  // Drops the crop and shows the moved notice when the stream's shape left
  // the window's; once moved, keeps the frame at the stream's shape.
  const checkMoved = (holder: HeldSection) => {
    const stream = holder.stream;
    const { videoWidth, videoHeight } = holder.video;
    if (stream === null || videoWidth === 0 || videoHeight === 0) {
      return;
    }
    const isMovedShown =
      raisedFor(holder.sessionId, stream.pick)?.kind === 'moved';
    const hasMoved = streamMoved(stream.pick.windowSize, {
      width: videoWidth,
      height: videoHeight,
    });
    if (!isMovedShown && hasMoved) {
      raise(holder.sessionId, stream.pick, 'moved', MOVED_TEXT);
      return;
    }
    styleVideo(holder, stream.pick);
  };

  const listenToVideo = (holder: HeldSection) => {
    holder.video.addEventListener('loadedmetadata', () => {
      const stream = holder.stream;
      if (stream === null) {
        return;
      }
      deps.log(
        `streaming ${stream.pick.summary} in ${deps.nameOf(holder.sessionId)}`,
      );
      checkMoved(holder);
    });
    holder.video.addEventListener('resize', () => checkMoved(holder));
  };

  const styleVideo = (holder: HeldSection, pick: LivePick) => {
    const { video } = holder;
    const isStreamShown =
      pick.kind === 'stream' && !endedStreaming(holder.sessionId, pick);
    video.hidden = !isStreamShown;
    if (pick.kind !== 'stream') {
      return;
    }
    const isMoved = raisedFor(holder.sessionId, pick)?.kind === 'moved';
    const crop = isMoved ? null : pick.crop;
    video.style.aspectRatio = String(frameAspect(pick, crop, video, isMoved));
    video.style.setProperty(
      'object-view-box',
      crop === null ? 'none' : viewBoxOf(crop),
    );
  };

  // A media element taken out of the page pauses, and `autoplay` does not
  // start it again.
  const placeVideo = (holder: HeldSection, slot: HTMLElement) => {
    slot.append(holder.video);
    void holder.video.play().catch(() => undefined);
  };

  const logNotice = (
    sessionId: string,
    pick: LivePick,
    notice: Notice | null,
  ) => {
    if (notice === null) {
      loggedNotices.delete(sessionId);
      return;
    }
    const logged = loggedNotices.get(sessionId);
    if (logged?.pick === pick && logged.text === notice.text) {
      return;
    }
    loggedNotices.set(sessionId, { pick, text: notice.text });
    deps.log(`notice in ${deps.nameOf(sessionId)}: ${notice.text}`);
  };

  const disposeDrawn = (holder: HeldSection) => {
    const drawn = holder.drawn;
    const observing = holder.observing;
    holder.drawn = null;
    holder.observing = null;
    try {
      observing?.dispose();
    } finally {
      drawn?.dispose();
    }
  };

  const drawPart = (holder: HeldSection, notice: Notice | null) =>
    layoutParts.draw('liveView', holder.parent, (liveView, slot, rollback) =>
      liveView(
        slot,
        { notice },
        createBaseKit(
          ownerBaseKitDeps(liveViewManifest, deps.kit, null, rollback),
        ),
      ),
    );

  function draw(holder: HeldSection) {
    const pick = deps.pick(holder.sessionId);
    try {
      disposeDrawn(holder);
    } finally {
      holder.parent.replaceChildren();
    }
    if (pick === undefined) {
      // No slot is drawn to observe, so the next pick waits for its own report.
      holder.isIntersecting = false;
      holder.section.setSummary(null);
      loggedNotices.delete(holder.sessionId);
      syncStream(holder);
      return;
    }
    const notice = noticeOf(holder.sessionId, pick);
    const drawn = drawPart(holder, notice);
    holder.drawn = drawn;
    holder.section.setSummary(pick.kind === 'stream' ? pick.summary : null);
    placeVideo(holder, drawn.built.videoSlot);
    styleVideo(holder, pick);
    holder.observing = deps.observeIntersection(
      drawn.built.videoSlot,
      (isIntersecting) => {
        holder.isIntersecting = isIntersecting;
        syncStream(holder);
      },
    );
    logNotice(holder.sessionId, pick, notice);
    syncStream(holder);
  }

  const drawSession = (sessionId: string) =>
    callEach([...(held.get(sessionId) ?? [])], draw);

  function raise(
    sessionId: string,
    pick: StreamPick,
    kind: RaisedNotice['kind'],
    text: string,
  ) {
    raised.set(sessionId, { pick, kind, text });
    drawSession(sessionId);
  }

  // Stops the section's stream before anything else, so a throw further on
  // cannot leave a capture running.
  const disposeHolder = (holder: HeldSection) => {
    if (holder.isDisposed) {
      return;
    }
    holder.isDisposed = true;
    holder.opening = null;
    const sections = held.get(holder.sessionId);
    sections?.delete(holder);
    if (sections?.size === 0) {
      held.delete(holder.sessionId);
    }
    try {
      stopStream(holder);
    } finally {
      disposeDrawn(holder);
    }
  };

  const everyHolder = () => [...held.values()].flatMap((each) => [...each]);

  return {
    part: {
      id: 'live-view.section',
      title: 'Live',
      order: 15,
      shrinksLast: true,
      build(parent, sessionId, section) {
        const holder: HeldSection = {
          sessionId,
          parent,
          section,
          video: createVideo(),
          drawn: null,
          observing: null,
          isIntersecting: false,
          stream: null,
          opening: null,
          isDisposed: false,
        };
        listenToVideo(holder);
        const sections = held.get(sessionId) ?? new Set<HeldSection>();
        sections.add(holder);
        held.set(sessionId, sections);
        draw(holder);
        return { dispose: () => disposeHolder(holder) };
      },
    },
    pickUpdated(sessionId) {
      if (raised.get(sessionId)?.pick !== deps.pick(sessionId)) {
        raised.delete(sessionId);
      }
      drawSession(sessionId);
    },
    pageVisibilityChanged() {
      callEach(everyHolder(), syncStream);
    },
    setLayouts(shown) {
      layoutParts.setLayouts(shown);
      callEach(everyHolder(), draw);
    },
    forget(sessionId) {
      raised.delete(sessionId);
      loggedNotices.delete(sessionId);
      callEach([...(held.get(sessionId) ?? [])], disposeHolder);
    },
  };
}
