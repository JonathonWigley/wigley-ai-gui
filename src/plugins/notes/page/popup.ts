import type { DroppedFile, PageDrops } from '../../../contracts/drops';
import type { TextEditor } from '../../../contracts/editor';
import type { ImageEncoder } from '../../../contracts/images';
import type { Platform } from '../../../contracts/platform';
import type {
  CommandsRunIn,
  PageChannel,
  PageServices,
  PluginAreas,
  PushedScope,
  ShownLayouts,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { IMAGE_TYPES } from '../../../shared/image-types';
import { saveState, startAutosave } from '../../../shared/page/autosave';
import { element } from '../../../shared/page/dom';
import type { KitCommands } from '../../../shared/page/layout-host/base-kit';
import { insertionText } from '../../../shared/page/file-drop/file-chips';
import { pathOf } from '../../../shared/page/file-drop/file-path';
import { SHRINK_REFUSED, shrinkToFit } from '../../../shared/shrink-image';
import { createListPicker } from '../../../shared/page/list-picker';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { textBoxInput } from '../../../shared/page/text-box';
import { createDialog } from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { boxHint } from '../../../shared/page/ui/key-anchors';
import { pngDataUrl } from '../../../shared/png-data-url';
import type { KeysPageExports } from '../../keys/contract';
import type {
  FollowupRequest,
  NoteDraft,
  NoteFields,
  NoteFollowup,
  NoteHome,
  NoteHomes,
  NoteSendResult,
  NoteSession,
  NotesChannel,
  SendKind,
} from '../contract';
import { emptyDraft, sendRefusal } from '../draft';
import type { Layout, PickerRowInput } from '../layouts/layout';
import type { notesManifest } from '../manifest';
import { launchFolder } from '../note-targets';
import { sessionChipText } from '../session-ref';
import { createNotesParts, type NotesPartsDeps } from './layout/notes-parts';
import { createMarkupView } from './markup-view';
import { toPngBytes } from './png-image';
import {
  applyPopupAction,
  attachSession,
  detachSession,
  imageCursorAfterRemove,
  initialPopupState,
  launchFolders,
  moveField,
  NOTE_FIELDS,
  type NoteField,
  openFields,
  type PopupAction,
  type PopupState,
  sessionOptions,
  toggleTag,
} from './popup-state';

export type NotesPageCommand = CommandsRunIn<typeof notesManifest, 'page'>;

type NotesScope = keyof typeof notesManifest.scopes & string;

const FIELD_LABELS: Record<NoteField, string> = {
  target: 'Target',
  title: 'Title',
  body: 'Body',
  tags: 'Tags',
  images: 'Images',
  session: 'Session',
};

// The note sends each command delivers, once the draft is saved and its
// images flattened.
type Deliver = (
  flattened: readonly (Uint8Array | null)[],
) => Promise<NoteSendResult>;

// An operation that changes the draft through main and holds it until done.
type DraftOperation =
  | 'send'
  | 'discard'
  | 'attach'
  | 'image removal'
  | 'capture';

export interface NotePopupDeps {
  channel: PageChannel<NotesChannel>;
  services: PageServices;
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
  overlay: PluginAreas['overlay'];
  // The commands a layout's kit runs and checks.
  commands: KitCommands;
  platform: Platform;
  pushScope(scope: NotesScope): PushedScope;
  // Read each time autosave schedules a save.
  autosaveDelayMs(): number;
  // The session row the user has selected, when it has a host session id.
  selectedSession(): NoteSession | null;
  // Every open session row with a host session id, in row order.
  sessionRows(): readonly NoteSession[];
  // Where the popup registers as a drop target, and saves a file with no path.
  drops: Pick<PageDrops, 'addTarget' | 'savePasted'>;
  // Re-encodes an image over the cap smaller as it joins the Images field.
  encoder: ImageEncoder;
}

export interface NotePopup {
  commands: Record<NotesPageCommand, () => void>;
  // Draws every part again with `shown`, keeping the boxes, their text and
  // focus, an open picker and an open markup session.
  setLayouts(shown: ShownLayouts<Layout>): void;
}

// The note popup: a modal dialog over any mode editing the one kept draft
// through notes main, its parts drawn through the notes layout (`default`
// alone until the first `setLayouts`). `open` loads the draft and shows it,
// or closes the popup while it shows; closing keeps the draft, saving an
// unsaved edit at once. Its commands are the notes page commands, each a
// no-op while the popup cannot take it.
export function createNotePopup(deps: NotePopupDeps): NotePopup {
  const { channel, services } = deps;
  const { log, toast, paths, homeDir, editor: editorHost } = services;
  const partsDeps: NotesPartsDeps = {
    markdown: services.markdown,
    keys: deps.keys,
    commands: deps.commands,
    platform: deps.platform,
    log,
  };
  const parts = createNotesParts(partsDeps);

  const dialog = createDialog('Note');
  dialog.element.classList.add('notes-popup');
  deps.overlay.contribute(dialog.element);

  const store = createReducerStore<PopupState, PopupAction>(
    initialPopupState(emptyDraft(1)),
    applyPopupAction,
  );
  const dispatch = (action: PopupAction) => store.dispatch(action);
  const edit = (change: Partial<NoteFields>) =>
    dispatch({ type: 'edited', fields: { ...store.get().fields, ...change } });

  let phase: 'closed' | 'loading' | 'open' = 'closed';
  let popupScope: PushedScope | null = null;
  let titleScope: PushedScope | null = null;
  let focusedBox: 'title' | 'body' | null = null;
  let homes: NoteHome[] = [];
  // The one operation changing the draft through main, named for log lines.
  let inFlight: DraftOperation | null = null;
  // An open() whose body focus waits for the operation in flight.
  let focusBodyWhenFree = false;
  // While a draft operation is in flight no send, discard, image change,
  // picker or autosave starts, and no box takes focus; typing in a box already
  // focused still lands.
  const isLocked = () => inFlight !== null;
  // Each image's bytes and thumbnail URL, by id.
  const images = new Map<number, { bytes: Uint8Array; url: string }>();

  // A new element the keys plugin draws the keys of `command` into, then
  // `label` when given, while `scope` is in force. Each is made once: the
  // popup lives as long as the page, so it keeps no anchor to dispose.
  const anchored = (
    command: NotesPageCommand,
    scope: NotesScope,
    label?: string,
  ): HTMLElement => {
    const node = element('span', 'notes-hint');
    deps.keys.anchor(node, `notes.${command}`, {
      scope: `notes.${scope}`,
      label,
    });
    return node;
  };

  // The box hint of the keys that move between the boxes, in `scope`.
  const boxMoveHint = (scope: NotesScope): HTMLElement =>
    boxHint('notes-box-hint', [
      anchored('prevBox', scope),
      anchored('nextBox', scope),
    ]);

  // The state the value parts last drew; null draws them all.
  let drawn: { state: PopupState; homes: readonly NoteHome[] } | null = null;

  // ── Rows ──────────────────────────────────────────────────────────────────
  // The fields container stays app-owned; each row part draws inside it, and
  // the app fills the row's value slot.
  const fieldsView = element('div', 'notes-fields');
  let rows = new Map<NoteField, HTMLElement>();
  let slots = new Map<NoteField, HTMLElement>();
  const slot = (field: NoteField) => slots.get(field) as HTMLElement;

  // The cursor prompt, moved to the selected field's row on each draw.
  const cursorPrompt = element('span', 'notes-cursor-prompt');
  const editHint = anchored('editBox', 'popup', 'edit');
  const removeHint = anchored('remove', 'popup', 'remove');
  cursorPrompt.append(editHint, removeHint);

  // The title and body boxes are made once; each row draw moves them into
  // the new value slot.
  const titleFrame = inputFrame();
  const titleInput = textBoxInput('notes-title');
  titleInput.placeholder = 'Title';
  titleFrame.append(titleInput, boxMoveHint('title'));
  titleInput.addEventListener('input', () => edit({ title: titleInput.value }));
  titleInput.addEventListener('focus', () => {
    if (isLocked()) {
      titleInput.blur();
      return;
    }
    titleScope ??= deps.pushScope('title');
    boxFocused('title');
  });
  titleInput.addEventListener('blur', () => {
    titleScope?.pop();
    titleScope = null;
    boxBlurred();
  });

  const bodyFrame = inputFrame();
  bodyFrame.classList.add('notes-body');
  const body: TextEditor = editorHost.create(bodyFrame, '', {
    changed: (text) => edit({ body: text }),
    focused: () => {
      if (isLocked()) {
        body.blur();
        return;
      }
      boxFocused('body');
    },
    blurred: () => boxBlurred(),
    modeChanged: () => undefined,
  });
  const bodyHint = boxMoveHint('popup');
  bodyFrame.append(bodyHint);

  const boxOf = (field: NoteField): HTMLElement | null => {
    if (field === 'title') {
      return titleFrame;
    }
    return field === 'body' ? bodyFrame : null;
  };

  // Draws every row in field order, each holding its box; the value parts
  // draw on the next render.
  const drawRows = () => {
    const nextRows = new Map<NoteField, HTMLElement>();
    const nextSlots = new Map<NoteField, HTMLElement>();
    for (const field of NOTE_FIELDS) {
      const row = parts.row(
        fieldsView,
        { field, label: FIELD_LABELS[field] },
        boxOf(field),
      );
      nextRows.set(field, row.element);
      nextSlots.set(field, row.slot);
    }
    nextSlots.get('session')?.classList.add('notes-row-value--one-line');
    rows = nextRows;
    slots = nextSlots;
    drawn = null;
  };
  drawRows();

  const boxFocused = (box: 'title' | 'body') => {
    focusedBox = box;
    dispatch({ type: 'fieldMoved', field: box });
    render();
  };
  const boxBlurred = () => {
    focusedBox = null;
    render();
  };

  const markupView = createMarkupView({
    channel,
    markup: services.markup,
    parts,
    pushScope: () => deps.pushScope('markup'),
    imageBytes: (id) => imageBytes(id),
    closed: () => {
      showFields(true);
      dispatch({ type: 'fieldMoved', field: 'images' });
      render();
    },
    saved: (draft) =>
      dispatch({
        type: 'imagesChanged',
        images: draft.images,
        imageIndex: store.get().imageIndex,
      }),
    log,
    toast,
  });
  dialog.body.append(fieldsView, markupView.element);

  const showFields = (isShown: boolean) => {
    fieldsView.hidden = !isShown;
    dialog.actions.hidden = !isShown;
    markupView.element.hidden = isShown;
  };
  showFields(true);

  // ── Drawing ───────────────────────────────────────────────────────────────
  const homeOf = (root: string | null): NoteHome | null =>
    root === null
      ? null
      : (homes.find((home) => paths.samePath(home.root, root)) ?? null);

  const homeLabel = (home: NoteHome) =>
    `${home.repo} — ${paths.tilde(home.root, homeDir)}`;

  // The target's repo for a log line; its folder when no home names it.
  const targetName = (target: string | null): string => {
    if (target === null) {
      return 'none';
    }
    return homeOf(target)?.repo ?? paths.tilde(target, homeDir);
  };

  const drawTarget = (target: string | null) => {
    const home = homeOf(target);
    let text: string | null = null;
    if (target !== null) {
      text = home === null ? paths.tilde(target, homeDir) : homeLabel(home);
    }
    parts.target(slot('target'), { text });
  };

  const drawImages = (state: PopupState) => {
    parts.images(
      slot('images'),
      { count: state.images.length },
      {
        imageAt(position) {
          const image = state.images[position - 1];
          if (image === undefined) {
            return undefined;
          }
          return {
            position,
            src: images.get(image.id)?.url ?? '',
            alt: `Image ${position}`,
            hasMarkup: image.hasMarkup,
            isSelected: position - 1 === state.imageIndex,
          };
        },
        removeImageAt: (index) => void removeImageAt(index),
      },
    );
  };

  const drawSession = (session: NoteSession | null) => {
    parts.session(
      slot('session'),
      {
        text:
          session === null ? null : sessionChipText(session, paths, homeDir),
      },
      () => removeSession(),
    );
  };

  // Redraws only the rows whose state changed since the last draw, so typing
  // never rebuilds the strip's thumbnails.
  const render = () => {
    const state = store.get();
    const last = drawn?.state ?? null;
    if (last?.fields.target !== state.fields.target || drawn?.homes !== homes) {
      drawTarget(state.fields.target);
    }
    if (last?.fields.tags !== state.fields.tags) {
      parts.tags(slot('tags'), { tags: [...state.fields.tags] });
    }
    const imagesChanged =
      last?.images !== state.images || last.imageIndex !== state.imageIndex;
    if (imagesChanged) {
      drawImages(state);
    }
    if (last?.fields.session !== state.fields.session) {
      drawSession(state.fields.session);
    }
    drawn = { state, homes };
    const keysOnRows = focusedBox === null && !othersHoldKeys();
    for (const [field, node] of rows) {
      const isCursor = keysOnRows && field === state.field;
      node.classList.toggle('is-cursor', isCursor);
    }
    fieldsView.classList.toggle('is-box-focused', focusedBox !== null);
    bodyHint.hidden = focusedBox !== 'body';
    placeCursorPrompt(state);
  };

  // Moves the cursor prompt to the end of the selected field's row, showing
  // the keys that act on that field and keeping the others' space. It hides,
  // keeping its space, while the keys are off the rows.
  const placeCursorPrompt = (state: PopupState) => {
    const { field } = state;
    const holdsImage = field === 'images' && state.images.length > 0;
    const holdsSession = field === 'session' && state.fields.session !== null;
    editHint.classList.toggle(
      'is-no-target',
      field !== 'title' && field !== 'body',
    );
    removeHint.classList.toggle('is-no-target', !holdsImage && !holdsSession);
    rows.get(field)?.append(cursorPrompt);
  };
  store.subscribe(render);

  parts.actions(dialog.actions);

  // ── Saving ────────────────────────────────────────────────────────────────
  const saveFields = async (fields: NoteFields) => {
    await channel.invoke('saveDraft', fields);
    log('notes', 'draft saved');
  };

  startAutosave({
    subscribe: (listener) => store.subscribe(listener),
    drafts: () => (isLocked() ? [] : [store.get()]),
    idOf: () => 'note',
    bodyOf: (state) => state.fields,
    saveStarted: (_id, revision) => dispatch({ type: 'saveStarted', revision }),
    saveFinished: (_id, revision, error) =>
      dispatch({ type: 'saveFinished', revision, error }),
    save: (_id, fields) => saveFields(fields),
    delayMs: deps.autosaveDelayMs,
    timers: services.timers,
    log,
    logSource: 'notes',
  });

  // Saves the fields now unless main already holds them; rejects with the
  // save's error.
  const saveNow = async () => {
    const state = store.get();
    if (saveState(state) === 'saved') {
      return;
    }
    const { revision, fields } = state;
    dispatch({ type: 'saveStarted', revision });
    try {
      await saveFields(fields);
    } catch (error) {
      const message = errorText(error);
      dispatch({ type: 'saveFinished', revision, error: message });
      log('notes', `draft not saved for note: ${message}`);
      throw error;
    }
    dispatch({ type: 'saveFinished', revision, error: null });
  };

  // ── The draft operation in flight ─────────────────────────────────────────
  // Runs `run` as the draft operation in flight, from before its first await
  // to its end; logs and skips it when another holds the draft.
  const runDraftOperation = async (
    operation: DraftOperation,
    run: () => Promise<void>,
  ) => {
    if (inFlight !== null) {
      log('notes', `${operation} skipped: ${inFlight} in flight`);
      return;
    }
    inFlight = operation;
    try {
      await run();
    } finally {
      inFlight = null;
      draftFreed();
    }
  };

  // Saves the edits typed during the operation, which autosave skipped, and
  // focuses the body an open() during it could not.
  const draftFreed = () => {
    if (saveState(store.get()) === 'unsaved') {
      void saveNow().catch(() => undefined);
    }
    if (!focusBodyWhenFree) {
      return;
    }
    focusBodyWhenFree = false;
    if (focusedBox === null && mayEdit()) {
      body.focus({ insertAtEnd: true });
    }
  };

  // ── Images ────────────────────────────────────────────────────────────────
  const cacheImage = (id: number, bytes: Uint8Array) =>
    images.set(id, { bytes, url: pngDataUrl(bytes) });

  const imageBytes = async (id: number): Promise<Uint8Array> => {
    const held = images.get(id);
    if (held !== undefined) {
      return held.bytes;
    }
    const bytes = await channel.invoke('image', id);
    cacheImage(id, bytes);
    return bytes;
  };

  // Fetches every image of `draft` not yet held, and forgets those it lacks.
  const cacheImages = async (draft: NoteDraft) => {
    for (const id of images.keys()) {
      if (!draft.images.some((image) => image.id === id)) {
        images.delete(id);
      }
    }
    for (const image of draft.images) {
      await imageBytes(image.id);
    }
  };

  // Main's draft after an image was added: the new image is the last.
  const imageAdded = async (draft: NoteDraft, how: 'capture' | 'file') => {
    await cacheImages(draft);
    const pos = draft.images.length;
    dispatch({
      type: 'imagesChanged',
      images: draft.images,
      imageIndex: pos - 1,
    });
    log('notes', `image ${pos} attached (${how})`);
  };

  // Each image file as a PNG shrunk to fit the cap, added in order.
  const attachEach = async (files: readonly DroppedFile[]) => {
    for (const file of files) {
      try {
        const bytes = await file.bytes();
        const png = await toPngBytes(
          new Blob([new Uint8Array(bytes)], { type: file.mediaType }),
        );
        const fitted = await shrinkToFit(
          { bytes: png, mediaType: 'image/png' },
          deps.encoder,
        );
        if (fitted === null) {
          toast(SHRINK_REFUSED, 'error');
          log('notes', `image refused: ${SHRINK_REFUSED}`);
          continue;
        }
        const draft = await channel.invoke('addImage', fitted.bytes);
        await imageAdded(draft, 'file');
      } catch (error) {
        const message = `Image not attached: ${errorText(error)}`;
        toast(message, 'error');
        log('notes', message);
      }
    }
  };

  const removeImageAt = (index: number) =>
    runDraftOperation('image removal', async () => {
      const image = store.get().images[index];
      if (image === undefined) {
        return;
      }
      try {
        const draft = await channel.invoke('removeImage', image.id);
        await cacheImages(draft);
        dispatch({
          type: 'imagesChanged',
          images: draft.images,
          imageIndex: imageCursorAfterRemove(draft.images.length, index),
        });
        log('notes', `image ${index + 1} removed`);
      } catch (error) {
        const message = `Image not removed: ${errorText(error)}`;
        toast(message, 'error');
        log('notes', message);
      }
    });

  // ── Pickers ───────────────────────────────────────────────────────────────
  const picker = createListPicker({
    pushScope: () => deps.pushScope('picker'),
    log,
    logSource: 'notes',
    filterEditor: editorHost,
  });
  dialog.element.append(picker.element);
  const pickerFilterHint = anchored('pickerFilter', 'picker', 'filter');

  const pick = <T>(
    title: PickerRowInput['picker'],
    items: readonly T[],
    label: (item: T) => string,
    selected: number,
    chosen: (item: T) => void,
  ) => {
    blurBoxes();
    picker.open({
      title,
      items,
      label,
      selected,
      headerEnd: pickerFilterHint,
      drawRow: (list, _item, { label, trailing }) =>
        parts.pickerRow(list, { picker: title, label }, trailing),
      chosen: (item) => {
        render();
        chosen(item);
      },
      cancelled: () => {
        render();
        log('notes', `picker closed: ${title}`);
      },
    });
    render();
  };

  // ── The discard confirmation ──────────────────────────────────────────────
  // Its text and buttons are the `confirm` part, drawn into its body.
  const confirm = createDialog('Discard this note?', { hasActions: false });
  parts.confirm(confirm.body);
  deps.overlay.contribute(confirm.element);
  let confirmScope: PushedScope | null = null;

  // Hides the confirmation; false when it was not shown.
  const hideConfirm = (): boolean => {
    const scope = confirmScope;
    if (scope === null) {
      return false;
    }
    confirmScope = null;
    confirm.hide();
    scope.pop();
    render();
    return true;
  };

  const keepDraft = () => {
    if (hideConfirm()) {
      log('notes', 'draft kept');
    }
  };

  // ── Boxes and the field cursor ────────────────────────────────────────────
  const blurBoxes = () => {
    if (focusedBox === 'title') {
      titleInput.blur();
    } else if (focusedBox === 'body') {
      body.blur();
    }
  };

  // Focuses `box` again in the mode it had.
  const refocusBox = (box: 'title' | 'body') => {
    if (box === 'title') {
      titleInput.focus();
    } else {
      body.focus();
    }
  };

  const focusBox = (box: 'title' | 'body') => {
    if (box === 'title') {
      titleInput.focus();
    } else {
      body.focus({ insert: true });
    }
  };

  const moveTo = (field: NoteField) => {
    dispatch({ type: 'fieldMoved', field });
    log('notes', `field ${field}`);
  };

  // Puts the draft main answered with into the page, as saved.
  const loadDraft = (draft: NoteDraft) => {
    dispatch({ type: 'loaded', draft });
    titleInput.value = draft.title;
    body.setText(draft.body);
  };

  // Whether the markup view, a picker or the discard confirmation holds the
  // keys in place of the rows.
  const othersHoldKeys = () =>
    markupView.isShown() || picker.isOpen() || confirmScope !== null;

  const fieldsShown = () =>
    phase === 'open' && dialog.isShown() && !othersHoldKeys();

  // Whether the user may change the draft now.
  const mayEdit = () => fieldsShown() && !isLocked();

  // Puts a draft main answered into the open popup: a fresh one takes the
  // selected session and its default target, saved at once.
  const showDraft = (draft: NoteDraft) => {
    loadDraft(draft);
    if (draft.fresh) {
      const fields = openFields(draft, deps.selectedSession(), homes, paths);
      dispatch({ type: 'edited', fields });
      void saveNow().catch(() => undefined);
    }
  };

  // ── Opening and closing ───────────────────────────────────────────────────
  const open = async () => {
    phase = 'loading';
    try {
      const [draft, found] = await Promise.all([
        channel.invoke('loadDraft'),
        channel.invoke('homes'),
      ]);
      homes = found.homes;
      await cacheImages(draft);
      showDraft(draft);
    } catch (error) {
      phase = 'closed';
      toast(`Note not opened: ${errorText(error)}`, 'error');
      log('notes', `note not opened: ${errorText(error)}`);
      return;
    }
    const scope = deps.pushScope('popup');
    scope.onBaseChanged(() => {
      if (popupScope === scope) {
        close();
      }
    });
    popupScope = scope;
    phase = 'open';
    showFields(true);
    dialog.show();
    dispatch({ type: 'fieldMoved', field: 'body' });
    render();
    if (isLocked()) {
      focusBodyWhenFree = true;
    } else {
      body.focus({ insertAtEnd: true });
    }
    const { fields, images: held } = store.get();
    log(
      'notes',
      `popup shown: title "${fields.title}", ${held.length} images, target ${targetName(fields.target)}, session ${fields.session?.hostSessionId ?? 'none'}`,
    );
  };

  const close = () => {
    if (phase !== 'open') {
      return;
    }
    markupView.close();
    if (picker.isOpen()) {
      picker.cancel();
    }
    keepDraft();
    saveNow().catch((error: unknown) =>
      toast(`Draft not saved: ${errorText(error)}`, 'error'),
    );
    blurBoxes();
    phase = 'closed';
    focusBodyWhenFree = false;
    popupScope?.pop();
    popupScope = null;
    dialog.hide();
    log('notes', 'popup closed');
  };

  // ── Capture ───────────────────────────────────────────────────────────────
  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const capture = () =>
    runDraftOperation('capture', async () => {
      log('notes', 'capture started');
      blurBoxes();
      dialog.hide();
      try {
        await nextFrame();
        await nextFrame();
        const draft = await channel.invoke('capture');
        await imageAdded(draft, 'capture');
      } catch (error) {
        toast(`Capture failed: ${errorText(error)}`, 'error');
        log('notes', `capture failed: ${errorText(error)}`);
      } finally {
        if (phase === 'open') {
          dialog.show();
          dispatch({ type: 'fieldMoved', field: 'images' });
        }
      }
    });

  // ── Sending ───────────────────────────────────────────────────────────────
  const refuse = (text: string) => {
    toast(text, 'error');
    log('notes', `send refused: ${text}`);
  };

  // Whether a send of `kind` may start now; logs or toasts why not.
  const maySend = (kind: SendKind): boolean => {
    if (inFlight !== null) {
      log('notes', `${inFlight} in flight`);
      return false;
    }
    const refusal = sendRefusal(store.get().fields, kind);
    if (refusal !== null) {
      refuse(refusal);
      return false;
    }
    return true;
  };

  // Main's homes now, with the target's; null, refused, when no home holds
  // the target.
  const targetHome = async (): Promise<NoteHome | null> => {
    homes = (await channel.invoke('homes')).homes;
    const target = store.get().fields.target;
    const home = homeOf(target);
    if (home === null) {
      refuse(`No features home at ${targetName(target)}`);
    }
    return home;
  };

  const flattenImage = async (id: number): Promise<Uint8Array> => {
    const [bytes, saved] = await Promise.all([
      imageBytes(id),
      channel.invoke('markup', id),
    ]);
    const host = element('div', 'notes-flatten-host');
    document.body.append(host);
    try {
      const session = await services.markup.open(host, bytes, saved);
      try {
        return await session.toPng();
      } finally {
        session.dispose();
      }
    } finally {
      host.remove();
    }
  };

  const flattenImages = async (): Promise<(Uint8Array | null)[]> => {
    const flattened: (Uint8Array | null)[] = [];
    for (const image of store.get().images) {
      flattened.push(image.hasMarkup ? await flattenImage(image.id) : null);
    }
    return flattened;
  };

  const finishSend = (result: NoteSendResult) => {
    if (result.type === 'refused') {
      refuse(result.reason);
      return;
    }
    loadDraft(result.draft);
    close();
    toast(result.toast, 'success');
    log('notes', `sent: ${result.toast}`);
  };

  // Runs one send from its first step: `prepare` returns the delivery, or
  // null when it refused the send itself. A send that leaves the popup open
  // puts focus back in the box it started from.
  const runSend = async (prepare: () => Promise<Deliver | null>) => {
    const startedIn = focusedBox;
    await runDraftOperation('send', async () => {
      blurBoxes();
      try {
        const deliver = await prepare();
        if (deliver === null) {
          return;
        }
        await saveNow();
        await markupView.savesSettled();
        finishSend(await deliver(await flattenImages()));
      } catch (error) {
        refuse(errorText(error));
      }
    });
    if (startedIn !== null && mayEdit()) {
      focusBox(startedIn);
    }
  };

  const sendToFollowup =
    (request: FollowupRequest): Deliver =>
    (flattened) =>
      channel.invoke('sendToFollowup', request, flattened);

  const sendFollowup = () => {
    if (maySend('followup')) {
      void runSend(async () => sendToFollowup({ type: 'create' }));
    }
  };

  const appendFollowup = () => {
    if (!maySend('append')) {
      return;
    }
    void runSend(async () => {
      const home = await targetHome();
      if (home === null) {
        return null;
      }
      if (home.followups.length === 0) {
        toast(`No open follow-ups in ${home.repo}`, 'info');
        return null;
      }
      pick<NoteFollowup>(
        'Follow-up',
        home.followups,
        (item) => item.title,
        0,
        (item) => {
          if (maySend('append')) {
            void runSend(async () =>
              sendToFollowup({
                type: 'append',
                path: item.path,
                title: item.title,
              }),
            );
          }
        },
      );
      return null;
    });
  };

  const sendSession = () => {
    if (!maySend('session')) {
      return;
    }
    void runSend(async () => {
      const home = await targetHome();
      if (home === null) {
        return null;
      }
      const { session } = store.get().fields;
      const folder = launchFolder(
        home,
        launchFolders(session, deps.sessionRows()),
        paths,
      );
      if (folder === null) {
        refuse(`No folder for ${home.repo}; attach a session in that repo`);
        return null;
      }
      return (flattened) => channel.invoke('sendToSession', folder, flattened);
    });
  };

  // ── Field actions ─────────────────────────────────────────────────────────
  const pickTarget = async () => {
    let found: NoteHomes;
    try {
      found = await channel.invoke('homes');
    } catch (error) {
      toast(`Homes not read: ${errorText(error)}`, 'error');
      return;
    }
    homes = found.homes;
    if (homes.length === 0) {
      toast(found.message ?? 'No features home found', 'error');
      return;
    }
    const target = store.get().fields.target;
    const selected = homes.findIndex(
      (home) => target !== null && paths.samePath(home.root, target),
    );
    pick('Target', homes, homeLabel, selected, (home) => {
      edit({ target: home.root, targetPicked: true });
      log('notes', `target ${home.repo}`);
    });
  };

  const pickTags = async () => {
    let tags: string[];
    try {
      tags = await channel.invoke('tags');
    } catch (error) {
      toast(`Tags not read: ${errorText(error)}`, 'error');
      return;
    }
    if (tags.length === 0) {
      toast('No tags to pick', 'info');
      return;
    }
    const chosen = store.get().fields.tags;
    pick(
      'Tags',
      tags,
      (item) => (chosen.includes(item) ? `Remove ${item}` : `Add ${item}`),
      0,
      (item) => {
        const next = toggleTag(store.get().fields.tags, item);
        edit({ tags: next });
        log('notes', `tags ${next.length === 0 ? 'none' : next.join(', ')}`);
      },
    );
  };

  const pickSession = () => {
    const options = sessionOptions(
      deps.sessionRows(),
      store.get().fields.session,
    );
    if (options.length === 0) {
      toast('No other session is open', 'info');
      return;
    }
    pick(
      'Session',
      options,
      (session) => sessionChipText(session, paths, homeDir),
      0,
      (session) => {
        dispatch({
          type: 'edited',
          fields: attachSession(store.get().fields, session, homes, paths),
        });
        log('notes', `session ${session.hostSessionId}`);
      },
    );
  };

  const removeSession = () => {
    if (isLocked()) {
      return;
    }
    dispatch({ type: 'edited', fields: detachSession(store.get().fields) });
    log('notes', 'session none');
  };

  const openMarkup = () => {
    const { images: held, imageIndex } = store.get();
    const image = held[imageIndex];
    if (image === undefined) {
      log('notes', 'no image to mark up');
      return;
    }
    blurBoxes();
    showFields(false);
    markupView.open(image.id, imageIndex + 1);
    render();
  };

  const act = () => {
    const field = store.get().field;
    switch (field) {
      case 'target':
        void pickTarget();
        return;
      case 'title':
      case 'body':
        focusBox(field);
        return;
      case 'tags':
        void pickTags();
        return;
      case 'images':
        openMarkup();
        return;
      case 'session':
        pickSession();
        return;
    }
  };

  const remove = () => {
    const { field, imageIndex } = store.get();
    if (field === 'images') {
      void removeImageAt(imageIndex);
    } else if (field === 'session') {
      removeSession();
    }
  };

  const discard = () => {
    if (confirmScope !== null) {
      return;
    }
    blurBoxes();
    const scope = deps.pushScope('confirm');
    scope.onBaseChanged(() => {
      if (confirmScope === scope) {
        keepDraft();
      }
    });
    confirmScope = scope;
    confirm.show();
    render();
    log('notes', 'discard asked');
  };

  const confirmDiscard = async () => {
    if (!hideConfirm()) {
      return;
    }
    await runDraftOperation('discard', async () => {
      try {
        await markupView.savesSettled();
        const draft = await channel.invoke('discard');
        await cacheImages(draft);
        showDraft(draft);
        dispatch({ type: 'fieldMoved', field: 'body' });
        log('notes', 'draft discarded');
      } catch (error) {
        const message = `Draft not discarded: ${errorText(error)}`;
        toast(message, 'error');
        log('notes', message);
      }
    });
  };

  // ── Dropped and pasted files ──────────────────────────────────────────────
  // A file whose save failed is toasted and logged.
  const saveFailed = (file: DroppedFile, error: string) => {
    const message = `${file.name} not saved: ${error}`;
    toast(message, 'error');
    log('notes', message);
  };

  // Puts the paths of `files` into the Body at its cursor, unless the popup
  // changed while they were saved: then the paths are toasted instead. Only
  // an 'attach' may hold the draft meanwhile, since it leaves the Body alone.
  const insertPaths = async (files: readonly DroppedFile[]) => {
    const filePaths: string[] = [];
    for (const file of files) {
      const path = await pathOf(file, deps.drops.savePasted, saveFailed);
      if (path !== null) {
        filePaths.push(path);
      }
    }
    if (filePaths.length === 0) {
      return;
    }
    const isBodyFree = inFlight === null || inFlight === 'attach';
    if (!fieldsShown() || !isBodyFree) {
      const message = `Paths not inserted, popup changed: ${filePaths.join(' ')}`;
      toast(message, 'error');
      log('notes', message);
      return;
    }
    body.insert(insertionText(filePaths, body.charBeforeCursor()));
    log('notes', `${filePaths.length} paths inserted`);
  };

  // Images join the Images field; every other file goes into the Body as its
  // path.
  const take = (files: readonly DroppedFile[]) => {
    if (!mayEdit()) {
      log('notes', `files skipped: ${inFlight ?? 'popup not editable'}`);
      return;
    }
    const imageFiles = files.filter((file) =>
      IMAGE_TYPES.includes(file.mediaType),
    );
    const otherFiles = files.filter(
      (file) => !IMAGE_TYPES.includes(file.mediaType),
    );
    if (imageFiles.length > 0) {
      void runDraftOperation('attach', () => attachEach(imageFiles));
    }
    if (otherFiles.length > 0) {
      void insertPaths(otherFiles);
    }
  };
  // The popup lives as long as the page, so it keeps no target to dispose.
  deps.drops.addTarget({ element: dialog.element, take });

  render();

  // ── Commands ──────────────────────────────────────────────────────────────
  const whileFieldsShow = (run: () => void) => () => {
    if (fieldsShown() && inFlight !== 'capture') {
      run();
    }
  };
  const whileEditable = (run: () => void) => () => {
    if (mayEdit()) {
      run();
    }
  };

  // Reads which box has focus before the redraw moves the boxes, and
  // focuses it again after.
  const setLayouts = (shown: ShownLayouts<Layout>) => {
    const box = focusedBox;
    parts.setLayouts(shown);
    drawRows();
    parts.actions(dialog.actions);
    parts.confirm(confirm.body);
    render();
    markupView.redrawToolbar();
    picker.redraw();
    if (box !== null) {
      refocusBox(box);
    }
  };

  const commands: Record<NotesPageCommand, () => void> = {
    open() {
      if (phase === 'open') {
        close();
      } else if (phase === 'closed') {
        void open();
      }
    },
    close,
    nextField: whileFieldsShow(() => moveTo(moveField(store.get().field, 1))),
    prevField: whileFieldsShow(() => moveTo(moveField(store.get().field, -1))),
    act: whileEditable(act),
    editBox: whileEditable(() => {
      const field = store.get().field;
      if (field === 'title' || field === 'body') {
        focusBox(field);
      } else {
        log('notes', `no box on ${field}`);
      }
    }),
    nextBox: whileEditable(() =>
      focusBox(focusedBox === null ? 'title' : 'body'),
    ),
    prevBox: whileEditable(() =>
      focusBox(focusedBox === null ? 'body' : 'title'),
    ),
    leaveBox() {
      const box = focusedBox;
      if (box === null) {
        return;
      }
      blurBoxes();
      moveTo(box);
    },
    pickTarget: whileEditable(() => void pickTarget()),
    pickTags: whileEditable(() => void pickTags()),
    pickSession: whileEditable(pickSession),
    nextImage: whileFieldsShow(() => dispatch({ type: 'imageMoved', step: 1 })),
    prevImage: whileFieldsShow(() =>
      dispatch({ type: 'imageMoved', step: -1 }),
    ),
    remove: whileEditable(remove),
    capture: whileEditable(() => void capture()),
    sendFollowup: whileFieldsShow(sendFollowup),
    appendFollowup: whileFieldsShow(appendFollowup),
    sendSession: whileFieldsShow(sendSession),
    discard: whileEditable(discard),
    toolSelect: () => markupView.setTool('select'),
    toolPen: () => markupView.setTool('pen'),
    toolText: () => markupView.setTool('text'),
    toolArrow: () => markupView.setTool('arrow'),
    toolBox: () => markupView.setTool('box'),
    nextColour: () => markupView.stepColour(1),
    prevColour: () => markupView.stepColour(-1),
    undo: () => markupView.undo(),
    redo: () => markupView.redo(),
    closeMarkup: () => markupView.close(),
    pickerDown: () => picker.down(),
    pickerUp: () => picker.up(),
    pickerChoose: () => picker.choose(),
    pickerCancel: () => picker.cancel(),
    pickerFilter: () => picker.focusFilter(),
    pickerList: () => picker.leaveFilter(),
    confirmYes: () => void confirmDiscard(),
    confirmNo: keepDraft,
  };
  return { commands, setLayouts };
}
