// `hostEnv`'s defined values less `ELECTRON_RUN_AS_NODE`, the name the host runs as Node through, which an Electron
// binary the host starts would read too.
export function inheritedEnvOf(
  hostEnv: NodeJS.ProcessEnv,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value !== undefined) {
      env[name] = value;
    }
  }
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
