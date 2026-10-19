import type {
  CommandDecl,
  CommandsDeclaredIn,
  PluginKeys,
} from '../contracts/plugin';

// Returns `manifest` unchanged, keeping its literal command ids and scopes in
// its type and its settings as plain types: a key naming an undeclared command
// or scope, or a command running in the other process, fails to compile, and
// so does a start function missing a declared command's handler.
export function definePlugin<
  const Cmds extends Record<string, CommandDecl>,
  const S extends string,
  T extends object,
>(manifest: {
  id: string;
  dependsOn: readonly string[];
  commands: Cmds;
  scopes: readonly S[];
  keys: PluginKeys<
    NoInfer<CommandsDeclaredIn<Cmds, 'page'>>,
    NoInfer<CommandsDeclaredIn<Cmds, 'main'>>,
    NoInfer<S>
  >;
  settings: T;
}): typeof manifest {
  return manifest;
}
