import type { Disposable } from '../../contracts/disposable';
import type { Log } from '../../contracts/log';
import type {
  PluginManifest,
  PluginState,
  ProcessName,
} from '../../contracts/plugin';
import type {
  KeyedSlotKey,
  KeyedSlotReader,
  KeyedSlotWriter,
  LayoutSlotReader,
  LayoutState,
  ListSlotChange,
  ListSlotKey,
  ListSlotReader,
  ListSlotWriter,
  SlotChange,
  SlotKey,
  SlotReader,
  SlotSnapshot,
  SlotWriter,
} from '../../contracts/state';
import { errorText } from '../error-text';
import { createListeners, type Listeners } from '../listeners';

// One process's slots: the store main's holder, the page mirror and the part
// harness share. `publish` takes the key's one live claim, throwing
// `Slot "<id>" is held by a live part` while another writer holds it, and a slot's
// value outlives its writer. A writer's change updates the slot, then runs `onWrite`,
// then the listeners, so a listener that writes again sends its own change second;
// a throw from `onWrite` leaves the slot updated and reaches the writer's caller.
// `applyRemote` updates the slot and runs the listeners only, and `load` does
// neither. `publish`, `load` and `applyRemote` create an absent slot, which is no
// change. A delete of an absent key or list is no change either: nothing runs. Every
// `set` on a value slot is a change, also with an equal value. A slot id used with
// two kinds throws. Listeners are held by id apart from the slots, so one added
// before the slot exists hears the first write.
// `isHeld` is whether a live writer holds the id. `readById` follows the rule on
// `LayoutSlotReader`.
export interface SlotStore {
  publish<V>(key: SlotKey<V>): SlotWriter<V>;
  publish<V>(key: KeyedSlotKey<V>): KeyedSlotWriter<V>;
  publish<V extends { readonly id: string }>(
    key: ListSlotKey<V>,
  ): ListSlotWriter<V>;
  read<V>(key: SlotKey<V>, listenerOwner: string): SlotReader<V>;
  read<V>(key: KeyedSlotKey<V>, listenerOwner: string): KeyedSlotReader<V>;
  read<V extends { readonly id: string }>(
    key: ListSlotKey<V>,
    listenerOwner: string,
  ): ListSlotReader<V>;
  readById(id: string, listenerOwner: string): LayoutSlotReader;
  isHeld(id: string): boolean;
  applyRemote(change: SlotChange): void;
  load(slots: Record<string, SlotSnapshot>): void;
  snapshot(): Record<string, SlotSnapshot>;
  onWrite(listener: (change: SlotChange) => void): Disposable;
}

type ListItem = { readonly id: string };

type AnySlotKey =
  | SlotKey<unknown>
  | KeyedSlotKey<unknown>
  | ListSlotKey<ListItem>;

type Slot =
  | { kind: 'value'; value: unknown }
  | { kind: 'keyed'; entries: Map<string, unknown> }
  | { kind: 'list'; entries: Map<string, readonly ListItem[]> };

type SlotKind = Slot['kind'];

function emptySlot(kind: SlotKind): Slot {
  return kind === 'value'
    ? { kind, value: undefined }
    : { kind, entries: new Map() };
}

function slotOfSnapshot(snapshot: SlotSnapshot): Slot {
  if (snapshot.kind === 'value') {
    return { kind: 'value', value: snapshot.value };
  }
  if (snapshot.kind === 'keyed') {
    return { kind: 'keyed', entries: new Map(snapshot.entries) };
  }
  return {
    kind: 'list',
    entries: new Map(
      snapshot.entries as readonly (readonly [string, readonly ListItem[]])[],
    ),
  };
}

function snapshotOfSlot(slot: Slot): SlotSnapshot {
  if (slot.kind === 'value') {
    return { kind: 'value', value: slot.value };
  }
  return slot.kind === 'keyed'
    ? { kind: 'keyed', entries: [...slot.entries] }
    : { kind: 'list', entries: [...slot.entries] };
}

function listWithChange(
  items: readonly ListItem[],
  change: Exclude<ListSlotChange<ListItem>, { kind: 'delete' }>,
): readonly ListItem[] {
  if (change.kind === 'replace') {
    return [...change.items];
  }
  const index = items.findIndex(({ id }) => id === change.item.id);
  return index === -1
    ? [...items, change.item]
    : items.map((item, at) => (at === index ? change.item : item));
}

