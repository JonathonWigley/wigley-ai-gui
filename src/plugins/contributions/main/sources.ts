import { type Files, isMissingFile } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import {
  AGENT_PLUGIN_NAME,
  agentPluginDir,
  APP_PLUGIN_KEY,
  CONTRIBUTIONS_FILE,
} from '../../../shared/agent-plugin';
import { errorText } from '../../../shared/error-text';
import type { HarnessPlugin } from '../../../shared/harness-folders';
import type { ContributionSource } from '../contract';

export interface SourcesDeps {
  files: Pick<Files, 'read' | 'realPath'>;
  paths: Paths;
  // `services.appDir`, the folder holding the app's own agent plugin.
  appDir: string;
  log: PluginLog;
}

// A source and its `auri.json`: the text read, or why the read failed.
export interface ScannedSource {
  source: ContributionSource;
  file: { text: string } | { error: string };
}

// A candidate before its root is resolved.
interface Candidate {
  pluginName: string;
  pluginKey: string;
  version: string | null;
  root: string;
  harnessId: string | null;
}

// The app's own plugin, then each install in the order `plugins` lists them.
function candidatesOf(
  deps: SourcesDeps,
  plugins: readonly HarnessPlugin[],
): Candidate[] {
  return [
    {
      pluginName: AGENT_PLUGIN_NAME,
      pluginKey: APP_PLUGIN_KEY,
      version: null,
      root: agentPluginDir(deps.appDir, deps.paths),
      harnessId: null,
    },
    ...plugins.map(({ harnessId, plugin }) => ({
      pluginName: plugin.key.split('@')[0],
      pluginKey: plugin.key,
      version: plugin.version,
      root: plugin.installDir,
      harnessId,
    })),
  ];
}

// The candidate as a source with its file, or null when its root is gone or
// it holds no `auri.json`.
async function scanned(
  deps: SourcesDeps,
  candidate: Candidate,
): Promise<ScannedSource | null> {
  const { files, paths } = deps;
  let root: string;
  try {
    root = await files.realPath(candidate.root);
  } catch {
    return null;
  }
  const source = { ...candidate, root };
  try {
    const text = await files.read(paths.join(root, CONTRIBUTIONS_FILE));
    return { source, file: { text } };
  } catch (error) {
    return isMissingFile(error)
      ? null
      : { source, file: { error: errorText(error) } };
  }
}

// Compares two versions by their dot-separated parts from the left: two
// numeric parts as numbers, any other pair as text, a missing part lower than
// any present one; null is lower than any version.
export function compareVersions(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    return (a === null ? 0 : 1) - (b === null ? 0 : 1);
  }
  const aParts = a.split('.');
  const bParts = b.split('.');
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index++) {
    const aPart = aParts[index];
    const bPart = bParts[index];
    if (aPart === undefined || bPart === undefined) {
      return aPart === undefined ? -1 : 1;
    }
    const isNumeric = /^\d+$/.test(aPart) && /^\d+$/.test(bPart);
    const order = isNumeric
      ? Number(aPart) - Number(bPart)
      : aPart.localeCompare(bPart);
    if (order !== 0) {
      return Math.sign(order);
    }
  }
  return 0;
}

// Whether `candidate` beats `kept`, the source of the same name held so far:
// the app's own plugin beats any install, and between installs the higher
// version wins, a tie keeping `kept`.
function beats(candidate: ScannedSource, kept: ScannedSource): boolean {
  const isAppOwn = (each: ScannedSource) =>
    each.source.pluginKey === APP_PLUGIN_KEY;
  if (isAppOwn(candidate) !== isAppOwn(kept)) {
    return isAppOwn(candidate);
  }
  return compareVersions(candidate.source.version, kept.source.version) > 0;
}

// Every candidate that holds `auri.json`: the app's own plugin first, then
// each install in `plugins`' order. A candidate whose root is gone, or whose
// `auri.json` is missing, is left out with no log; one whose read fails is a
// source carrying the error. Two candidates at one real root are one source,
// the first kept; two of one plugin name keep the app's own, else the higher
// version, else the first. Each drop logs `dropped <key> at <root>: <reason>`,
// and the kept sources stay in candidate order.
export async function scanSources(
  deps: SourcesDeps,
  plugins: readonly HarnessPlugin[],
): Promise<ScannedSource[]> {
  const { paths, log } = deps;
  const found = (
    await Promise.all(
      candidatesOf(deps, plugins).map((candidate) => scanned(deps, candidate)),
    )
  ).filter((each) => each !== null);
  const drop = (dropped: ScannedSource, reason: string) =>
    log(
      `dropped ${dropped.source.pluginKey} at ${dropped.source.root}: ${reason}`,
    );
  const byFolder: ScannedSource[] = [];
  for (const each of found) {
    const kept = byFolder.find((held) =>
      paths.samePath(held.source.root, each.source.root),
    );
    if (kept === undefined) {
      byFolder.push(each);
    } else {
      drop(each, `same folder as ${kept.source.pluginKey}`);
    }
  }
  const winners = new Map<string, ScannedSource>();
  for (const each of byFolder) {
    const kept = winners.get(each.source.pluginName);
    if (kept === undefined) {
      winners.set(each.source.pluginName, each);
    } else if (beats(each, kept)) {
      winners.set(each.source.pluginName, each);
      drop(kept, `${each.source.pluginKey} at ${each.source.root} wins`);
    } else {
      drop(each, `${kept.source.pluginKey} at ${kept.source.root} wins`);
    }
  }
  const kept = new Set(winners.values());
  return byFolder.filter((each) => kept.has(each));
}
