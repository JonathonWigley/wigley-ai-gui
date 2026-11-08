import type { Disposable } from '../../contracts/disposable';
import type { KeyedSlotWriter } from '../../contracts/state';
import { type PlaceWrites, placeWrites, pruneKeys } from './place-slot';
import type { ReducerStore } from './reducer-store';
import {
  formById,
  type SessionForm,
  type SessionFormsState,
} from './session-forms';

export interface SessionFormPlacesDeps<
  State extends SessionFormsState<SessionForm, string>,
  Place,
> {
  // The plugin's place slot, published by the caller.
  writer: KeyedSlotWriter<Place>;
  store: Pick<ReducerStore<State, never>, 'get' | 'subscribe'>;
  // The form's place now.
  placeOf(state: State, form: State['forms'][number]): Place;
  // Dispatches the plugin's own action that puts form `formId` back at `place`.
  restore(formId: string, place: Place): void;
}

export interface SessionFormPlaces<Place> {
  // The places the last page saved, copied once before any form arrives.
  saved: ReadonlyMap<string, Place>;
  // Runs once the open forms read returned `formIds`: restores each read form
  // `saved` holds, then deletes every place neither the read nor the store holds,
  // its form closed while no page ran.
  formsRead(formIds: readonly string[]): void;
}

// Writes each open form's place on each store change, one `placeWrites` per form,
// and deletes a form's place when it leaves the store. A form restored while it
// was not the active one is restored again once it becomes active, since the
// state applies the view to the active form alone. The `Disposable` stops the
// subscription.
export function followSessionFormPlaces<
  State extends SessionFormsState<SessionForm, string>,
  Place,
>(
  deps: SessionFormPlacesDeps<State, Place>,
): SessionFormPlaces<Place> & Disposable {
  const { writer, store } = deps;
  const saved: ReadonlyMap<string, Place> = new Map(writer.all());
  const writes = new Map<string, PlaceWrites<Place>>();
  // The restored forms still waiting to become active, for their view.
  const awaitingActive = new Set<string>();
  const restoreNowActive = (state: State) => {
    const { activeFormId } = state;
    const place = activeFormId === null ? undefined : saved.get(activeFormId);
    if (activeFormId === null || place === undefined) {
      return;
    }
    if (awaitingActive.delete(activeFormId)) {
      deps.restore(activeFormId, place);
    }
  };
  const subscription = store.subscribe(() => {
    const state = store.get();
    for (const formId of writes.keys()) {
      if (formById(state, formId) === undefined) {
        writes.delete(formId);
        awaitingActive.delete(formId);
        writer.delete(formId);
      }
    }
    for (const form of state.forms) {
      writesOf(writes, writer, form.formId).write(deps.placeOf(state, form));
    }
    restoreNowActive(state);
  });
  return {
    saved,
    formsRead(formIds) {
      for (const formId of formIds) {
        const place = saved.get(formId);
        if (place === undefined) {
          continue;
        }
        if (store.get().activeFormId !== formId) {
          awaitingActive.add(formId);
        }
        deps.restore(formId, place);
      }
      const read = new Set(formIds);
      pruneKeys(
        writer,
        (formId) =>
          read.has(formId) || formById(store.get(), formId) !== undefined,
      );
    },
    dispose() {
      subscription.dispose();
    },
  };
}

function writesOf<Place>(
  writes: Map<string, PlaceWrites<Place>>,
  writer: KeyedSlotWriter<Place>,
  formId: string,
): PlaceWrites<Place> {
  let formWrites = writes.get(formId);
  if (formWrites === undefined) {
    formWrites = placeWrites((place) => writer.set(formId, place));
    writes.set(formId, formWrites);
  }
  return formWrites;
}
