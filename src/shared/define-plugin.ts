import type {
  CommandDecl,
  CommandsDeclaredIn,
  PluginKeys,
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

// Returns `manifest` unchanged, keeping its literal command ids and scopes in
// its type and its settings as plain types: a key naming an undeclared command
// or scope, or a command running in the other process, fails to compile, and
// so does a start function missing a declared command's handler, and a
// top-level setting defaulting to null whose kind `optionalSettings` leaves
// out. Throws when the id holds anything but lowercase letters, digits and `-`.
export function definePlugin<
  const Cmds extends Record<string, CommandDecl>,
  const S extends string,
  T extends object,
>(
  manifest: {
    id: string;
    dependsOn: readonly string[];
    commands: Cmds;
    scopes: Readonly<Record<S, string>>;
    keys: PluginKeys<
      NoInfer<CommandsDeclaredIn<Cmds, 'page'>>,
      NoInfer<CommandsDeclaredIn<Cmds, 'main'>>,
      NoInfer<S>
    >;
    settings: T;
    optionalSettings?: Readonly<Record<string, SettingKind>>;
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
