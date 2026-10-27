import type { CommandId } from '../../../contracts/commands';
import type { TextEditor } from '../../../contracts/editor';
import type { Platform } from '../../../contracts/platform';
import type {
  CommandsRunIn,
  PageChannel,
  PageServices,
  PluginAreas,
  PushedScope,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { IMAGE_TYPES } from '../../../shared/image-types';
import { saveState, startAutosave } from '../../../shared/page/autosave';
import { element } from '../../../shared/page/dom';
import { keyHint } from '../../../shared/page/key-hint';
import { createListPicker } from '../../../shared/page/list-picker';
import { filesOf, holdsPastedText } from '../../../shared/page/pasted-images';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { textBoxInput } from '../../../shared/page/text-box';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import { chip } from '../../../shared/page/ui/chip';
import { createDialog } from '../../../shared/page/ui/dialog';
import { icon } from '../../../shared/page/ui/icon';
import { iconButton } from '../../../shared/page/ui/icon-button';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { tag } from '../../../shared/page/ui/tag';
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
import type { notesManifest } from '../manifest';
import { launchFolder } from '../note-targets';
import { sessionChipText } from '../session-ref';
import { createMarkupView } from './markup-view';
import { pngDataUrl, toPngBytes } from './png-image';
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

const REFUSED_TYPE = 'Only PNG, JPEG, GIF and WebP images can be attached';

const FIELD_LABELS: Record<NoteField, string> = {
  target: 'Target',
  title: 'Title',
  body: 'Body',
  tags: 'Tags',
  images: 'Images',
  session: 'Session',
};

interface ActionButton {
  label: string;
  variant: ButtonVariant;
  command: NotesPageCommand;
}

const POPUP_ACTIONS: readonly ActionButton[] = [
  { label: 'Discard', variant: 'ghost', command: 'discard' },
  {
    label: 'Append to follow-up',
    variant: 'secondary',
    command: 'appendFollowup',
  },
  { label: 'Start session', variant: 'secondary', command: 'sendSession' },
  { label: 'Add follow-up', variant: 'primary', command: 'sendFollowup' },
];

const CONFIRM_ACTIONS: readonly ActionButton[] = [
  { label: 'Keep', variant: 'secondary', command: 'confirmNo' },
  { label: 'Discard', variant: 'danger', command: 'confirmYes' },
];

// The note sends each command delivers, once the draft is saved and its
// images flattened.
type Deliver = (
  flattened: readonly (Uint8Array | null)[],
) => Promise<NoteSendResult>;

export interface NotePopupDeps {
  channel: PageChannel<NotesChannel>;
  services: PageServices;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  platform: Platform;
  overlay: PluginAreas['overlay'];
  run(command: CommandId): void;
  pushScope(scope: NotesScope): PushedScope;
  // Read each time autosave schedules a save.
  autosaveDelayMs(): number;
  // The session row the user has selected, when it has a host session id.
  selectedSession(): NoteSession | null;
  // Every open session row with a host session id, in row order.
  sessionRows(): readonly NoteSession[];
}

// The note popup: a modal dialog over any mode editing the one kept draft
// through notes main. `open` loads the draft and shows it, or closes the
// popup while it shows; closing keeps the draft, saving an unsaved edit at
// once. Its commands are the notes page commands, each a no-op while the
// popup cannot take it.
export function createNotePopup(
  deps: NotePopupDeps,
): Record<NotesPageCommand, () => void> {
  const { channel, services } = deps;
  const { log, toast, paths, homeDir, editor: editorHost } = services;

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
  let isSending = false;
  let isCapturing = false;
  // Each image's bytes and thumbnail URL, by id.
  const images = new Map<number, { bytes: Uint8Array; url: string }>();

  // ── Rows ──────────────────────────────────────────────────────────────────
  const fieldsView = element('div', 'notes-fields');
  const rows = new Map<NoteField, HTMLElement>();
  const slots = new Map<NoteField, HTMLElement>();
  for (const field of NOTE_FIELDS) {
    const node = element('div', 'notes-row');
    const value = element('div', 'notes-row-value');
    node.append(element('span', 'notes-row-label', FIELD_LABELS[field]), value);
    rows.set(field, node);
    slots.set(field, value);
    fieldsView.append(node);
  }
  const slot = (field: NoteField) => slots.get(field) as HTMLElement;
  slot('session').classList.add('notes-row-value--one-line');

  const titleFrame = inputFrame();
  const titleInput = textBoxInput('notes-title');
  titleInput.placeholder = 'Title';
  titleFrame.append(titleInput);
  slot('title').append(titleFrame);
  titleInput.addEventListener('input', () => edit({ title: titleInput.value }));
  titleInput.addEventListener('focus', () => {
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
  slot('body').append(bodyFrame);
  const body: TextEditor = editorHost.create(bodyFrame, '', {
    changed: (text) => edit({ body: text }),
    focused: () => boxFocused('body'),
    blurred: () => boxBlurred(),
    modeChanged: () => undefined,
  });

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
    keys: deps.keys,
    platform: deps.platform,
    run: deps.run,
    pushScope: () => deps.pushScope('markup'),
    imageBytes: (id) => imageBytes(id),
    closed: () => {
      showFields(true);
      dispatch({ type: 'fieldMoved', field: 'images' });
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

  const quiet = (text: string) => element('span', 'notes-empty', text);

  const drawTarget = (target: string | null) => {
    if (target === null) {
      slot('target').replaceChildren(quiet('No target'));
      return;
    }
    const home = homeOf(target);
    const text = home === null ? paths.tilde(target, homeDir) : homeLabel(home);
    slot('target').replaceChildren(element('span', 'notes-target', text));
  };

  const drawTags = (tags: readonly string[]) => {
    slot('tags').replaceChildren(
      ...(tags.length === 0
        ? [quiet('No tags')]
        : tags.map((held) => tag(held))),
    );
  };

  const drawImages = (state: PopupState) => {
    if (state.images.length === 0) {
      slot('images').replaceChildren(quiet('No images'));
      return;
    }
    const strip = element('div', 'notes-strip');
    state.images.forEach((image, index) => {
      const held = element('div', 'notes-image');
      held.classList.toggle('is-selected', index === state.imageIndex);
      const thumbnail = element('img', 'notes-image-thumbnail');
      thumbnail.src = images.get(image.id)?.url ?? '';
      thumbnail.alt = `Image ${index + 1}`;
      held.append(thumbnail);
      if (image.hasMarkup) {
        const pen = icon('edit');
        pen.classList.add('notes-image-pen');
        held.append(pen);
      }
      const remove = iconButton(
        'close',
        'Remove the image',
        () => void removeImageAt(index),
        'sm',
      );
      remove.classList.add('notes-image-remove');
      held.append(remove);
      strip.append(held);
    });
    slot('images').replaceChildren(strip);
  };

  const drawSession = (session: NoteSession | null) => {
    if (session === null) {
      slot('session').replaceChildren(quiet('No session'));
      return;
    }
    const text = sessionChipText(session, paths, homeDir);
    const remove = iconButton(
      'close',
      'Remove the session',
      () => removeSession(),
      'sm',
    );
    const shown = chip(text, '', () => deps.run('notes.pickSession'));
    shown.classList.add('notes-session');
    slot('session').replaceChildren(shown, remove);
  };

  // Redraws only the rows whose state changed since the last draw, so typing
  // never rebuilds the strip's thumbnails.
  let drawn: { state: PopupState; homes: readonly NoteHome[] } | null = null;
  const render = () => {
    const state = store.get();
    const last = drawn?.state ?? null;
    if (last?.fields.target !== state.fields.target || drawn?.homes !== homes) {
      drawTarget(state.fields.target);
    }
    if (last?.fields.tags !== state.fields.tags) {
      drawTags(state.fields.tags);
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
    for (const [field, node] of rows) {
      const isCursor = focusedBox === null && field === state.field;
      node.classList.toggle('is-cursor', isCursor);
    }
  };
  store.subscribe(render);

  const drawActions = (
    target: HTMLElement,
    actions: readonly ActionButton[],
    scope: string,
  ) => {
    target.replaceChildren(
      ...actions.map((action) =>
        textButton(action.label, () => deps.run(`notes.${action.command}`), {
          variant: action.variant,
          hint: keyHint(
            deps.keys.keysFor(`notes.${action.command}`, scope),
            deps.platform,
          ),
        }),
      ),
    );
  };

  // ── Saving ────────────────────────────────────────────────────────────────
  const saveFields = async (fields: NoteFields) => {
    await channel.invoke('saveDraft', fields);
    log('notes', 'draft saved');
  };

  startAutosave({
    subscribe: (listener) => store.subscribe(listener),
    drafts: () => [store.get()],
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
  const imageAdded = async (
    draft: NoteDraft,
    how: 'capture' | 'pasted' | 'dropped',
  ) => {
    await cacheImages(draft);
    const pos = draft.images.length;
    dispatch({
      type: 'imagesChanged',
      images: draft.images,
      imageIndex: pos - 1,
    });
    log('notes', `image ${pos} attached (${how})`);
  };

  const attachFiles = async (
    files: readonly File[],
    how: 'pasted' | 'dropped',
  ) => {
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) {
        toast(REFUSED_TYPE, 'error');
        log('notes', `image refused: ${REFUSED_TYPE}`);
        continue;
      }
      try {
        const png = await toPngBytes(file);
        const draft = await channel.invoke('addImage', png);
        await imageAdded(draft, how);
      } catch (error) {
        const message = `Image not attached: ${errorText(error)}`;
        toast(message, 'error');
        log('notes', message);
      }
    }
  };

  const removeImageAt = async (index: number) => {
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
  };

  // ── Pickers ───────────────────────────────────────────────────────────────
  const picker = createListPicker({
    pushScope: () => deps.pushScope('picker'),
    log,
    logSource: 'notes',
    filterEditor: editorHost,
  });
  dialog.element.append(picker.element);

  const pick = <T>(
    title: string,
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
      chosen,
      cancelled: () => log('notes', `picker closed: ${title}`),
    });
  };

  // ── The discard confirmation ──────────────────────────────────────────────
  const confirm = createDialog('Discard this note?');
  confirm.body.append(
    element(
      'p',
      'notes-confirm-text',
      'Its title, text and images are removed.',
    ),
  );
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
    return true;
  };

  const keepDraft = () => {
    if (hideConfirm()) {
      log('notes', 'draft kept');
    }
  };

  // Drawn again on each keymap change for as long as the page lives.
  const drawAllActions = () => {
    drawActions(dialog.actions, POPUP_ACTIONS, 'notes.popup');
    drawActions(confirm.actions, CONFIRM_ACTIONS, 'notes.confirm');
    markupView.redrawHints();
  };
  drawAllActions();
  deps.keys.onChanged(drawAllActions);

  // ── Boxes and the field cursor ────────────────────────────────────────────
  const blurBoxes = () => {
    if (focusedBox === 'title') {
      titleInput.blur();
    } else if (focusedBox === 'body') {
      body.blur();
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

  const fieldsShown = () =>
    phase === 'open' &&
    dialog.isShown() &&
    !markupView.isShown() &&
    !picker.isOpen() &&
    confirmScope === null;

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
      loadDraft(draft);
      if (draft.fresh) {
        const fields = openFields(draft, deps.selectedSession(), homes, paths);
        dispatch({ type: 'edited', fields });
        void saveNow().catch(() => undefined);
      }
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
    body.focus({ insertAtEnd: true });
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
    popupScope?.pop();
    popupScope = null;
    dialog.hide();
    log('notes', 'popup closed');
  };

  // ── Capture ───────────────────────────────────────────────────────────────
  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const capture = async () => {
    log('notes', 'capture started');
    isCapturing = true;
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
      isCapturing = false;
      if (phase === 'open') {
        dialog.show();
        dispatch({ type: 'fieldMoved', field: 'images' });
      }
    }
  };

  // ── Sending ───────────────────────────────────────────────────────────────
  const refuse = (text: string) => {
    toast(text, 'error');
    log('notes', `send refused: ${text}`);
  };

  // Whether a send of `kind` may start now; logs or toasts why not.
  const maySend = (kind: SendKind): boolean => {
    if (isSending) {
      log('notes', 'send in flight');
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
    dialog.element.append(host);
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
  // null when it refused the send itself.
  const runSend = async (prepare: () => Promise<Deliver | null>) => {
    isSending = true;
    try {
      const deliver = await prepare();
      if (deliver === null) {
        return;
      }
      await saveNow();
      finishSend(await deliver(await flattenImages()));
    } catch (error) {
      refuse(errorText(error));
    } finally {
      isSending = false;
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
    log('notes', 'discard asked');
  };

  const confirmDiscard = async () => {
    if (!hideConfirm()) {
      return;
    }
    try {
      const draft = await channel.invoke('discard');
      await cacheImages(draft);
      loadDraft(draft);
      dispatch({ type: 'fieldMoved', field: 'body' });
      log('notes', 'draft discarded');
    } catch (error) {
      const message = `Draft not discarded: ${errorText(error)}`;
      toast(message, 'error');
      log('notes', message);
    }
  };

  // ── Paste and drop ────────────────────────────────────────────────────────
  document.addEventListener(
    'paste',
    (event) => {
      if (!fieldsShown()) {
        return;
      }
      const files = filesOf(event.clipboardData);
      if (files.length === 0 || holdsPastedText(event.clipboardData, files)) {
        return;
      }
      event.preventDefault();
      void attachFiles(files, 'pasted');
    },
    { capture: true },
  );
  dialog.element.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files') === true) {
      event.preventDefault();
    }
  });
  dialog.element.addEventListener('drop', (event) => {
    const files = filesOf(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    if (fieldsShown()) {
      void attachFiles(files, 'dropped');
    }
  });

  render();

  // ── Commands ──────────────────────────────────────────────────────────────
  const whileFieldsShow = (run: () => void) => () => {
    if (fieldsShown() && !isCapturing) {
      run();
    }
  };

  return {
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
    act: whileFieldsShow(act),
    editBox: whileFieldsShow(() => {
      const field = store.get().field;
      if (field === 'title' || field === 'body') {
        focusBox(field);
      } else {
        log('notes', `no box on ${field}`);
      }
    }),
    nextBox: whileFieldsShow(() =>
      focusBox(focusedBox === null ? 'title' : 'body'),
    ),
    prevBox: whileFieldsShow(() =>
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
    pickTarget: whileFieldsShow(() => void pickTarget()),
    pickTags: whileFieldsShow(() => void pickTags()),
    pickSession: whileFieldsShow(pickSession),
    nextImage: whileFieldsShow(() => dispatch({ type: 'imageMoved', step: 1 })),
    prevImage: whileFieldsShow(() =>
      dispatch({ type: 'imageMoved', step: -1 }),
    ),
    remove: whileFieldsShow(remove),
    capture: whileFieldsShow(() => void capture()),
    sendFollowup: whileFieldsShow(sendFollowup),
    appendFollowup: whileFieldsShow(appendFollowup),
    sendSession: whileFieldsShow(sendSession),
    discard: whileFieldsShow(discard),
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
}
