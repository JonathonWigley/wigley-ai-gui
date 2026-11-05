import type { CommandId } from '../contracts/commands';
import type {
  AcceleratorBind,
  BindWhere,
  DefaultKeymap,
  EditorBind,
  EditorKeymap,
  EditorRemap,
  InterceptBind,
  KeyBind,
  KeyGroups,
  Keymap,
  KeymapUnbind,
  PageBind,
  UserKeymap,
} from '../contracts/keymap';
import type {
  CommandDecl,
  CommandInfo,
  PluginManifest,
  ScopeInfo,
  SettingInfo,
  SettingKind,
} from '../contracts/plugin';
import type { Settings } from '../contracts/settings';
import type { TokenDecl, TokenKind } from '../contracts/theme';
import type { Log } from '../contracts/log';
import { canonicalAccelerator } from './accelerator';
import { parseChord } from './chord-notation';
import { errorText } from './error-text';
import { editorBindMode, vimTokens, withLeader } from './key-hints';
import { pageKeysFor } from './key-notation';
import {
  requireUnambiguousBinds,
  requireUnambiguousEditorBinds,
  requireWellFormedChords,
  startsWith,
} from './keymap-checks';
import { themeVariable } from './theme-variables';

const THEME_TOKEN_NAME = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

// `<pluginId>.<short>`: a plugin's command or scope under its qualified name.
export function qualify(pluginId: string, short: string): string {
  return `${pluginId}.${short}`;
}

// The label of the command `id`, or `id` for a command the catalog lacks.
export function commandLabel(
  commands: Readonly<Record<CommandId, Pick<CommandInfo, 'label'>>>,
  id: CommandId,
): string {
  return commands[id]?.label ?? id;
}

// Throws when the plugin of `manifest` declares no scope named `scope`.
export function requireDeclaredScope(
  manifest: Pick<PluginManifest, 'id' | 'scopes'>,
  scope: string,
) {
  if (!Object.hasOwn(manifest.scopes, scope)) {
    throw new Error(`Plugin "${manifest.id}" declares no scope "${scope}"`);
  }
}

// The ids in either of the manifest's `dependsOn` lists: its `main` list, then
// its `page` list, each id once.
function dependencyIds(manifest: PluginManifest): string[] {
  return [...new Set([...manifest.dependsOn.main, ...manifest.dependsOn.page])];
}

// The manifests in dependency order: repeatedly the first, in list order, whose
// dependencies in either `dependsOn` list have all been taken. A dependency on a
// plugin not in `manifests` holds nothing back. Throws on a dependency cycle.
export function dependencyOrder(
  manifests: readonly PluginManifest[],
): PluginManifest[] {
  const listed = new Set(manifests.map((manifest) => manifest.id));
  const taken = new Set<string>();
  const ordered: PluginManifest[] = [];
  let pending = [...manifests];
  while (pending.length > 0) {
    const ready = pending.find((manifest) =>
      dependencyIds(manifest).every((id) => taken.has(id) || !listed.has(id)),
    );
    if (!ready) {
      const waiting = pending.map((manifest) => manifest.id).join(', ');
      throw new Error(`Plugins depend on each other in a cycle: ${waiting}`);
    }
    ordered.push(ready);
    taken.add(ready.id);
    pending = pending.filter((manifest) => manifest !== ready);
  }
  return ordered;
}

// The problem with a `plugins.disabled` list: the first plugin it names that
// a plugin it leaves started depends on in either `dependsOn` list, walking
// `manifests` in list order and each one's lists in order, `main` then `page`.
// Null when no started plugin depends on a disabled one; an id no manifest has
// disables nothing.
export function disabledDependencyProblem(
  disabled: readonly string[],
  manifests: readonly PluginManifest[],
): string | null {
  for (const manifest of manifests) {
    if (disabled.includes(manifest.id)) {
      continue;
    }
    const dependency = dependencyIds(manifest).find((id) =>
      disabled.includes(id),
    );
    if (dependency !== undefined) {
      return `"plugins.disabled" names "${dependency}", which "${manifest.id}" depends on.`;
    }
  }
  return null;
}

