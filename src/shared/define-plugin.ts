import type {
  CommandDecl,
  CommandsDeclaredIn,
  PluginKeys,
} from '../contracts/plugin';
import type { TokenDecl } from '../contracts/theme';

const PLUGIN_ID = /^[a-z0-9-]+$/;

// Returns `manifest` unchanged, keeping its literal command ids and scopes in
// its type and its settings as plain types: a key naming an undeclared command
// or scope, or a command running in the other process, fails to compile, and
// so does a start function missing a declared command's handler. Throws when
// the id holds anything but lowercase letters, digits and `-`.
export function definePlugin<
  const Cmds extends Record<string, CommandDecl>,
  const S extends string,
  T extends object,
>(manifest: {
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
  themeTokens: Readonly<Record<string, TokenDecl>>;
}): typeof manifest {
  if (!PLUGIN_ID.test(manifest.id)) {
    throw new Error(
      `Plugin id "${manifest.id}" must be lowercase letters, digits and -`,
    );
  }
  return manifest;
}
