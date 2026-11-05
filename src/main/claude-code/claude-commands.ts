import type { AgentCommand } from '../../contracts/agent';
import {
  asArray,
  asJson,
  asString,
  type Json,
  stringItems,
} from './json-fields';

export function withoutSlash(name: string): string {
  return name.replace(/^\//, '');
}

const ENTITY_TEXTS: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
};

// The CLI's answer spells `<` and `>` in a plugin skill's description as entities.
function withEntitiesDecoded(text: string): string {
  return text.replace(/&(?:lt|gt|amp);/g, (entity) => ENTITY_TEXTS[entity]);
}

function commandRecord(value: unknown): AgentCommand {
  const command = asJson(value);
  return {
    name: withoutSlash(asString(command.name)),
    description: withEntitiesDecoded(asString(command.description)),
    argumentHint: asString(command.argumentHint),
    aliases: stringItems(command.aliases).map(withoutSlash),
  };
}

// The `commands` of an `initialize` answer's data; an item with no name is left
// out, and [] when the field is no list.
export function commandRecordsOf(initializeReply: Json): AgentCommand[] {
  return asArray(initializeReply.commands)
    .map(commandRecord)
    .filter((command) => command.name !== '');
}

// The list an `init` gives: one record per name in `names`, in that order. Each
// name takes the record it names exactly; a name with none then takes the first
// record left that holds it as an alias, or else a new record with empty text. A
// record no name took drops.
export function mergeInitNames(
  records: readonly AgentCommand[],
  names: readonly string[],
): AgentCommand[] {
  const taken = new Set<AgentCommand>();
  const exactRecords = new Map<string, AgentCommand>();
  for (const name of names) {
    const exact = records.find(
      (candidate) => !taken.has(candidate) && candidate.name === name,
    );
    if (exact !== undefined) {
      taken.add(exact);
      exactRecords.set(name, exact);
    }
  }
  return names.map((name) => {
    const exact = exactRecords.get(name);
    if (exact !== undefined) {
      return exact;
    }
    const aliased = records.find(
      (candidate) => !taken.has(candidate) && candidate.aliases.includes(name),
    );
    if (aliased === undefined) {
      return { name, description: '', argumentHint: '', aliases: [] };
    }
    taken.add(aliased);
    return aliased;
  });
}

// `records` as a session offers them: each named `plugin:name` also answers to
// the name after its first `:`, which the CLI's aliases do not always hold.
export function withNameAfterPlugin(
  records: readonly AgentCommand[],
): AgentCommand[] {
  return records.map((record) => {
    const colon = record.name.indexOf(':');
    if (colon === -1) {
      return record;
    }
    const nameAfterPlugin = record.name.slice(colon + 1);
    return {
      ...record,
      aliases: [...new Set([...record.aliases, nameAfterPlugin])],
    };
  });
}
