import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { agentFrontmatter, loadAgentDefinitions } from './agent-definitions';

const PROJECT = '/work/app';
const CONFIG = '/home/u/.claude';
const INSTALLED = `${CONFIG}/plugins/installed_plugins.json`;

const definition = (fields: string) => `---\n${fields}\n---\nbody\n`;

const installedPlugins = (plugins: Record<string, unknown[]>) =>
  JSON.stringify({ version: 2, plugins });

describe('agent definitions', () => {
  it.each([
    {
      name: 'QuotedValues',
      text: definition(`name: "mapper"\nmodel: 'sonnet'\neffort: high`),
      expected: { name: 'mapper', model: 'sonnet', effort: 'high' },
    },
    {
      name: 'NoClosingFence',
      text: '---\nname: mapper\nmodel: sonnet\n',
      expected: { name: null, model: null, effort: null },
    },
    {
      name: 'EmptyValue',
      text: definition('name: mapper\nmodel:\neffort: ""'),
      expected: { name: 'mapper', model: null, effort: null },
    },
    {
      name: 'KeyNotAtColumnZero',
      text: definition('name: mapper\n  model: opus\nmeta:\n  effort: max'),
      expected: { name: 'mapper', model: null, effort: null },
    },
  ])('agentFrontmatter_$name', ({ text, expected }) => {
    expect(agentFrontmatter(text)).toEqual(expected);
  });

  it.each<{
    name: string;
    files: Record<string, string>;
    expected: Record<string, { model: string | null; effort: string | null }>;
    logs?: boolean;
  }>([
    {
      name: 'ProjectAgent',
      files: {
        [`${PROJECT}/.claude/agents/mapper.md`]: definition(
          'name: mapper\nmodel: sonnet\neffort: high',
        ),
        [`${PROJECT}/.claude/agents/notes.txt`]: definition('name: notes'),
      },
      expected: { mapper: { model: 'sonnet', effort: 'high' } },
    },
    {
      name: 'ProfileAgent',
      files: {
        [`${CONFIG}/agents/nested/reviewer.md`]: definition(
          'name: reviewer\nmodel: opus',
        ),
      },
      expected: { reviewer: { model: 'opus', effort: null } },
    },
    {
      name: 'ProjectOverProfile',
      files: {
        [`${PROJECT}/.claude/agents/mapper.md`]: definition(
          'name: mapper\nmodel: sonnet\neffort: high',
        ),
        [`${CONFIG}/agents/mapper.md`]: definition(
          'name: mapper\nmodel: haiku\neffort: low',
        ),
      },
      expected: { mapper: { model: 'sonnet', effort: 'high' } },
    },
    {
      name: 'NoNameUsesFileName',
      files: {
        [`${CONFIG}/agents/scout.md`]: 'You scout.\n',
      },
      expected: { scout: { model: null, effort: null } },
    },
    {
      name: 'InheritIsNull',
      files: {
        [`${CONFIG}/agents/scout.md`]: definition(
          'name: scout\nmodel: inherit\neffort: medium',
        ),
      },
      expected: { scout: { model: null, effort: 'medium' } },
    },
    {
      name: 'PluginUserScope',
      files: {
        [INSTALLED]: installedPlugins({
          'wigley@wigley-ai-marketplace': [
            { scope: 'user', installPath: '/other/.claude/cache/wigley/1.0' },
          ],
        }),
        '/other/.claude/cache/wigley/1.0/agents/haiku.md': definition(
          'name: haiku\nmodel: haiku\neffort: low',
        ),
      },
      expected: { 'wigley:haiku': { model: 'haiku', effort: 'low' } },
    },
    {
      name: 'PluginProjectScopeOfThisFolderWins',
      files: {
        [INSTALLED]: installedPlugins({
          'wigley@wigley-ai-marketplace': [
            { scope: 'user', installPath: '/cache/wigley/1.0' },
            {
              scope: 'project',
              projectPath: `${PROJECT}/`,
              installPath: '/cache/wigley/2.0',
            },
          ],
        }),
        '/cache/wigley/1.0/agents/haiku.md': definition('model: haiku'),
        '/cache/wigley/2.0/agents/haiku.md': definition('model: sonnet'),
      },
      expected: { 'wigley:haiku': { model: 'sonnet', effort: null } },
    },
    {
      name: 'PluginProjectScopeOfAnotherFolderIgnored',
      files: {
        [INSTALLED]: installedPlugins({
          'wigley@wigley-ai-marketplace': [
            {
              scope: 'project',
              projectPath: '/work/other',
              installPath: '/cache/wigley/2.0',
            },
            { scope: 'user', installPath: '/cache/wigley/1.0' },
          ],
          'tools@market': [
            {
              scope: 'local',
              projectPath: '/work/other',
              installPath: '/cache/tools/1.0',
            },
          ],
        }),
        '/cache/wigley/1.0/agents/haiku.md': definition('model: haiku'),
        '/cache/wigley/2.0/agents/haiku.md': definition('model: sonnet'),
        '/cache/tools/1.0/agents/fixer.md': definition('model: opus'),
      },
      expected: { 'wigley:haiku': { model: 'haiku', effort: null } },
    },
    // An install with no `installPath` is never listed, so this folder's
    // broken project install falls through to the user install.
    {
      name: 'PluginProjectScopeWithNoInstallPath_UserInstallLoads',
      files: {
        [INSTALLED]: installedPlugins({
          'wigley@wigley-ai-marketplace': [
            { scope: 'user', installPath: '/cache/wigley/1.0' },
            { scope: 'project', projectPath: PROJECT },
          ],
        }),
        '/cache/wigley/1.0/agents/haiku.md': definition('model: haiku'),
      },
      expected: { 'wigley:haiku': { model: 'haiku', effort: null } },
    },
    {
      name: 'NoInstalledFile',
      files: {
        [`${CONFIG}/agents/scout.md`]: definition('model: opus'),
      },
      expected: { scout: { model: 'opus', effort: null } },
    },
    {
      name: 'InstalledFileNotJson',
      files: {
        [INSTALLED]: '{ not json',
        [`${CONFIG}/agents/scout.md`]: definition('model: opus'),
      },
      expected: { scout: { model: 'opus', effort: null } },
      logs: true,
    },
  ])('loadAgentDefinitions_$name', async ({ files, expected, logs }) => {
    const memory = createMemoryFiles();
    for (const [path, text] of Object.entries(files)) {
      await memory.write(path, text);
    }
    const logged: string[] = [];
    const definitions = await loadAgentDefinitions(
      {
        files: memory,
        paths: posixPaths,
        log: (_source, message) => logged.push(message),
      },
      PROJECT,
      CONFIG,
    );
    expect(Object.fromEntries(definitions)).toEqual(expected);
    if (logs === true) {
      expect(logged).toEqual([expect.stringContaining(INSTALLED)]);
    } else {
      expect(logged).toEqual([]);
    }
  });
});