// `keymap` without the binds of `side`'s process whose command belongs to a
// plugin in `pluginIds`: on `main` its app, intercept and global binds, on
// `page` its editor and page binds. A bind whose command is not in `commands`
// stays, though the served keymap holds none: the config checks hold such a bind
// back.
export function withoutPluginBinds(
  keymap: Keymap,
  commands: Record<CommandId, CommandInfo>,
  pluginIds: readonly string[],
  side: 'main' | 'page',
): Keymap {
  const isKept = (bind: { command: CommandId }) =>
    !(
      Object.hasOwn(commands, bind.command) &&
      pluginIds.includes(commands[bind.command].plugin)
    );
  if (side === 'main') {
    return {
      ...keymap,
      app: keymap.app.filter(isKept),
      intercept: keymap.intercept.filter(isKept),
      global: keymap.global.filter(isKept),
    };
  }
  return {
    ...keymap,
    editor: { ...keymap.editor, binds: keymap.editor.binds.filter(isKept) },
    page: keymap.page.filter(isKept),
  };
}

// `keymap` without the binds of `side`'s process that name a runtime command of
// that process with no handler here: an old page's, or one disposed since the last
// push. A manifest or core command with no handler stays, for `requireRegistered`
// to report as the bug it is.
export function withoutUnhandledRuntimeBinds(
  keymap: Keymap,
  commands: Record<CommandId, CommandInfo>,
  has: (id: CommandId) => boolean,
  side: 'main' | 'page',
): Keymap {
  const isKept = ({ command }: { command: CommandId }) => {
    const info = Object.hasOwn(commands, command)
      ? commands[command]
      : undefined;
    return !(info?.runtime === true && info.runsIn === side && !has(command));
  };
  if (side === 'main') {
    return {
      ...keymap,
      app: keymap.app.filter(isKept),
      intercept: keymap.intercept.filter(isKept),
      global: keymap.global.filter(isKept),
    };
  }
  return {
    ...keymap,
    editor: { ...keymap.editor, binds: keymap.editor.binds.filter(isKept) },
    page: keymap.page.filter(isKept),
  };
}

type SameBind<B> = (a: B, b: B) => boolean;

// How the merge tells that a later layer's bind replaces an earlier one, for
// each list of the keymap; the editor's compare keys with `leader` spelled.
interface BindIdentities {
  page: SameBind<PageBind>;
  editorBinds: SameBind<EditorBind>;
  remaps: SameBind<EditorRemap>;
  accelerators: SameBind<AcceleratorBind>;
  intercept: SameBind<Omit<InterceptBind, 'command'>>;
}

// Whether two accelerators name one chord, however each spells it.
export function isSameAccelerator(a: string, b: string): boolean {
  return canonicalAccelerator(a) === canonicalAccelerator(b);
}

export function bindIdentities(leader: string): BindIdentities {
  const sameKeys = (a: string, b: string) =>
    withLeader(a, leader) === withLeader(b, leader);
  return {
    page: (a, b) =>
      a.scope === b.scope &&
      a.keys.length === b.keys.length &&
      startsWith(a.keys, b.keys),
    editorBinds: (a, b) =>
      a.scope === b.scope &&
      editorBindMode(a) === editorBindMode(b) &&
      sameKeys(a.keys, b.keys),
    remaps: (a, b) => a.mode === b.mode && sameKeys(a.keys, b.keys),
    accelerators: (a, b) => isSameAccelerator(a.accelerator, b.accelerator),
    intercept: (a, b) =>
      a.key === b.key &&
      Boolean(a.control) === Boolean(b.control) &&
      Boolean(a.alt) === Boolean(b.alt) &&
      Boolean(a.shift) === Boolean(b.shift) &&
      Boolean(a.meta) === Boolean(b.meta),
  };
}

// `earlier` with `layer` laid over it: each bind of `layer` takes the place of
// the earlier layers' bind it matches, or appends after every earlier bind.
// Binds inside `layer` never replace each other, so a clash inside one layer
// stays for the keymap checks to find.
function layerOver<B>(
  earlier: readonly B[],
  layer: readonly B[],
  same: SameBind<B>,
): B[] {
  const merged = earlier.map((bind) => ({ bind, isThisLayer: false }));
  for (const bind of layer) {
    const replaced = merged.findIndex(
      (entry) => !entry.isThisLayer && same(entry.bind, bind),
    );
    if (replaced === -1) {
      merged.push({ bind, isThisLayer: true });
    } else {
      merged[replaced] = { bind, isThisLayer: true };
    }
  }
  return merged.map((entry) => entry.bind);
}

