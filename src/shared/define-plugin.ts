import type {
  CommandDecl,
  CommandsDeclaredIn,
  PluginKeys,
  SettingInfos,
  SettingKind,
} from '../contracts/plugin';
import type { TokenDecl } from '../contracts/theme';

// A plugin id: lowercase letters, digits and `-`.
export const PLUGIN_ID_PATTERN = '^[a-z0-9-]+$';
const PLUGIN_ID = new RegExp(PLUGIN_ID_PATTERN);

// Why `id` cannot be a plugin's id, or null when it can: it holds anything but
// lowercase letters, digits and `-`, or it is `core`, whose slots and events
// are the core's.
export function pluginIdProblem(id: string): string | null {
  if (!PLUGIN_ID.test(id)) {
    return `Plugin id "${id}" must be lowercase letters, digits and -`;
  }
  if (id === 'core') {
    return 'Plugin id "core" is reserved for the core';
  }
  return null;
}

// The names of `T`'s settings whose default may be null.
type NullDefaultSettings<T> = {
  [K in keyof T]: null extends T[K] ? K : never;
}[keyof T] &
  string;

// Requires `optionalSettings` to name the kind of each of `T`'s null-default
// settings, which a `settings.json` value is checked against.
type NullKindsDeclared<T> = [NullDefaultSettings<T>] extends [never]
  ? unknown
  : {
      optionalSettings: Readonly<Record<NullDefaultSettings<T>, SettingKind>>;
    };

// Returns `manifest` unchanged, keeping its literal id, command ids and scopes
// in its type and its settings as plain types: a key naming an undeclared command
// or scope, or a command running in the other process, fails to compile, and
// so does a start function missing a declared command's handler, a handler reading
// its `context.arg` as anything but what its command's `arg` declares, a top-level
// setting defaulting to null whose kind `optionalSettings` leaves out, and a
// `settingInfo` missing a leaf setting's path or naming a path that is no
// leaf; a dependency key for a plugin missing from that process's list fails to
// compile, and so does a slot key read from a plugin in neither its `dependsOn`
// nor its `reads` there. Throws on an id `pluginIdProblem` refuses.
// `label` and `description` name the plugin in Settings' Plugins section.
export function definePlugin<
  const Id extends string,
  const Cmds extends Record<string, CommandDecl>,
  const S extends string,
  T extends object,
  const DM extends string = never,
  const DP extends string = never,
  const RM extends string = never,
  const RP extends string = never,
>(
  manifest: {
    id: Id;
    label: string;
    description: string;
    dependsOn: { main: readonly DM[]; page: readonly DP[] };
    reads: { main: readonly RM[]; page: readonly RP[] };
    commands: Cmds;
    scopes: Readonly<Record<S, string>>;
    keys?: PluginKeys<
      NoInfer<CommandsDeclaredIn<Cmds, 'page'>>,
      NoInfer<CommandsDeclaredIn<Cmds, 'main'>>,
      NoInfer<S>
    >;
    settings: T;
    optionalSettings?: Readonly<Record<string, SettingKind>>;
    settingInfo: SettingInfos<NoInfer<T>>;
    themeTokens: Readonly<Record<string, TokenDecl>>;
    readsEverySlot?: true;
  } & NullKindsDeclared<NoInfer<T>>,
): typeof manifest {
  const idProblem = pluginIdProblem(manifest.id);
  if (idProblem !== null) {
    throw new Error(idProblem);
  }
  return manifest;
}
