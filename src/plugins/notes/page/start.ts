import './notes.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { canvasEncoder } from '../../../shared/page/file-drop/canvas-encoder';
import { onPageHide } from '../../../shared/page/page-hide';
import { placeWrites } from '../../../shared/page/place-slot';
import type { KeyedSlotReader, SlotReader } from '../../../contracts/state';
import {
  followRows,
  sessionsActiveSlot,
  type SessionRow,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type NoteSession,
  type NotesChannel,
  type NotesPlace,
  notesPlaceSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { notesManifest } from '../manifest';
import { readNotesLayout } from './layout/read-notes-layout';
import { createNotePopup, type NotePopupDeps } from './popup';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';

type NotesApi = PageApi<typeof notesManifest, NotesChannel>;

// A row with no host session id can be neither attached nor named.
function noteSessionOf(row: SessionRow | undefined): NoteSession | null {
  if (row?.hostSessionId === undefined || row.hostSessionId === null) {
    return null;
  }
  const { sessionId, harness, hostSessionId, projectDir } = row;
  return { sessionId, harness, hostSessionId, projectDir };
}

// The popup's reads of the session rows: `selectedSession` is the active row
// when it carries a host session id, and `sessionRows` every row that does, in
// row order.
export function noteSessions(
  rows: Pick<KeyedSlotReader<SessionRow>, 'get' | 'all'>,
  active: Pick<SlotReader<string | null>, 'get'>,
): Pick<NotePopupDeps, 'selectedSession' | 'sessionRows'> {
  return {
    selectedSession() {
      const selected = active.get() ?? null;
      return selected === null ? null : noteSessionOf(rows.get(selected));
    },
    sessionRows: () =>
      [...rows.all().values()].flatMap((row) => noteSessionOf(row) ?? []),
  };
}

// The note popup over any mode, on `Space n n`, drawn with the layout the
// `layout` setting names. It offers the popup the open session rows that carry
// a host session id, so the popup can attach one. The popup's open state and
// cursors go to `notes.place` on each change, and a page load opens the popup
// again where the last page left it, open through the base changes made
// before the page load's restores settle.
export const notesPagePart: PagePart<typeof notesManifest> = {
  manifest: notesManifest,
  start(api: NotesApi) {
    const { services } = api;
    const rows = api.state.read(sessionsRowsSlot);
    const active = api.state.read(sessionsActiveSlot);
    const placeWriter = api.state.publish(notesPlaceSlot);
    const place = placeWrites<NotesPlace>((value) => placeWriter.set(value));
    let restoresSettled = false;
    api.restores.onSettled(() => {
      restoresSettled = true;
    });

    const popup = createNotePopup({
      channel: api.channel,
      services,
      keys: api.keys,
      overlay: api.areas.overlay,
      commands: kitCommandsOf(api),
      platform: api.platform.os,
      state: api.state.forLayouts,
      pushScope: (scope) => api.keys.pushScope(scope),
      autosaveDelayMs: () => api.settings().autosaveDelayMs,
      ...noteSessions(rows, active),
      drops: api.drops,
      encoder: canvasEncoder,
      onPageHide,
      restoresSettled: () => restoresSettled,
      placeChanged: (value) => place.write(value),
    });
    const savedPlace = placeWriter.get();
    if (savedPlace !== undefined) {
      popup.restorePlace(savedPlace);
    }
    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readNotesLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => popup.setLayouts(shown),
    });
    return {
      commands: popup.commands,
      ready() {
        followRows(rows, {
          added: ({ hostSessionId }) =>
            services.log(`session ${hostSessionId ?? 'none'} listed`),
          hostChanged: ({ hostSessionId }) =>
            services.log(`session moved to ${hostSessionId ?? 'none'}`),
        });
      },
      dispose: () => popup.dispose(),
    };
  },
};
