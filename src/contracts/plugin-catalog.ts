import type { Disposable } from './disposable';
import type { MainPart, PluginManifest } from './plugin';

// Where a catalog entry came from: compiled into the app, a user plugin
// folder, or a user plugin folder holding a built-in's id.
export type PluginOrigin = 'built-in' | 'user' | 'replaces-built-in';

// One plugin the catalog holds now. `revision` grows with each load of a user
// plugin and is 0 for a built-in. `main` is null when the plugin has no main
// part. `pageUrl` is the `wigley-plugin:` URL of a user plugin's page.js, null
// for a built-in or a plugin with no page.js.
export interface CatalogEntry {
  readonly manifest: PluginManifest;
  readonly origin: PluginOrigin;
  readonly revision: number;
  readonly main: MainPart | null;
  readonly pageUrl: string | null;
  readonly folder: string | null; // the user folder, null for a built-in
}

// Why a plugin is not loaded, or why its last good load is still the one
// running: a failed load, or a dependency that is not loaded.
export interface CatalogProblem {
  readonly id: string;
  readonly message: string;
}

// Each id sorted by whether it was in the catalog before and after the load.
// A replacement of a built-in, and its removal, are `reloaded`. A change of
// `problems()` alone fires with three empty lists.
export interface CatalogChange {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly reloaded: readonly string[];
}

// One load of one plugin by a source: its entry, the message of a load that
// failed, or `gone` for an id the source no longer holds.
export type SourceLoad =
  | { readonly kind: 'loaded'; readonly entry: Omit<CatalogEntry, 'origin'> }
  | { readonly kind: 'failed'; readonly id: string; readonly message: string }
  | { readonly kind: 'gone'; readonly id: string };

// Where the catalog's plugins come from. `loadAll` loads every plugin the
// source holds, leaving out `gone`; `watch` sends each later load, and
// `reload` loads one id again.
export interface PluginSource {
  loadAll(): Promise<readonly SourceLoad[]>;
  watch(listener: (load: SourceLoad) => void): Disposable;
  reload(id: string): Promise<SourceLoad>;
}

// The plugins the app runs: the built-ins and the user's plugin folders, a
// user plugin replacing the built-in of its id.
export interface PluginCatalog {
  entries(): readonly CatalogEntry[];
  manifests(): readonly PluginManifest[];
  problems(): readonly CatalogProblem[];
  entry(id: string): CatalogEntry | undefined;
  onChanged(listener: (change: CatalogChange) => void): Disposable;
  // Rejects for a built-in id ("…built in; it reloads only with a rebuild")
  // and for an unknown id ("No plugin "<id>"").
  reload(id: string): Promise<void>;
}

// What the page needs about each plugin, served in `AppConfig.plugins`.
export interface ServedPlugin {
  readonly id: string;
  readonly origin: PluginOrigin;
  readonly revision: number;
  readonly pageUrl: string | null;
  readonly manifest: PluginManifest;
}
