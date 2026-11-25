import './chatroom.css';
import '../../../shared/page/markdown.css';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { harnessLabel } from '../../../shared/agent-harness-label';
import { callEach } from '../../../shared/call-each';
import {
  createBaseKit,
  kitCommandsOf,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { placeWrites } from '../../../shared/page/place-slot';
import {
  followRows,
  type RowActivity,
  type SessionRow,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type ChatroomChannel,
  type ChatroomPlace,
  chatroomPlaceSlot,
  chatroomRoomsSlot,
  type RoomView,
  sessionThread,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { ChatroomPart, CompleteLayout, Layout } from '../layouts/layout';
import { chatroomManifest } from '../manifest';
import { badgeText, rowActivities, rowUnreadOf } from './chatroom-state';
import { createChatroomView } from './chatroom-view';
import { registerDemoSteps } from './demo-steps';
import { readChatroomLayout } from './layout/read-chatroom-layout';

type ChatroomApi = PageApi<typeof chatroomManifest, ChatroomChannel>;

const TITLE = 'Chatroom';
const BADGE_PART = 'chatroom.badge';
const ACTIVITY_SOURCE = 'chatroom';

// A wrapper sessions handed the row part, and the badge drawn into it last.
interface HeldWrapper {
  wrapper: HTMLElement;
  badge: DrawnPart<ChatroomPart> | null;
}

// Chatroom mode: the rooms and their threads in the side bar, and in the sheet
// the shown room's board, the open thread's log and the composer, drawn with
// the layout the `layout` setting names; `showMode` shows the mode, or toggles
// its side bar while it shows. Under each session row, the `chatroom.badge`
// part draws the row's unread posts in its room (`@<mentions>`, else
// `<unread> new`), a click opening the thread of its newest; each row whose
// agents asked the user a question or blocker no answer replies to shows the
// `asks you` activity. Reads the rooms from `chatroom.rooms` and the rows from
// `sessions.rows`; the open thread goes to `chatroom.place`, and a page load
// opens it again. Logs each badge's and activity's text when it changes.
// Registers the Chatroom demo step's page half.
export const chatroomPagePart: PagePart<typeof chatroomManifest> = {
  manifest: chatroomManifest,
  start(api: ChatroomApi) {
    const { services } = api;
    const { log } = services;
    const sessions = api.dependency(sessionsPageKey);
    const roomsSlot = api.state.read(chatroomRoomsSlot);
    const rows = api.state.read(sessionsRowsSlot);
    const harnesses = api.state.read(coreAgentHarnessesSlot);
    const placeWriter = api.state.publish(chatroomPlaceSlot);
    const place = placeWrites<ChatroomPlace>((value) => placeWriter.set(value));
    const kitServices: OwnerKitServices = {
      markdown: services.markdown,
      keys: api.keys,
      commands: kitCommandsOf(api),
      platform: api.platform.os,
      state: api.state.forLayouts,
      log,
    };
    const parts = createLayoutParts<Layout, CompleteLayout>({
      owner: chatroomManifest.id,
      defaultLayout,
      log,
    });
    const rooms = (): RoomView[] => [...roomsSlot.all().values()];
    let isShown = false;
    let isDisposed = false;

    const view = createChatroomView({
      channel: api.channel,
      log,
      kitServices,
      parts,
      rooms,
      harnessLabel: (id) => harnessLabel(harnesses.all(), id),
      setScope: (scope) => api.keys.setScope(scope),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      isShown: () => isShown,
      showMode: () => mode.show(),
      picked: () => mode.picked(),
      shownThread: (label) => mode.setContext({ title: TITLE, detail: label }),
      savedPlace: placeWriter.get() ?? null,
      placeChanged: (value) => place.write(value),
    });

    // The view reads `mode` only once a key runs or a read lands, after
    // `add`: Chatroom mode is never the first mode added.
    const mode = api.modes.add({
      id: 'main',
      title: TITLE,
      icon: 'organization',
      place: { group: 2, order: 4 },
      showCommand: 'showMode',
      element: view.sheet,
      sideBar: view.sideBar,
      shown() {
        isShown = true;
        view.shown();
      },
      hidden() {
        isShown = false;
        view.hidden();
      },
      sideBarHidden: () => view.sideBarHidden(),
      sideBarOpenedOver: () => view.sideBarOpenedOver(),
      focusSideBar: () => view.focusSideBar(),
      focusMain: () => view.focusMain(),
    });
    view.restorePlace();

    // ── Row badge and activity ─────────────────────────────────────────────
    const held = new Map<string, HeldWrapper>();
    // Each row's badge and activity text last logged; a row never logged
    // reads `none`.
    const loggedBadges = new Map<string, string>();
    const loggedActivities = new Map<string, string>();

    const logChange = (
      logged: Map<string, string>,
      what: string,
      row: SessionRow,
      text: string,
    ) => {
      if (text === (logged.get(row.sessionId) ?? 'none')) {
        return;
      }
      logged.set(row.sessionId, text);
      log(`${what} in ${row.label}: ${text}`);
    };

    const disposeBadge = (holder: HeldWrapper) => {
      const drawn = holder.badge;
      holder.badge = null;
      try {
        drawn?.dispose();
      } finally {
        holder.wrapper.replaceChildren();
      }
    };

    const drawBadge = (sessionId: string, holder: HeldWrapper) => {
      disposeBadge(holder);
      const row = rows.get(sessionId);
      if (row === undefined) {
        return;
      }
      const unread = rowUnreadOf(rooms(), row);
      const text = badgeText(unread);
      logChange(loggedBadges, 'badge', row, text ?? 'none');
      if (text === null) {
        return;
      }
      const input = {
        text,
        isMention: (unread?.mentions ?? 0) > 0,
        rowId: sessionId,
      };
      holder.badge = parts.draw(
        'rowBadge',
        holder.wrapper,
        (rowBadge, slot, rollback) =>
          rowBadge(
            slot,
            input,
            createBaseKit(
              ownerBaseKitDeps(chatroomManifest, kitServices, null, rollback),
            ),
          ),
      );
    };

    const setActivities = () => {
      const allRows = [...rows.all().values()];
      const activities = rowActivities(
        rooms(),
        allRows.map((row) => row.sessionId),
      );
      callEach(allRows, (row) => {
        const activity: RowActivity | null =
          activities.get(row.sessionId) ?? null;
        sessions.setActivity(row.sessionId, ACTIVITY_SOURCE, activity);
        logChange(
          loggedActivities,
          'activity',
          row,
          activity === null ? 'none' : activity.word,
        );
      });
    };

    const redrawRows = () => {
      if (isDisposed) {
        return;
      }
      callEach<() => void>(
        [
          () =>
            callEach([...held], ([sessionId, holder]) =>
              drawBadge(sessionId, holder),
            ),
          setActivities,
        ],
        (step) => step(),
      );
    };

    sessions.addRowPart({
      id: BADGE_PART,
      build(wrapper, sessionId) {
        const holder: HeldWrapper = { wrapper, badge: null };
        held.set(sessionId, holder);
        drawBadge(sessionId, holder);
        return {
          dispose() {
            if (held.get(sessionId) === holder) {
              held.delete(sessionId);
            }
            disposeBadge(holder);
          },
        };
      },
    });

    followRows(rows, {
      removed(sessionId) {
        loggedBadges.delete(sessionId);
        loggedActivities.delete(sessionId);
      },
    });
    rows.on(() => redrawRows());
    roomsSlot.on((room) => {
      view.roomChanged(room);
      redrawRows();
    });

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readChatroomLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        parts.setLayouts(shown);
        view.redraw();
        redrawRows();
      },
    });

    // The core logs the side bar's hiding and showing.
    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      mode.toggleSideBar();
    };

    // Shows the mode on the row's room, at the thread of the row's newest
    // unread post, else the row's own session thread.
    const openRowRoom = (rowId: string) => {
      const row = rows.get(rowId);
      if (row === undefined) {
        log(`no row ${rowId}`);
        return;
      }
      const thread =
        rowUnreadOf(rooms(), row)?.newestThread ?? sessionThread(rowId);
      if (!mode.isShown()) {
        mode.show();
      }
      view.openRoomThread(row.project, thread);
    };

    registerDemoSteps(services, {
      commands: api.commands,
      holdPlace: () => place.hold(),
    });

    return {
      commands: {
        showMode,
        preview: () => view.showPreview(),
        ...view.commands,
        openThreadRow: ({ arg }) => view.openThreadRow(arg),
        openRowRoom: ({ arg }) => openRowRoom(arg),
      },
      ready() {
        redrawRows();
      },
      dispose() {
        isDisposed = true;
        view.dispose();
      },
    };
  },
};