// Applies `change` to `slot`, which is of the change's kind; false when it changed
// nothing.
function applyChange(slot: Slot, change: SlotChange): boolean {
  if (slot.kind === 'value' && change.kind === 'value') {
    slot.value = change.value;
    return true;
  }
  if (slot.kind === 'keyed' && change.kind === 'keyed') {
    if (change.value === undefined) {
      return slot.entries.delete(change.key);
    }
    slot.entries.set(change.key, change.value);
    return true;
  }
  if (slot.kind === 'list' && change.kind === 'list') {
    const listChange = change.change as ListSlotChange<ListItem>;
    if (listChange.kind === 'delete') {
      return slot.entries.delete(change.key);
    }
    const items = slot.entries.get(change.key) ?? [];
    slot.entries.set(change.key, listWithChange(items, listChange));
    return true;
  }
  throw new Error(
    `Slot "${change.id}" is a ${slot.kind} slot, not ${change.kind}`,
  );
}

function listenerArguments(change: SlotChange): readonly unknown[] {
  if (change.kind === 'value') {
    return [change.value];
  }
  return change.kind === 'keyed'
    ? [change.key, change.value]
    : [change.key, change.change];
}

// The plugin id `<id>` sits under.
function ownerOf(id: string): string {
  return id.slice(0, id.indexOf('.'));
}

export function createSlotStore(log: Log): SlotStore {
  const slots = new Map<string, Slot>();
  const claims = new Set<string>();
  const listenersById = new Map<string, Listeners<readonly unknown[]>>();
  const writes = createListeners<SlotChange>();

  const slotFor = (id: string, kind: SlotKind): Slot => {
    const existing = slots.get(id);
    if (existing === undefined) {
      const created = emptySlot(kind);
      slots.set(id, created);
      return created;
    }
    if (existing.kind !== kind) {
      throw new Error(`Slot "${id}" is a ${existing.kind} slot, not ${kind}`);
    }
    return existing;
  };

  const tellListeners = (change: SlotChange) => {
    listenersById.get(change.id)?.tell(listenerArguments(change));
  };

  const on = (
    id: string,
    listenerOwner: string,
    listener: (...args: never[]) => void,
  ): Disposable => {
    let listeners = listenersById.get(id);
    if (listeners === undefined) {
      listeners = createListeners();
      listenersById.set(id, listeners);
    }
    return listeners.add((args) => {
      try {
        (listener as (...args: readonly unknown[]) => void)(...args);
      } catch (error) {
        log(listenerOwner, `${id} listener failed: ${errorText(error)}`);
      }
    });
  };

  const entriesOf = (id: string, kind: 'keyed' | 'list') => {
    const slot = slots.get(id);
    return slot?.kind === kind ? slot.entries : undefined;
  };
  const valueOf = (id: string) => {
    const slot = slots.get(id);
    return slot?.kind === 'value' ? slot.value : undefined;
  };
  const entryOf = (id: string, key: string) => entriesOf(id, 'keyed')?.get(key);
  const itemsOf = (id: string, key: string) =>
    (entriesOf(id, 'list')?.get(key) ?? []) as readonly ListItem[];
  const allOf = (id: string) => new Map(entriesOf(id, 'keyed'));

  // Claims `id`, and returns what its writer writes through and disposes with.
  const claim = (id: string, kind: SlotKind) => {
    if (claims.has(id)) {
      throw new Error(`Slot "${id}" is held by a live part`);
    }
    slotFor(id, kind);
    claims.add(id);
    let isLive = true;
    return {
      write(change: SlotChange) {
        if (!isLive) {
          log(ownerOf(id), `${id} written after stop`);
          return;
        }
        if (applyChange(slotFor(id, kind), change)) {
          writes.tell(change);
          tellListeners(change);
        }
      },
      dispose() {
        if (isLive) {
          isLive = false;
          claims.delete(id);
        }
      },
    };
  };

  const publish = (key: AnySlotKey): Disposable => {
    const { id } = key;
    const { write, dispose } = claim(id, key.kind);
    if (key.kind === 'value') {
      const writer: SlotWriter<unknown> = {
        get: () => valueOf(id),
        set: (value) => write({ id, kind: 'value', value }),
        dispose,
      };
      return writer;
    }
    if (key.kind === 'keyed') {
      const writer: KeyedSlotWriter<unknown> = {
        get: (entry) => entryOf(id, entry),
        all: () => allOf(id),
        set: (entry, value) => write({ id, kind: 'keyed', key: entry, value }),
        delete: (entry) =>
          write({ id, kind: 'keyed', key: entry, value: undefined }),
        dispose,
      };
      return writer;
    }
    const listChange = (entry: string, change: ListSlotChange<ListItem>) =>
      write({ id, kind: 'list', key: entry, change });
    const writer: ListSlotWriter<ListItem> = {
      get: (entry) => itemsOf(id, entry),
      put: (entry, item) => listChange(entry, { kind: 'put', item }),
      replace: (entry, items) => listChange(entry, { kind: 'replace', items }),
      delete: (entry) => listChange(entry, { kind: 'delete' }),
      dispose,
    };
    return writer;
  };

  const read = (key: AnySlotKey, listenerOwner: string): object => {
    const { id } = key;
    const hear = (listener: (...args: never[]) => void) =>
      on(id, listenerOwner, listener);
    if (key.kind === 'value') {
      const reader: SlotReader<unknown> = { get: () => valueOf(id), on: hear };
      return reader;
    }
    if (key.kind === 'keyed') {
      const reader: KeyedSlotReader<unknown> = {
        get: (entry) => entryOf(id, entry),
        all: () => allOf(id),
        on: hear,
      };
      return reader;
    }
    const reader: ListSlotReader<ListItem> = {
      get: (entry) => itemsOf(id, entry),
      on: hear,
    };
    return reader;
  };

  return {
    publish: publish as SlotStore['publish'],
    read: read as SlotStore['read'],
    readById: (id, listenerOwner) => ({
      get(key) {
        const slot = slots.get(id);
        if (slot === undefined) {
          return undefined;
        }
        if (slot.kind === 'value') {
          return key === undefined ? slot.value : undefined;
        }
        if (key === undefined) {
          return [...slot.entries];
        }
        return slot.kind === 'keyed'
          ? slot.entries.get(key)
          : (slot.entries.get(key) ?? []);
      },
      on: (listener) => on(id, listenerOwner, listener),
    }),
    isHeld: (id) => claims.has(id),
    applyRemote(change) {
      if (applyChange(slotFor(change.id, change.kind), change)) {
        tellListeners(change);
      }
    },
    load(loaded) {
      for (const [id, snapshot] of Object.entries(loaded)) {
        slots.set(id, slotOfSnapshot(snapshot));
      }
    },
    snapshot: () =>
      Object.fromEntries(
        Array.from(slots, ([id, slot]) => [id, snapshotOfSlot(slot)]),
      ),
    onWrite: (listener) => writes.add(listener),
  };
}