// What a bind entry `where` says, or its default: a leader bind fires on the
// page and in a box, any other bind on the page.
function bindWhere(bind: KeyBind): BindWhere {
  return bind.where ?? (bind.keys.startsWith('<Leader>') ? 'both' : 'page');
}

// The page bind and editor bind `bind` stands for, either null when it does
// not fire there: a bind with `mode` fires only in a box, in that mode; a
// chord alone fires only as a page bind, which fires inside a box already;
// any other fires where `bindWhere` says. The page bind's keys are the page
// keys, `<Leader>` spelled as `leader`; the editor bind keeps `keys` as
// written. Throws on a `where` the bind cannot take, and on page keys with a
// `<…>` token the page has no key for. Both halves carry `arg`.
export function expandBind(
  bind: KeyBind,
  leader: string,
): { page: PageBind | null; editor: EditorBind | null } {
  const { keys, scope, command, where, mode, arg } = bind;
  const carried = arg === undefined ? {} : { arg };
  if (mode !== undefined) {
    if (where !== undefined && where !== 'box') {
      throw new Error(
        `${keys} has a mode, so it fires in a box only; it takes no where "${where}".`,
      );
    }
    return { page: null, editor: { keys, scope, command, mode, ...carried } };
  }
  const tokens = vimTokens(keys, '<Leader>');
  const isChord = tokens.length === 1 && parseChord(tokens[0]) !== null;
  if (isChord && where !== undefined && where !== 'page') {
    throw new Error(
      `${keys} is a chord, whose page bind fires inside a box too; it takes no where "${where}".`,
    );
  }
  const firesWhere = isChord ? 'page' : bindWhere(bind);
  const page =
    firesWhere === 'box'
      ? null
      : { keys: pageKeysFor(keys, leader), scope, command, ...carried };
  const editor =
    firesWhere === 'page' ? null : { keys, scope, command, ...carried };
  return { page, editor };
}

// The page binds and editor binds `binds` expand to, each list in the order
// of the entries that make it.
function expandBinds(
  binds: readonly KeyBind[],
  leader: string,
): { page: PageBind[]; editor: EditorBind[] } {
  const expanded = binds.map((bind) => expandBind(bind, leader));
  return {
    page: expanded.flatMap((halves) => (halves.page ? [halves.page] : [])),
    editor: expanded.flatMap((halves) =>
      halves.editor ? [halves.editor] : [],
    ),
  };
}

// The binds one layer lays over the earlier ones; the leader is the merge's.
type KeymapLayer = Omit<Keymap, 'editor' | 'groups'> & {
  editor: Omit<EditorKeymap, 'leader'>;
};

// One layer's keys in the default keymap's shape, its binds expanded with
// `leader`.
function keymapLayer(
  keys: Omit<UserKeymap, 'leader' | 'groups' | 'unbind'>,
  leader: string,
): KeymapLayer {
  const binds = expandBinds(keys.binds ?? [], leader);
  return {
    editor: { remaps: keys.remaps ?? [], binds: binds.editor },
    page: binds.page,
    app: keys.app ?? [],
    intercept: keys.intercept ?? [],
    global: keys.global ?? [],
  };
}

// One layer of keys under the user's: the default keymap's, or one plugin's.
export type DefaultKeyLayer = Omit<UserKeymap, 'leader' | 'unbind'>;

// One plugin's default keys, their commands and scopes qualified as
// `<pluginId>.<short>`; the `any` scope stays unqualified.
function pluginKeys(manifest: PluginManifest): DefaultKeyLayer {
  const keys = manifest.keys ?? {};
  const qualifyCommand = <Bind extends { command: string }>(bind: Bind) => ({
    ...bind,
    command: qualify(manifest.id, bind.command),
  });
  return {
    groups: keys.groups ?? {},
    binds: (keys.binds ?? []).map((bind) => ({
      ...qualifyCommand(bind),
      scope: bind.scope === 'any' ? 'any' : qualify(manifest.id, bind.scope),
    })),
    app: (keys.app ?? []).map(qualifyCommand),
    intercept: (keys.intercept ?? []).map(qualifyCommand),
    global: (keys.global ?? []).map(qualifyCommand),
  };
}

