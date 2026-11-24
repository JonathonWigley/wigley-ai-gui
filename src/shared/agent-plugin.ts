import type { Paths } from '../contracts/paths';

// The app's own agent plugin, `auri`: its manifest name, the MCP server key
// in both its manifests, and its folder beside the app's files.
export const AGENT_PLUGIN_NAME = 'auri';
export const AGENT_SERVER_NAME = 'auri';
export const AGENT_PLUGIN_FOLDER = 'agent-plugin';
// The app's own plugin's key as a contribution source, beside installed
// plugins' `<name>@<marketplace>` keys.
export const APP_PLUGIN_KEY = 'auri@app';
// The file an agent plugin carries at its root to contribute to app features.
export const CONTRIBUTIONS_FILE = 'auri.json';
export const CONTRIBUTIONS_VERSION = 1;

// The name Claude Code gives a plugin's MCP tool, built from the manifest name
// and the server key as they are.
export function claudePluginToolName(
  plugin: string,
  server: string,
  tool: string,
): string {
  return `mcp__plugin_${plugin}_${server}__${tool}`;
}

// The `auri` plugin's folder under the app's files (`MainServices.appDir`).
export function agentPluginDir(appDir: string, paths: Paths): string {
  return paths.join(appDir, AGENT_PLUGIN_FOLDER);
}