// One plugin's view of `store`. `publish` throws for a key not under `pluginId` or of
// another process: a part whose `start` takes `any` skips the compile checks. Each
// writer and each `on` goes through `track`.
export function pluginState(
  store: SlotStore,
  pluginId: string,
  process: ProcessName,
  track: <T extends Disposable>(handle: T) => T,
): PluginState<PluginManifest, ProcessName> {
  const publish = (key: AnySlotKey) => {
    if (!key.id.startsWith(`${pluginId}.`)) {
      throw new Error(`Slot "${key.id}" is not under plugin "${pluginId}"`);
    }
    if (key.process !== process) {
      throw new Error(
        `Slot "${key.id}" is a ${key.process} slot, published from ${process}`,
      );
    }
    return track((store.publish as (key: AnySlotKey) => Disposable)(key));
  };
  const read = (key: AnySlotKey) => {
    const reader = (
      store.read as (
        key: AnySlotKey,
        listenerOwner: string,
      ) => SlotReader<unknown>
    )(key, pluginId);
    return {
      ...reader,
      on: (listener: (value: unknown) => void) => track(reader.on(listener)),
    };
  };
  return {
    publish: publish as PluginState<PluginManifest, ProcessName>['publish'],
    read: read as PluginState<PluginManifest, ProcessName>['read'],
  };
}

// One plugin's layouts' view of `store`: each `on` goes through `track` and logs a
// listener's throw under `pluginId`.
export function layoutState(
  store: SlotStore,
  pluginId: string,
  track: <T extends Disposable>(handle: T) => T,
): LayoutState {
  return {
    read(id) {
      const reader = store.readById(id, pluginId);
      return {
        get: reader.get,
        on: (listener) => track(reader.on(listener)),
      };
    },
  };
}