function keymapLayerOver(
  earlier: Keymap,
  layer: KeymapLayer,
  same: BindIdentities,
): Keymap {
  return {
    editor: {
      leader: earlier.editor.leader,
      remaps: layerOver(
        earlier.editor.remaps,
        layer.editor.remaps,
        same.remaps,
      ),
      binds: layerOver(
        earlier.editor.binds,
        layer.editor.binds,
        same.editorBinds,
      ),
    },
    page: layerOver(earlier.page, layer.page, same.page),
    app: layerOver(earlier.app, layer.app, same.accelerators),
    intercept: layerOver(earlier.intercept, layer.intercept, same.intercept),
    global: layerOver(earlier.global, layer.global, same.accelerators),
    groups: earlier.groups,
  };
}

// `binds` with each bind of `layer` moved ahead of the other binds of its
// command, into the first place one of them held; the rest keep their order.
function layerBindsFirst<B extends { command: CommandId }>(
  binds: readonly B[],
  layer: readonly B[],
): B[] {
  const isLayerBind = new Set(layer);
  const byCommand = new Map<CommandId, B[]>();
  for (const bind of binds) {
    const own = byCommand.get(bind.command) ?? [];
    own.push(bind);
    byCommand.set(bind.command, own);
  }
  for (const own of byCommand.values()) {
    own.sort((a, b) => Number(isLayerBind.has(b)) - Number(isLayerBind.has(a)));
  }
  return binds.map((bind) => byCommand.get(bind.command)!.shift()!);
}

// `layers`' group names in order, a later layer's name replacing an earlier
// one on the same keys with `leader` spelled, in the earlier one's place.
function mergeGroups(layers: readonly KeyGroups[], leader: string): KeyGroups {
  const merged = new Map<string, [keys: string, name: string]>();
  for (const groups of layers) {
    for (const [keys, name] of Object.entries(groups)) {
      merged.set(withLeader(keys, leader), [keys, name]);
    }
  }
  return Object.fromEntries(merged.values());
}

// `keymap` without each bind an entry of `unbind` names; an entry naming no
// bind removes nothing. A `keys` entry is expanded with `leader` as a bind is.
function withoutUnbound(
  keymap: Keymap,
  unbind: readonly KeymapUnbind[],
  leader: string,
  same: BindIdentities,
): Keymap {
  const unboundBinds = expandBinds(
    unbind.flatMap((entry) =>
      'keys' in entry ? [{ ...entry, command: '' }] : [],
    ),
    leader,
  );
  const isUnbound = (names: (entry: KeymapUnbind) => boolean) =>
    unbind.some(names);
  return {
    ...keymap,
    editor: {
      ...keymap.editor,
      binds: keymap.editor.binds.filter(
        (bind) =>
          !unboundBinds.editor.some((unbound) =>
            same.editorBinds(bind, unbound),
          ),
      ),
    },
    page: keymap.page.filter(
      (bind) => !unboundBinds.page.some((unbound) => same.page(bind, unbound)),
    ),
    app: keymap.app.filter(
      (bind) =>
        !isUnbound(
          (entry) =>
            'app' in entry && isSameAccelerator(entry.app, bind.accelerator),
        ),
    ),
    intercept: keymap.intercept.filter(
      (bind) =>
        !isUnbound(
          (entry) =>
            'intercept' in entry && same.intercept(bind, entry.intercept),
        ),
    ),
    global: keymap.global.filter(
      (bind) =>
        !isUnbound(
          (entry) =>
            'global' in entry &&
            isSameAccelerator(entry.global, bind.accelerator),
        ),
    ),
  };
}

