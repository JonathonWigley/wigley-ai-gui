// The environment the app's agent sessions spawn with
// (`services.agentEnvironment`): `env` with its undefined values dropped, so
// none reaches a spawned process, and `WIGLEY_AI_GUI_ENDPOINT_DIR` set to
// `endpointDir`, so the relays of the agent sessions this app starts send their
// rounds to this app.
export function agentEnvironmentOf(
  env: Readonly<Record<string, string | undefined>>,
  endpointDir: string,
): Readonly<Record<string, string>> {
  const definedEnv = Object.fromEntries(
    Object.entries(env).filter(
      (pair): pair is [string, string] => pair[1] !== undefined,
    ),
  );
  return { ...definedEnv, WIGLEY_AI_GUI_ENDPOINT_DIR: endpointDir };
}
