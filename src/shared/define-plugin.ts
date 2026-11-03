import type {
  CommandDecl,
  CommandsDeclaredIn,
  PluginKeys,
  SettingInfos,
  SettingKind,
} from '../contracts/plugin';
import type { TokenDecl } from '../contracts/theme';

const PLUGIN_ID = /^[a-z0-9-]+$/;

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
// so does a start function missing a declared command's handler, a top-level
// setting defaulting to null whose kind `optionalSettings` leaves out, and a
// `settingInfo` missing a leaf setting's path or naming a path that is no
// leaf; a dependency key for a plugin missing from that process's list fails to
// compile. Throws when the id holds anything but lowercase letters, digits and `-`.
export function definePlugin<
  const Id extends string,
  const Cmds extends Record<string, CommandDecl>,
  const S extends string,
  T extends object,
  const DM extends string = never,
  const DP extends string = never,
>(
  manifest: {
    id: Id;
    dependsOn: { main: readonly DM[]; page: readonly DP[] };
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
  } & NullKindsDeclared<NoInfer<T>>,
): typeof manifest {
  if (!PLUGIN_ID.test(manifest.id)) {
    throw new Error(
      `Plugin id "${manifest.id}" must be lowercase letters, digits and -`,
    );
  }
  return manifest;
}