// Which of `bind`'s halves `other` matches as the merge tells binds apart:
// each expanded with `expandBind` under `leader`, page halves compared as page
// binds and editor halves as editor binds. A `keys` unbind entry expands as a
// bind does; an accelerator unbind entry matches neither half. Throws as
// `expandBind` does.
export function sharedHalves(
  other: KeyBind | KeymapUnbind,
  bind: KeyBind,
  leader: string,
): { page: boolean; editor: boolean } {
  if (!('keys' in other)) {
    return { page: false, editor: false };
  }
  const same = bindIdentities(leader);
  const a = expandBind({ command: '', ...other }, leader);
  const b = expandBind(bind, leader);
  return {
    page: a.page !== null && b.page !== null && same.page(a.page, b.page),
    editor:
      a.editor !== null &&
      b.editor !== null &&
      same.editorBinds(a.editor, b.editor),
  };
}

// Where one half of a default bind stands under the user's layer: still
// firing, taken by a user bind, or removed by a `keys` unbind entry.
export type HalfStanding =
  | { state: 'active' }
  | { state: 'replaced'; by: KeyBind }
  | { state: 'removed'; by: KeymapUnbind };

// Where each half of the default bind `bind` stands under `user`, as
// `mergeKeymap` decides it: removed by the first `keys` unbind entry matching
// that half, else replaced by the first user bind matching it, else active;
// null for a half `bind` does not have. `leader` is the merge's.
export function defaultBindStanding(
  bind: KeyBind,
  user: UserKeymap,
  leader: string,
): { page: HalfStanding | null; editor: HalfStanding | null } {
  const halves = expandBind(bind, leader);
  const unbind = user.unbind ?? [];
  const binds = user.binds ?? [];
  const standing = (half: 'page' | 'editor'): HalfStanding | null => {
    if (halves[half] === null) {
      return null;
    }
    const remover = unbind.find(
      (entry) => sharedHalves(entry, bind, leader)[half],
    );
    if (remover !== undefined) {
      return { state: 'removed', by: remover };
    }
    const replacer = binds.find(
      (other) => sharedHalves(other, bind, leader)[half],
    );
    if (replacer !== undefined) {
      return { state: 'replaced', by: replacer };
    }
    return { state: 'active' };
  };
  return { page: standing('page'), editor: standing('editor') };
}

// A default bind that fires on at least one half once the default layers are
// merged, each half as `defaultBindStanding` judges it under the user's layer.
export interface DefaultBindLine {
  bind: KeyBind;
  page: HalfStanding | null;
  editor: HalfStanding | null;
}

// Every default bind of `layers` (the binds of `defaultKeyLayers`, in its
// order) that the merge keeps, in layer order: a half a bind of a later
// default layer shares is null, as the merge replaces it there and it never
// fires; a bind left with neither half is dropped. The other halves stand as
// `defaultBindStanding` judges them under `user`. `leader` is the merge's.
export function defaultBindLines(
  layers: readonly (readonly KeyBind[])[],
  user: UserKeymap,
  leader: string,
): DefaultBindLine[] {
  const lines: DefaultBindLine[] = [];
  layers.forEach((binds, index) => {
    const later = layers.slice(index + 1).flat();
    for (const bind of binds) {
      const replacedHalves = later.map((other) =>
        sharedHalves(other, bind, leader),
      );
      const standing = defaultBindStanding(bind, user, leader);
      const line = {
        bind,
        page: replacedHalves.some((shared) => shared.page)
          ? null
          : standing.page,
        editor: replacedHalves.some((shared) => shared.editor)
          ? null
          : standing.editor,
      };
      if (line.page !== null || line.editor !== null) {
        lines.push(line);
      }
    }
  });
  return lines;
}

