import type { CommandId } from '../contracts/commands';
import type { Keymap, PageBind } from '../contracts/keymap';
import type {
  CommandDecl,
  CommandInfo,
  PluginKeys,
  PluginManifest,
  ScopeInfo,
} from '../contracts/plugin';

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

function qualifiedPageBinds(manifest: PluginManifest): PageBind[] {
  return manifest.keys.page.map((bind) => ({
    keys: bind.keys,
    scope: bind.scope === 'any' ? 'any' : qualify(manifest.id, bind.scope),
    command: qualify(manifest.id, bind.command),
  }));
}

// The core's keymap with every manifest's binds after the core's own, in list
// order, their commands and scopes qualified as `<pluginId>.<short>`; the
// `any` scope stays unqualified. The editor's leader and remaps are the core's.
export function mergeKeymap(
  core: Keymap,
  manifests: readonly PluginManifest[],
): Keymap {
  return {
    editor: {
      leader: core.editor.leader,
      remaps: core.editor.remaps,
      binds: [
        ...core.editor.binds,
        ...qualifiedBinds(manifests, (keys) => keys.editor),
      ],
    },
    page: [...core.page, ...manifests.flatMap(qualifiedPageBinds)],
    app: [...core.app, ...qualifiedBinds(manifests, (keys) => keys.app)],
    intercept: [
      ...core.intercept,
      ...qualifiedBinds(manifests, (keys) => keys.intercept),
    ],
    global: [
      ...core.global,
      ...qualifiedBinds(manifests, (keys) => keys.global),
    ],
  };
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
