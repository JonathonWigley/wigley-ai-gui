import type { CommandId } from '../contracts/commands';
import type { Keymap, PageBind } from '../contracts/keymap';
import type {
  CommandDecl,
  CommandInfo,
  PluginKeys,
  PluginManifest,
} from '../contracts/plugin';

// `<pluginId>.<short>`: a plugin's command or scope under its qualified name.
export function qualify(pluginId: string, short: string): string {
  return `${pluginId}.${short}`;
}

// Every manifest's binds from `select`, each naming its qualified command.
function qualifiedBinds<Bind extends { command: string }>(
  manifests: readonly PluginManifest[],
  select: (keys: PluginKeys<string, string>) => readonly Bind[],
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
      if (id in infos) {
        throw new Error(`Command "${id}" is declared twice`);
      }
      infos[id] = { ...decl, id, plugin: manifest.id };
    }
  }
  return infos;
}

// Each plugin's settings, by plugin id.
export function pluginSettings(
  manifests: readonly PluginManifest[],
): Record<string, object> {
  return Object.fromEntries(
    manifests.map((manifest) => [manifest.id, manifest.settings]),
  );
}
