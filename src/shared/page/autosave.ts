import type { Timers } from '../../contracts/ambient';
import type { Disposable } from '../../contracts/disposable';
import type { PluginLog } from '../../contracts/log';
import { callEach } from '../call-each';
import { errorText } from '../error-text';

export type SaveState = 'saved' | 'saving' | 'unsaved';

// What autosave reads of one open form's state.
export interface DraftRevisions {
  // Counts body edits; a save carries the revision it sent.
  revision: number;
  savingRevision: number | null;
  savedRevision: number;
  // The last failed save's message; cleared when a save starts or succeeds.
  saveError: string | null;
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved',
};

export function saveState(draft: DraftRevisions): SaveState {
  if (draft.savedRevision === draft.revision) {
    return 'saved';
  }
  return draft.savingRevision === draft.revision ? 'saving' : 'unsaved';
}

export function startSave<Draft extends DraftRevisions>(
  draft: Draft,
  revision: number,
): Draft {
  const isUnchanged =
    draft.savingRevision === revision && draft.saveError === null;
  return isUnchanged
    ? draft
    : { ...draft, savingRevision: revision, saveError: null };
}

// `error` is null for a save that succeeded.
export function finishSave<Draft extends DraftRevisions>(
  draft: Draft,
  revision: number,
  error: string | null,
): Draft {
  const savingRevision =
    draft.savingRevision === revision ? null : draft.savingRevision;
  const savedRevision =
    error === null
      ? Math.max(draft.savedRevision, revision)
      : draft.savedRevision;
  const isUnchanged =
    savingRevision === draft.savingRevision &&
    savedRevision === draft.savedRevision &&
    error === draft.saveError;
  return isUnchanged
    ? draft
    : { ...draft, savingRevision, savedRevision, saveError: error };
}

// `error` is the last failed save's message, shown while the draft is unsaved.
export function saveLabel(state: SaveState, error: string | null): string {
  const hasError = state === 'unsaved' && error !== null;
  return hasError ? `${SAVE_LABELS[state]} — ${error}` : SAVE_LABELS[state];
}

export interface AutosaveDeps<Draft extends DraftRevisions, Body> {
  subscribe(listener: () => void): Disposable;
  // The open drafts now, read after each change `subscribe` reports.
  drafts(): readonly Draft[];
  idOf(draft: Draft): string;
  bodyOf(draft: Draft): Body;
  // Each dispatches the caller's own save action for draft `id`.
  saveStarted(id: string, revision: number): void;
  saveFinished(id: string, revision: number, error: string | null): void;
  // Resolves once main has written the draft; rejects with main's error.
  save(id: string, body: Body): Promise<void>;
  // Read each time a save is scheduled.
  delayMs(): number;
  // `onPageHide` from `page-hide.ts` fits; a dep so the tests need no window.
  onPageHide(listener: () => void): Disposable;
  timers: Timers;
  log: PluginLog;
}

interface PendingSave {
  revision: number;
  // null once a save of `revision` failed: the next edit schedules again.
  handle: number | null;
}

// Saves a draft once its edits pause for `delayMs`. A save is in flight until
// `save` settles; a failed one leaves the draft unsaved with its message, and
// the next edit schedules a save again. On page hide every unsaved draft saves at
// once, `save` called inside the listener. Its `Disposable` clears every scheduled
// save, the subscription and the page hide listener; a save still in flight then
// only logs a failure.
export function startAutosave<Draft extends DraftRevisions, Body>(
  deps: AutosaveDeps<Draft, Body>,
): Disposable {
  const pending = new Map<string, PendingSave>();
  let isDisposed = false;
  const subscription = deps.subscribe(() => {
    const drafts = deps.drafts();
    for (const [id, entry] of pending) {
      if (!drafts.some((draft) => deps.idOf(draft) === id)) {
        cancel(deps.timers, entry);
        pending.delete(id);
      }
    }
    for (const draft of drafts) {
      const id = deps.idOf(draft);
      const entry = pending.get(id);
      const isUnsaved = saveState(draft) === 'unsaved';
      const isHandled = entry?.revision === draft.revision;
      if (!isUnsaved || isHandled) {
        continue;
      }
      if (entry !== undefined) {
        cancel(deps.timers, entry);
      }
      const handle = deps.timers.set(
        () => void saveDraft(deps, pending, id, () => isDisposed),
        deps.delayMs(),
      );
      pending.set(id, { revision: draft.revision, handle });
    }
  });
  const pageHide = deps.onPageHide(() => {
    for (const draft of deps.drafts()) {
      if (saveState(draft) !== 'unsaved') {
        continue;
      }
      const id = deps.idOf(draft);
      const entry = pending.get(id);
      if (entry !== undefined) {
        cancel(deps.timers, entry);
      }
      void saveDraft(deps, pending, id, () => isDisposed);
    }
  });
  return {
    dispose() {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      for (const entry of pending.values()) {
        cancel(deps.timers, entry);
      }
      pending.clear();
      callEach([subscription, pageHide], (each) => each.dispose());
    },
  };
}

async function saveDraft<Draft extends DraftRevisions, Body>(
  deps: AutosaveDeps<Draft, Body>,
  pending: Map<string, PendingSave>,
  id: string,
  isDisposed: () => boolean,
) {
  pending.delete(id);
  const draft = deps.drafts().find((candidate) => deps.idOf(candidate) === id);
  if (draft === undefined || saveState(draft) !== 'unsaved') {
    return;
  }
  const { revision } = draft;
  deps.saveStarted(id, revision);
  try {
    await deps.save(id, deps.bodyOf(draft));
  } catch (error) {
    if (isDisposed()) {
      return;
    }
    const message = errorText(error);
    deps.log(`draft not saved for ${id}: ${message}`);
    // An edit made during the save has its own save scheduled already.
    if (!pending.has(id)) {
      pending.set(id, { revision, handle: null });
    }
    deps.saveFinished(id, revision, message);
    return;
  }
  if (!isDisposed()) {
    deps.saveFinished(id, revision, null);
  }
}

function cancel(timers: Timers, entry: PendingSave) {
  if (entry.handle !== null) {
    timers.clear(entry.handle);
  }
}