// The served keymap in layers: `defaults`, then each manifest's keys in
// `dependencyOrder` (commands and scopes qualified as `<pluginId>.<short>`,
// the `any` scope left unqualified), then `runtime`, then the user's. Each
// layer's binds are expanded with `expandBind` first. A later layer's bind
// replaces an earlier layer's bind on the same keys in the same scope (the same
// chord, however its accelerator is spelled, for app and global binds, the same
// key and modifiers for intercepts), taking its place; any other appends. The
// user layer first removes each bind its `unbind` names from the default, plugin
// and runtime layers, and its `leader` replaces the default's, on the page and
// in a box, and each of its page and editor binds moves ahead of the other binds
// of its command, so a command's first bind is the user's. Group names layer the
// same way, by their keys.
export function mergeKeymap(
  defaults: DefaultKeymap,
  manifests: readonly PluginManifest[],
  user: UserKeymap,
  runtime?: DefaultKeyLayer,
): Keymap {
  const leader = user.leader ?? defaults.leader;
  const same = bindIdentities(leader);
  const layers = defaultKeyLayers(defaults, manifests, runtime);
  let merged: Keymap = {
    editor: { leader, remaps: [], binds: [] },
    page: [],
    app: [],
    intercept: [],
    global: [],
    groups: {},
  };
  for (const keys of layers) {
    merged = keymapLayerOver(merged, keymapLayer(keys, leader), same);
  }
  merged = withoutUnbound(merged, user.unbind ?? [], leader, same);
  const userLayer = keymapLayer(user, leader);
  merged = keymapLayerOver(merged, userLayer, same);
  return {
    ...merged,
    editor: {
      ...merged.editor,
      binds: layerBindsFirst(merged.editor.binds, userLayer.editor.binds),
    },
    page: layerBindsFirst(merged.page, userLayer.page),
    groups: mergeGroups(
      [...layers.map((keys) => keys.groups ?? {}), user.groups ?? {}],
      leader,
    ),
  };
}

// The layers `mergeKeymap` lays under the user's, in its order: `defaults`,
// then each manifest's keys in `dependencyOrder`, commands and scopes
// qualified as `<pluginId>.<short>` (the `any` scope left unqualified), then
// `runtime` when given.
export function defaultKeyLayers(
  defaults: DefaultKeymap,
  manifests: readonly PluginManifest[],
  runtime?: DefaultKeyLayer,
): DefaultKeyLayer[] {
  return [
    defaults,
    ...dependencyOrder(manifests).map(pluginKeys),
    ...(runtime === undefined ? [] : [runtime]),
  ];
}

// The first clash inside one runtime layer, as text, or null: the keymap checks over
// its page and editor binds, and two of its app or intercept binds on one chord.
export function runtimeLayerClash(
  layer: DefaultKeyLayer,
  leader: string,
): string | null {
  const same = bindIdentities(leader);
  const firstPair = <B>(binds: readonly B[], isSame: SameBind<B>) =>
    binds.find((bind, index) =>
      binds.slice(index + 1).some((other) => isSame(bind, other)),
    );
  try {
    const expanded = keymapLayer(layer, leader);
    requireUnambiguousBinds(expanded.page);
    requireWellFormedChords(expanded.page);
    requireUnambiguousEditorBinds(expanded.editor.binds, leader);
    const app = firstPair(expanded.app, same.accelerators);
    if (app !== undefined) {
      return `App binds share the chord ${app.accelerator}`;
    }
    const intercept = firstPair(expanded.intercept, same.intercept);
    return intercept === undefined
      ? null
      : `Intercept binds share the chord of ${intercept.command}`;
  } catch (error) {
    return errorText(error);
  }
}

// Every command by id: the core's under their own ids with plugin `core`,
// each plugin's qualified as `<pluginId>.<short>`, then `runtime`'s. Throws when a
// plugin's qualified id is one the core already declares. A runtime id already
// listed keeps the first entry and goes to `log`: a race between processes is no bug
// in the app.
export function commandInfos(
  core: Record<CommandId, CommandDecl>,
  manifests: readonly PluginManifest[],
  runtime: readonly CommandInfo[] = [],
  log?: Log,
): Record<CommandId, CommandInfo> {
  const infos: Record<CommandId, CommandInfo> = {};
  for (const [id, decl] of Object.entries(core)) {
    infos[id] = { ...decl, id, plugin: 'core' };
  }
  for (const manifest of manifests) {
    for (const [short, decl] of Object.entries(manifest.commands)) {
      const id = qualify(manifest.id, short);
      if (Object.hasOwn(infos, id)) {
        throw new Error(`Command "${id}" is declared twice`);
      }
      infos[id] = { ...decl, id, plugin: manifest.id };
    }
  }
  for (const info of runtime) {
    if (Object.hasOwn(infos, info.id)) {
      log?.('config', `command ${info.id} declared twice`);
    } else {
      infos[info.id] = info;
    }
  }
  return infos;
}

