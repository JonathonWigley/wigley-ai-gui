import {
  FEATURE_KEYS,
  type FeatureKey,
  type JsonValue,
} from '../../../contracts/contributions';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { ConfigProblem } from '../../../contracts/settings';
import type { KeyedSlotWriter } from '../../../contracts/state';
import {
  CONTRIBUTIONS_FILE,
  CONTRIBUTIONS_VERSION,
} from '../../../shared/agent-plugin';
import { errorText } from '../../../shared/error-text';
import { isJsonObject, type JsonObject } from '../../../shared/json';
import type {
  ContributionSource,
  FeatureReader,
  FeatureStrategies,
  Strategy,
} from '../contract';
import type { ScannedSource } from './sources';

export interface RegistryDeps {
  slot: Pick<KeyedSlotWriter<FeatureStrategies>, 'set' | 'delete'>;
  paths: Paths;
  log: PluginLog;
  // Replaces every problem the registry serves.
  setProblems(problems: readonly ConfigProblem[]): void;
}

// The registry over the last scan. `scanned` parses each source's file and
// runs every reader again; `register` runs its reader at once over the last
// scan, with no new read. Each publishes the problems after it.
export interface Registry {
  scanned(sources: readonly ScannedSource[]): void;
  register(key: FeatureKey, reader: FeatureReader<unknown>): Disposable;
  strategies(key: FeatureKey): readonly Strategy<unknown>[];
  onChanged(
    key: FeatureKey,
    listener: (strategies: readonly Strategy<unknown>[]) => void,
  ): Disposable;
}

// One scanned source: its file's full path, and its top-level object, or the
// file problem that loads no section.
interface ParsedSource {
  source: ContributionSource;
  file: string;
  parsed: { sections: JsonObject } | { problem: string };
}

// A registered feature: its reader, its strategies and their JSON as last
// served, and its section problems by source index.
interface Feature {
  reader: FeatureReader<unknown>;
  strategies: Strategy<unknown>[];
  json: string;
  problems: Map<number, ConfigProblem>;
}

const OWN_KEYS = ['version', '$schema'];

// The section problem text: one line per reason, a reason starting with `[` or
// `.` following the key directly, any other one following `: `.
function sectionMessage(
  pluginName: string,
  key: FeatureKey,
  reasons: readonly string[],
): string {
  return reasons
    .map((reason) => {
      const joiner =
        reason.startsWith('[') || reason.startsWith('.') ? '' : ': ';
      return `${pluginName}: ${key}${joiner}${reason}`;
    })
    .join('\n');
}

// The file's top-level object, or the problem that keeps every section out.
function parseFile(
  name: string,
  file: ScannedSource['file'],
): ParsedSource['parsed'] {
  if ('error' in file) {
    return { problem: `${name}: auri.json not read: ${file.error}` };
  }
  let value: unknown;
  try {
    value = JSON.parse(file.text);
  } catch (error) {
    return { problem: `${name}: auri.json is not JSON: ${errorText(error)}` };
  }
  if (!isJsonObject(value)) {
    return { problem: `${name}: auri.json is not an object` };
  }
  if (value.version !== CONTRIBUTIONS_VERSION) {
    const version = JSON.stringify(value.version) ?? 'missing';
    return {
      problem: `${name}: auri.json version is ${version}, not ${String(CONTRIBUTIONS_VERSION)}`,
    };
  }
  return { sections: value };
}

// The section's non-empty string `label`, else the plugin name.
function strategyLabel(section: unknown, pluginName: string): string {
  const label = isJsonObject(section) ? section.label : undefined;
  return typeof label === 'string' && label !== '' ? label : pluginName;
}

export function createRegistry(deps: RegistryDeps): Registry {
  const { slot, paths, log, setProblems } = deps;
  let sources: ParsedSource[] = [];
  const features = new Map<FeatureKey, Feature>();
  const listeners = new Map<
    FeatureKey,
    Set<(strategies: readonly Strategy<unknown>[]) => void>
  >();

  const publishProblems = () => {
    const fileProblems = sources.flatMap(({ file, parsed }) =>
      'problem' in parsed ? [{ file, message: parsed.problem }] : [],
    );
    const sectionProblems = sources.flatMap((_source, index) =>
      FEATURE_KEYS.flatMap((key) => {
        const problem = features.get(key)?.problems.get(index);
        return problem === undefined ? [] : [problem];
      }),
    );
    setProblems([...fileProblems, ...sectionProblems]);
  };

  const tell = (key: FeatureKey, strategies: readonly Strategy<unknown>[]) => {
    for (const listener of listeners.get(key) ?? []) {
      try {
        listener(strategies);
      } catch (error) {
        log(`${key} change listener failed: ${errorText(error)}`);
      }
    }
  };

  // Runs `key`'s reader over every source holding its section, and serves
  // the strategies when their JSON changed or `isNew`.
  const evaluate = (key: FeatureKey, feature: Feature, isNew: boolean) => {
    const strategies: Strategy<unknown>[] = [];
    feature.problems = new Map();
    sources.forEach(({ source, file, parsed }, index) => {
      if (!('sections' in parsed) || !Object.hasOwn(parsed.sections, key)) {
        return;
      }
      const section = parsed.sections[key];
      let reasons: readonly string[];
      try {
        const result = feature.reader.read(section, source);
        if (result.ok) {
          strategies.push({
            id: source.pluginName,
            label: strategyLabel(section, source.pluginName),
            source,
            value: result.value,
          });
          return;
        }
        reasons = result.reasons.length === 0 ? ['refused'] : result.reasons;
      } catch (error) {
        reasons = [`reader failed: ${errorText(error)}`];
      }
      feature.problems.set(index, {
        file,
        message: sectionMessage(source.pluginName, key, reasons),
      });
    });
    const json = JSON.stringify(strategies);
    if (!isNew && json === feature.json) {
      return;
    }
    feature.strategies = strategies;
    feature.json = json;
    slot.set(key, {
      key,
      label: feature.reader.label,
      strategies: strategies as Strategy<JsonValue>[],
    });
    tell(key, strategies);
  };

  return {
    scanned(scannedSources) {
      sources = scannedSources.map(({ source, file }) => ({
        source,
        file: paths.join(source.root, CONTRIBUTIONS_FILE),
        parsed: parseFile(source.pluginName, file),
      }));
      for (const { source, parsed } of sources) {
        if (!('sections' in parsed)) {
          continue;
        }
        for (const key of Object.keys(parsed.sections)) {
          const isRead =
            OWN_KEYS.includes(key) || features.has(key as FeatureKey);
          if (!isRead) {
            log(
              `${source.pluginName}: auri.json key ${key} is read by no feature; ignored`,
            );
          }
        }
      }
      for (const [key, feature] of features) {
        evaluate(key, feature, false);
      }
      publishProblems();
    },
    register(key, reader) {
      if (features.has(key)) {
        throw new Error(`feature ${key} is already registered`);
      }
      const feature: Feature = {
        reader,
        strategies: [],
        json: '',
        problems: new Map(),
      };
      features.set(key, feature);
      evaluate(key, feature, true);
      publishProblems();
      return {
        dispose() {
          if (features.get(key) !== feature) {
            return;
          }
          features.delete(key);
          slot.delete(key);
          publishProblems();
        },
      };
    },
    strategies: (key) => features.get(key)?.strategies ?? [],
    onChanged(key, listener) {
      const held = listeners.get(key) ?? new Set();
      listeners.set(key, held);
      held.add(listener);
      return {
        dispose() {
          held.delete(listener);
        },
      };
    },
  };
}
