import type { CommandDecl, PluginKeys } from '../contracts/plugin';

// Returns `manifest` unchanged, keeping its literal command ids, scopes and
// settings in its type: a key naming an undeclared command or scope fails to
// compile, and so does a start function missing a declared command's handler.
export function definePlugin<
  const Cmds extends Record<string, CommandDecl>,
  const S extends string,
  const T extends object,
>(manifest: {
  id: string;
  dependsOn: readonly string[];
  commands: Cmds;
  scopes: readonly S[];
  keys: PluginKeys<NoInfer<Extract<keyof Cmds, string>>, NoInfer<S>>;
  settings: T;
}): typeof manifest {
  return manifest;
}
