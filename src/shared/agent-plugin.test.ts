import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_PLUGIN_FOLDER,
  AGENT_PLUGIN_NAME,
  AGENT_SERVER_NAME,
  agentPluginDir,
  claudePluginToolName,
} from './agent-plugin';
import { posixPaths } from './paths/posix-paths';
import { windowsPaths } from './paths/windows-paths';

interface McpServerEntry {
  args: string[];
  cwd?: string;
  tool_timeout_sec?: number;
}

interface PluginManifest {
  name: string;
  skills?: string;
  mcpServers: Record<string, McpServerEntry>;
}

interface HookEntry {
  matcher: string;
  hooks: { type: string; command: string; timeout: number }[];
}

interface HooksFile {
  hooks: Record<string, HookEntry[]>;
}

// Read from the repo folder the suite runs in.
function readJson<T>(file: string): T {
  return JSON.parse(
    readFileSync(path.join(AGENT_PLUGIN_FOLDER, file), 'utf8'),
  ) as T;
}

describe('claudePluginToolName', () => {
  it.each([
    {
      plugin: 'auri',
      server: 'auri',
      tool: 'permission_prompt',
      expected: 'mcp__plugin_auri_auri__permission_prompt',
    },
    {
      plugin: 'wigley',
      server: 'wigley-forms',
      tool: 'ask_round',
      expected: 'mcp__plugin_wigley_wigley-forms__ask_round',
    },
  ])(
    'claudePluginToolName_JoinsPluginServerAndTool: $expected',
    ({ plugin, server, tool, expected }) => {
      expect(claudePluginToolName(plugin, server, tool)).toBe(expected);
    },
  );
});

describe('agentPluginDir', () => {
  it.each([
    { paths: posixPaths, appDir: '/app', expected: '/app/agent-plugin' },
    {
      paths: windowsPaths,
      appDir: 'C:\\Program Files\\Auri\\resources',
      expected: 'C:\\Program Files\\Auri\\resources\\agent-plugin',
    },
  ])(
    'agentPluginDir_JoinsTheFolderName: $expected',
    ({ paths, appDir, expected }) => {
      expect(agentPluginDir(appDir, paths)).toBe(expected);
    },
  );
});

describe('the agent plugin folder', () => {
  it('agentPluginManifests_NameTheConstants', () => {
    const claude = readJson<PluginManifest>('.claude-plugin/plugin.json');
    const codex = readJson<PluginManifest>('.codex-plugin/plugin.json');

    for (const manifest of [claude, codex]) {
      expect(manifest.name).toBe(AGENT_PLUGIN_NAME);
      expect(Object.keys(manifest.mcpServers)).toEqual([AGENT_SERVER_NAME]);
    }
    expect(claude.mcpServers[AGENT_SERVER_NAME].args).toEqual([
      '${CLAUDE_PLUGIN_ROOT}/scripts/relay/relay.py',
    ]);
    const codexServer = codex.mcpServers[AGENT_SERVER_NAME];
    expect(codex.skills).toBe('./skills/');
    expect(codexServer.cwd).toBe('.');
    expect(codexServer.tool_timeout_sec).toBe(330);
    expect(codexServer.args).toEqual(['./scripts/relay/relay.py']);
    expect(
      existsSync(path.join(AGENT_PLUGIN_FOLDER, 'scripts/relay/relay.py')),
    ).toBe(true);
  });

  // Each hook the plugin ships; `mode` is the script's one argument, '' for none.
  const HOOK_ROWS = [
    {
      event: 'PreToolUse',
      matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
      script: 'scripts/chatroom/hook.py',
      mode: 'pre',
      timeout: 5,
    },
    {
      event: 'PostToolUse',
      matcher: 'Edit|Write|MultiEdit|NotebookEdit',
      script: 'scripts/chatroom/hook.py',
      mode: 'post',
      timeout: 5,
    },
  ];

  it('agentPluginHooks_CommandsNameExistingScripts', () => {
    const file = readJson<HooksFile>('hooks/hooks.json');
    const shipped = Object.entries(file.hooks).flatMap(([event, entries]) =>
      entries.flatMap((entry) =>
        entry.hooks.map((hook) => ({
          event,
          matcher: entry.matcher,
          command: hook.command,
          timeout: hook.timeout,
        })),
      ),
    );
    const expected = HOOK_ROWS.map((row) => ({
      event: row.event,
      matcher: row.matcher,
      command: `python3 "\${CLAUDE_PLUGIN_ROOT}/${row.script}"${row.mode ? ` ${row.mode}` : ''}`,
      timeout: row.timeout,
    }));

    expect(shipped).toEqual(expect.arrayContaining(expected));
    expect(shipped).toHaveLength(expected.length);
    for (const row of HOOK_ROWS) {
      expect(
        existsSync(path.join(AGENT_PLUGIN_FOLDER, row.script)),
        row.script,
      ).toBe(true);
    }
  });
});
