import type { Disposable } from './disposable';
import type { ProcessName } from './plugin';

// Maps T to itself when T is JSON and to never otherwise, so a slot of a function,
// Map, Set or class with a method fails to compile, and so does a required member
// typed `T | undefined`. An optional member passes, and so does `unknown`.
export type JsonSafe<T> = unknown extends T
  ? T
  : T extends string | number | boolean | null
    ? T
    : T extends (...args: never[]) => unknown
      ? never
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : never;

// `unknown` for a JSON value, `never` otherwise: a publish parameter intersects it.
export type JsonSlot<V> = [V] extends [JsonSafe<V>] ? unknown : never;

// A key is a typed object literal in its owner's `contract.ts`, as `DependencyKey`
// is. `process` is the process of the only writer. `valueType` is never set.
export interface SlotKey<
  V,
  P extends ProcessName = ProcessName,
  Plugin extends string = string,
> {
  readonly id: `${Plugin}.${string}`;
  readonly process: P;
  readonly kind: 'value';
  readonly valueType?: V; // type only; never set
}

export interface KeyedSlotKey<
  V,
  P extends ProcessName = ProcessName,
  Plugin extends string = string,
> {
  readonly id: `${Plugin}.${string}`;
  readonly process: P;
  readonly kind: 'keyed';
  readonly valueType?: V; // type only; never set
}

export interface ListSlotKey<
  V extends { readonly id: string },
  P extends ProcessName = ProcessName,
  Plugin extends string = string,
> {
  readonly id: `${Plugin}.${string}`;
  readonly process: P;
  readonly kind: 'list';
  readonly valueType?: V; // type only; never set
}

// A writer is one live claim on its slot, and `dispose` releases it. A write after
// `dispose` does nothing and logs `<id> written after stop`; the value stays for the
// next publish, which reads it through `get`. A value is not changed after `set`.
export interface SlotWriter<V> extends Disposable {
  get(): V | undefined;
  set(value: V): void;
}
export interface KeyedSlotWriter<V> extends Disposable {
  get(key: string): V | undefined;
  all(): ReadonlyMap<string, V>;
  set(key: string, value: V): void;
  delete(key: string): void;
}
export interface ListSlotWriter<V> extends Disposable {
  get(key: string): readonly V[];
  put(key: string, item: V): void; // replaces the item with item.id, else appends
  replace(key: string, items: readonly V[]): void;
  delete(key: string): void;
}

// A slot no owner has written reads `undefined`, or `[]` for a list. `on` hears
// changes told after it is added, a delete of an absent key being none, so a listener
// added inside another listener hears a change still queued; and a listener's throw is
// logged under the listening plugin as `<id> listener failed: <error>`. `all`
// returns a new map in first-set order, and `get` of a list an array no later write
// changes.
export interface SlotReader<V> {
  get(): V | undefined;
  on(listener: (value: V | undefined) => void): Disposable;
}
export interface KeyedSlotReader<V> {
  get(key: string): V | undefined;
  all(): ReadonlyMap<string, V>;
  on(listener: (key: string, value: V | undefined) => void): Disposable;
}
export type ListSlotChange<V> =
  | { kind: 'put'; item: V }
  | { kind: 'replace'; items: readonly V[] }
  | { kind: 'delete' };
export interface ListSlotReader<V> {
  get(key: string): readonly V[];
  on(listener: (key: string, change: ListSlotChange<V>) => void): Disposable;
}

// What a layout reads. By the slot's kind, `get()` is the value or the `[key, value]`
// entries in first-set order, and `on` passes `(value)`, `(key, value)` or
// `(key, change)`. `get(key)` is `undefined` on a value slot, the entry or
// `undefined` on a keyed slot, and the items or `[]` on a list slot. An id with no
// slot reads `undefined`, and its listener hears the first write's arguments.
export interface LayoutSlotReader {
  get(key?: string): unknown;
  on(listener: (...args: unknown[]) => void): Disposable;
}
export interface LayoutState {
  read(id: string): LayoutSlotReader;
}

// What crosses the Bridge. A keyed change with an `undefined` value is a
// delete. A `cleared` change empties its slot, which keeps its kind, and its
// listeners hear one delete per entry it held; only main sends one, and main
// ignores one from the page.
export type SlotChange =
  | { id: string; kind: 'value'; value: unknown }
  | { id: string; kind: 'keyed'; key: string; value: unknown | undefined }
  | { id: string; kind: 'list'; key: string; change: ListSlotChange<unknown> }
  | { id: string; kind: 'cleared' };

// Keyed and list slots cross as entries in first-set order: a JS object would sort
// an all-digit key first.
export type SlotSnapshot =
  | { kind: 'value'; value: unknown }
  | { kind: 'keyed'; entries: readonly (readonly [string, unknown])[] }
  | {
      kind: 'list';
      entries: readonly (readonly [string, readonly unknown[]])[];
    };

// `seq` is the number of changes main has applied this app run.
export interface StateSnapshot {
  seq: number;
  slots: Record<string, SlotSnapshot>;
}