// Every scope with its title: each manifest's in declaration order, qualified
// as `<pluginId>.<short>`, manifests in list order, then the core's as given.
export function scopeInfos(
  core: readonly ScopeInfo[],
  manifests: readonly PluginManifest[],
): ScopeInfo[] {
  const pluginScopes = manifests.flatMap((manifest) =>
    Object.entries(manifest.scopes).map(([short, title]) => ({
      id: qualify(manifest.id, short),
      title,
      plugin: manifest.id,
    })),
  );
  return [...pluginScopes, ...core];
}

// Each plugin's settings, by plugin id. Throws when two manifests share an id.
export function pluginSettings(
  manifests: readonly PluginManifest[],
): Record<string, object> {
  const settings = new Map<string, object>();
  for (const manifest of manifests) {
    if (settings.has(manifest.id)) {
      throw new Error(`Plugin "${manifest.id}" is listed twice`);
    }
    settings.set(manifest.id, manifest.settings);
  }
  return Object.fromEntries(settings);
}

// Every setting `settings` holds, by its dotted path, with its default: an
// object's settings under it, an array's first element as `<path>[]`, which
// the user's elements are checked against.
function settingDefaults(settings: object): Map<string, unknown> {
  const defaults = new Map<string, unknown>();
  const pending: { path: string; value: unknown }[] = Object.entries(
    settings,
  ).map(([path, value]) => ({ path, value }));
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    defaults.set(next.path, next.value);
    if (Array.isArray(next.value)) {
      if (next.value.length > 0) {
        pending.push({ path: `${next.path}[]`, value: next.value[0] });
      }
    } else if (typeof next.value === 'object' && next.value !== null) {
      for (const [key, child] of Object.entries(next.value)) {
        pending.push({ path: `${next.path}.${key}`, value: child });
      }
    }
  }
  return defaults;
}

// Throws on a manifest declaring settings whose id is the name of a core
// setting in `defaults`: a plugin's settings sit under its id in `settings.json`,
// where that key is the core setting's. A manifest declaring none has nothing there.
export function requireNoSettingsUnderCoreNames(
  manifests: readonly PluginManifest[],
  defaults: Settings,
): void {
  for (const manifest of manifests) {
    const declaresSettings =
      Object.keys(manifest.settings).length > 0 ||
      Object.keys(manifest.optionalSettings ?? {}).length > 0;
    if (declaresSettings && Object.hasOwn(defaults, manifest.id)) {
      throw new Error(
        `Plugin "${manifest.id}" declares settings but has the name of a core setting, so they cannot sit under its id`,
      );
    }
  }
}

// Every manifest's `optionalSettings`, each path qualified as
// `<pluginId>.<path>`. Throws on a setting defaulting to null whose kind its
// manifest does not declare, which no `settings.json` value could be checked
// against, and on a declared kind for a setting whose default already shows
// one.
export function pluginOptionalSettings(
  manifests: readonly PluginManifest[],
): Record<string, SettingKind> {
  const kinds: Record<string, SettingKind> = {};
  for (const manifest of manifests) {
    const declared = manifest.optionalSettings ?? {};
    for (const [path, value] of settingDefaults(manifest.settings)) {
      const isDeclared = Object.hasOwn(declared, path);
      if (value === null && !isDeclared) {
        throw new Error(
          `Plugin "${manifest.id}" setting "${path}" defaults to null and declares no kind in optionalSettings`,
        );
      }
      if (value !== null && isDeclared) {
        throw new Error(
          `Plugin "${manifest.id}" setting "${path}" declares a kind in optionalSettings but defaults to a value`,
        );
      }
    }
    for (const [path, kind] of Object.entries(declared)) {
      kinds[qualify(manifest.id, path)] = kind;
    }
  }
  return kinds;
}

// The dotted path of each leaf setting `manifest` declares, as `SettingPath`
// names them: each default that is no plain object, an array taken whole, and
// each `optionalSettings` path; a path inside an array's elements (`[]`) is
// none.
function settingLeafPaths(manifest: PluginManifest): Set<string> {
  const leaves = new Set<string>();
  for (const [path, value] of settingDefaults(manifest.settings)) {
    const isPlainObject =
      typeof value === 'object' && value !== null && !Array.isArray(value);
    if (!path.includes('[]') && !isPlainObject) {
      leaves.add(path);
    }
  }
  for (const path of Object.keys(manifest.optionalSettings ?? {})) {
    if (!path.includes('[]')) {
      leaves.add(path);
    }
  }
  return leaves;
}

