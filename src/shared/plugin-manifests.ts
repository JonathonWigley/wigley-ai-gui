import type { CommandId } from '../contracts/commands';
import type {
  AcceleratorBind,
  EditorBind,
  EditorKeymap,
  EditorRemap,
  InterceptBind,
  Keymap,
  KeymapUnbind,
  PageBind,
  UserKeymap,
} from '../contracts/keymap';
import type {
  CommandDecl,
  CommandInfo,
  PluginKeys,
  PluginManifest,
  ScopeInfo,
} from '../contracts/plugin';
import type { TokenDecl, TokenKind } from '../contracts/theme';
import { editorBindMode, withLeader } from './key-hints';
import { startsWith } from './keymap-checks';
import { themeVariable } from './theme-variables';

const THEME_TOKEN_NAME = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

// `<pluginId>.<short>`: a plugin's command or scope under its qualified name.
export function qualify(pluginId: string, short: string): string {
  return `${pluginId}.${short}`;
}

// Every manifest's binds from `select`, each naming its qualified command.
function qualifiedBinds<Bind extends { command: string }>(
  manifests: readonly PluginManifest[],
  select: (keys: PluginKeys<string, string, string>) => readonly Bind[],
): Bind[] {
  return manifests.flatMap((manifest) =>
    select(manifest.keys).map((bind) => ({
      ...bind,
      command: qualify(manifest.id, bind.command),
    })),
  );
}

// Every manifest's scoped binds from `select`, each naming its qualified
// command and scope; the `any` scope stays unqualified.
function qualifiedScopedBinds<Bind extends { scope: string; command: string }>(
  manifests: readonly PluginManifest[],
  select: (keys: PluginKeys<string, string, string>) => readonly Bind[],
): Bind[] {
  return manifests.flatMap((manifest) =>
    select(manifest.keys).map((bind) => ({
      ...bind,
      scope: bind.scope === 'any' ? 'any' : qualify(manifest.id, bind.scope),
      command: qualify(manifest.id, bind.command),
    })),
  );
}

// The manifests in the order their plugins start: repeatedly the first, in
// list order, whose `dependsOn` have all been taken. A dependency on a plugin
// not in `manifests` holds nothing back. Throws on a dependency cycle.
export function dependencyOrder(
  manifests: readonly PluginManifest[],
): PluginManifest[] {
  const listed = new Set(manifests.map((manifest) => manifest.id));
  const taken = new Set<string>();
  const ordered: PluginManifest[] = [];
  let pending = [...manifests];
  while (pending.length > 0) {
    const ready = pending.find((manifest) =>
      manifest.dependsOn.every((id) => taken.has(id) || !listed.has(id)),
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

function bindIdentities(leader: string): BindIdentities {
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
    accelerators: (a, b) => a.accelerator === b.accelerator,
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

// The binds one layer lays over the earlier ones; the leader is the merge's.
type KeymapLayer = Omit<Keymap, 'editor'> & {
  editor: Omit<EditorKeymap, 'leader'>;
};

// One plugin's default keys, their commands and scopes qualified as
// `<pluginId>.<short>`; the `any` scope stays unqualified.
function pluginLayer(manifest: PluginManifest): KeymapLayer {
  return {
    editor: {
      remaps: [],
      binds: qualifiedScopedBinds([manifest], (keys) => keys.editor),
    },
    page: qualifiedScopedBinds([manifest], (keys) => keys.page),
    app: qualifiedBinds([manifest], (keys) => keys.app),
    intercept: qualifiedBinds([manifest], (keys) => keys.intercept),
    global: qualifiedBinds([manifest], (keys) => keys.global),
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
  };
}

// `keymap` without each bind an entry of `unbind` names; an entry naming no
// bind removes nothing.
function withoutUnbound(
  keymap: Keymap,
  unbind: readonly KeymapUnbind[],
  same: BindIdentities,
): Keymap {
  const isUnbound = (names: (entry: KeymapUnbind) => boolean) =>
    unbind.some(names);
  return {
    editor: {
      ...keymap.editor,
      binds: keymap.editor.binds.filter(
        (bind) =>
          !isUnbound(
            (entry) =>
              'editor' in entry &&
              same.editorBinds(bind, {
                ...entry,
                keys: entry.editor,
                command: '',
              }),
          ),
      ),
    },
    page: keymap.page.filter(
      (bind) =>
        !isUnbound(
          (entry) =>
            'page' in entry &&
            same.page(bind, {
              keys: entry.page,
              scope: entry.scope,
              command: '',
            }),
        ),
    ),
    app: keymap.app.filter(
      (bind) =>
        !isUnbound((entry) => 'app' in entry && entry.app === bind.accelerator),
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
          (entry) => 'global' in entry && entry.global === bind.accelerator,
        ),
    ),
  };
}

// The keymap in layers: `core`, then each manifest's binds in `dependencyOrder`
// (commands and scopes qualified as `<pluginId>.<short>`, the `any` scope left
// unqualified), then the user's. A later layer's bind replaces an earlier
// layer's bind on the same keys in the same scope (the same accelerator for
// app and global binds, the same key and modifiers for intercepts), taking its
// place; any other appends. The user layer first removes each bind its
// `unbind` names from the core and plugin layers, and its `editor.leader`
// replaces the core's, which the editor binds and remaps compare keys with.
export function mergeKeymap(
  core: Keymap,
  manifests: readonly PluginManifest[],
  user: UserKeymap,
): Keymap {
  const leader = user.editor?.leader ?? core.editor.leader;
  const same = bindIdentities(leader);
  let merged: Keymap = { ...core, editor: { ...core.editor, leader } };
  for (const manifest of dependencyOrder(manifests)) {
    merged = keymapLayerOver(merged, pluginLayer(manifest), same);
  }
  merged = withoutUnbound(merged, user.unbind ?? [], same);
  return keymapLayerOver(
    merged,
    {
      editor: {
        remaps: user.editor?.remaps ?? [],
        binds: user.editor?.binds ?? [],
      },
      page: user.page ?? [],
      app: user.app ?? [],
      intercept: user.intercept ?? [],
      global: user.global ?? [],
    },
    same,
  );
}

// Every command by id: the core's under their own ids with plugin `core`,
// each plugin's qualified as `<pluginId>.<short>`. Throws when a plugin's
// qualified id is one the core already declares.
export function commandInfos(
  core: Record<CommandId, CommandDecl>,
  manifests: readonly PluginManifest[],
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
