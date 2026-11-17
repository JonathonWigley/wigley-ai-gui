import type { Files } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import {
  type PluginInstallRecord,
  readInstalledPlugins,
} from './installed-plugins';

// What an agent definition file sets for the agents of its type; each null when the file sets none.
export interface AgentDefinition {
  model: string | null;
  effort: string | null;
}

// Agent definitions by the agent type an Agent call names.
export type AgentDefinitions = ReadonlyMap<string, AgentDefinition>;

interface DefinitionDeps {
  files: Files;
  paths: Paths;
  log: Log;
}

const FENCE = '---';
const FRONTMATTER_KEY = /^(name|model|effort):(.*)$/;
// The model a definition gives to run on its caller's model.
const INHERIT_MODEL = 'inherit';
const DEFINITION_EXTENSION = '.md';

function frontmatterValue(text: string): string | null {
  const trimmed = text.trim();
  const isQuoted =
    trimmed.length >= 2 &&
    (trimmed.startsWith('"') || trimmed.startsWith("'")) &&
    trimmed.endsWith(trimmed[0]);
  const value = isQuoted ? trimmed.slice(1, -1) : trimmed;
  return value === '' ? null : value;
}

// The `name`, `model` and `effort` of an agent definition's frontmatter: the `key: value` lines, key at column 0,
// between a first line of `---` and the next `---` line. Each null when unset, empty, or with no closed block.
export function agentFrontmatter(text: string): {
  name: string | null;
  model: string | null;
  effort: string | null;
} {
  const fields = {
    name: null as string | null,
    model: null as string | null,
    effort: null as string | null,
  };
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf(FENCE, 1);
  if (lines[0] !== FENCE || end === -1) {
    return fields;
  }
  for (const line of lines.slice(1, end)) {
    const match = FRONTMATTER_KEY.exec(line);
    if (match !== null) {
      fields[match[1] as keyof typeof fields] = frontmatterValue(match[2]);
    }
  }
  return fields;
}

// Adds each `.md` file under `folder`, every level, keyed `<prefix><type>`: the type is the frontmatter `name`, else
// the file's name without `.md`. A type already in `definitions` keeps its entry.
async function addFolder(
  deps: DefinitionDeps,
  folder: string,
  prefix: string,
  definitions: Map<string, AgentDefinition>,
) {
  let entries;
  try {
    entries = await deps.files.list(folder, { recursive: true });
  } catch (error) {
    deps.log('claude', `agent definitions not listed: ${errorText(error)}`);
    return;
  }
  for (const entry of entries) {
    const isDefinition =
      entry.kind === 'file' && entry.path.endsWith(DEFINITION_EXTENSION);
    if (!isDefinition) {
      continue;
    }
    const path = deps.paths.join(folder, entry.path);
    let text: string;
    try {
      text = await deps.files.read(path);
    } catch (error) {
      deps.log('claude', `agent definition not read: ${errorText(error)}`);
      continue;
    }
    const frontmatter = agentFrontmatter(text);
    const fileType = deps.paths
      .base(path)
      .slice(0, -DEFINITION_EXTENSION.length);
    const type = `${prefix}${frontmatter.name ?? fileType}`;
    if (!definitions.has(type)) {
      definitions.set(type, {
        model: frontmatter.model === INHERIT_MODEL ? null : frontmatter.model,
        effort: frontmatter.effort,
      });
    }
  }
}

// The folder of the install a session in `projectDir` loads: this folder's project install, else the user install;
// null when neither is listed.
function installPathOf(
  installs: readonly PluginInstallRecord[],
  projectDir: string,
  paths: Paths,
): string | null {
  const projectInstall = installs.find(
    (install) =>
      install.scope !== 'user' &&
      install.projectPath !== null &&
      paths.samePath(install.projectPath, projectDir),
  );
  const install =
    projectInstall ?? installs.find((candidate) => candidate.scope === 'user');
  return install?.installDir ?? null;
}

// Each installed plugin's name (its `installed_plugins.json` key up to `@`) and the folder of the install a session
// in `projectDir` loads, in file order; [] when the file is missing or unreadable.
async function pluginInstalls(
  deps: DefinitionDeps,
  projectDir: string,
  configFolder: string,
): Promise<{ plugin: string; installPath: string }[]> {
  const installsByKey = new Map<string, PluginInstallRecord[]>();
  for (const record of await readInstalledPlugins(deps, configFolder)) {
    const installs = installsByKey.get(record.key) ?? [];
    installs.push(record);
    installsByKey.set(record.key, installs);
  }
  const chosen: { plugin: string; installPath: string }[] = [];
  for (const [key, installs] of installsByKey) {
    const installPath = installPathOf(installs, projectDir, deps.paths);
    if (installPath !== null) {
      chosen.push({ plugin: key.split('@')[0], installPath });
    }
  }
  return chosen;
}

// The agent definitions a Claude session in `projectDir` with config folder `configFolder` loads: the project's
// `.claude/agents/`, then the profile's `agents/` (a project type wins), then each installed plugin's `agents/` as
// `<plugin>:<type>`. A file that fails to read is logged and skipped; the load never rejects.
export async function loadAgentDefinitions(
  deps: DefinitionDeps,
  projectDir: string,
  configFolder: string,
): Promise<AgentDefinitions> {
  const definitions = new Map<string, AgentDefinition>();
  await addFolder(
    deps,
    deps.paths.join(projectDir, '.claude', 'agents'),
    '',
    definitions,
  );
  await addFolder(
    deps,
    deps.paths.join(configFolder, 'agents'),
    '',
    definitions,
  );
  for (const { plugin, installPath } of await pluginInstalls(
    deps,
    projectDir,
    configFolder,
  )) {
    await addFolder(
      deps,
      deps.paths.join(installPath, 'agents'),
      `${plugin}:`,
      definitions,
    );
  }
  return definitions;
}