// Every manifest's `settingInfo`, each path qualified as `<pluginId>.<path>`,
// in declaration order. Throws on a leaf setting with no declaration and on a
// declaration naming no leaf setting.
export function pluginSettingInfo(
  manifests: readonly PluginManifest[],
): Record<string, SettingInfo> {
  const infos: Record<string, SettingInfo> = {};
  for (const manifest of manifests) {
    const leaves = settingLeafPaths(manifest);
    for (const path of leaves) {
      if (!Object.hasOwn(manifest.settingInfo, path)) {
        throw new Error(
          `Plugin "${manifest.id}" setting "${path}" has no declaration in settingInfo`,
        );
      }
    }
    for (const [path, info] of Object.entries(manifest.settingInfo)) {
      if (!leaves.has(path)) {
        throw new Error(
          `Plugin "${manifest.id}" settingInfo declares "${path}", which is no leaf setting`,
        );
      }
      infos[qualify(manifest.id, path)] = info;
    }
  }
  return infos;
}

// Every manifest's theme tokens, each qualified as `<pluginId>.<token>`.
// Throws on a token name that is not lowercase letters and digits joined by
// `-` or `_`, which its CSS variable could not carry unchanged, and on a token
// whose CSS variable is a `core` token's or an earlier plugin token's
// (`status`.`error` and core `status-error` are both `--wg-status-error`).
export function pluginThemeTokens(
  core: Readonly<Record<string, TokenKind>>,
  manifests: readonly PluginManifest[],
): Record<string, TokenDecl> {
  const tokenByVariable = new Map(
    Object.keys(core).map((token) => [themeVariable(token), token]),
  );
  const tokens: Record<string, TokenDecl> = {};
  for (const manifest of manifests) {
    for (const [key, decl] of Object.entries(manifest.themeTokens)) {
      if (!THEME_TOKEN_NAME.test(key)) {
        throw new Error(
          `Plugin "${manifest.id}" theme token "${key}" must be lowercase letters and digits joined by - or _`,
        );
      }
      const token = qualify(manifest.id, key);
      const variable = themeVariable(token);
      const holder = tokenByVariable.get(variable);
      if (holder !== undefined) {
        throw new Error(
          `Theme token "${token}" and theme token "${holder}" share the CSS variable ${variable}`,
        );
      }
      tokenByVariable.set(variable, token);
      tokens[token] = decl;
    }
  }
  return tokens;
}

// `settingsByPlugin` with `overrides` laid over it: each override names a
// plugin and the settings it changes. Throws on a plugin or a setting
// `settingsByPlugin` does not hold, which would otherwise change nothing.
export function overrideSettings(
  settingsByPlugin: Record<string, object>,
  overrides: Record<string, object>,
): Record<string, object> {
  const merged = new Map(Object.entries(settingsByPlugin));
  for (const [pluginId, changed] of Object.entries(overrides)) {
    if (!Object.hasOwn(settingsByPlugin, pluginId)) {
      throw new Error(`Settings override names no plugin "${pluginId}"`);
    }
    const settings = settingsByPlugin[pluginId];
    const unknown = Object.keys(changed).filter(
      (name) => !Object.hasOwn(settings, name),
    );
    if (unknown.length > 0) {
      throw new Error(
        `Settings override names no setting of plugin "${pluginId}": ${unknown.join(', ')}`,
      );
    }
    merged.set(pluginId, { ...settings, ...changed });
  }
  return Object.fromEntries(merged);
}

// Throws naming each part whose manifest is not in `listed`, the manifests the
// served config was built from: that part would get no keys, labels or settings.
export function requireListed(
  parts: readonly { manifest: PluginManifest }[],
  listed: readonly PluginManifest[],
): void {
  const unlisted = parts
    .filter((part) => !listed.includes(part.manifest))
    .map((part) => part.manifest.id);
  if (unlisted.length > 0) {
    throw new Error(
      `Plugin parts with no manifest in the built-in manifests list: ${unlisted.join(', ')}`,
    );
  }
}
