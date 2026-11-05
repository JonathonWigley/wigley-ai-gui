import type { AgentCommand } from '../../contracts/agent';
import {
  asArray,
  asJson,
  asString,
  type Json,
  stringItems,
} from './json-fields';

function withoutSlash(name: string): string {
  return name.replace(/^\//, '');
}

function commandRecord(value: unknown): AgentCommand {
  const command = asJson(value);
  return {
    name: withoutSlash(asString(command.name)),
    description: asString(command.description),
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

function answersTo(command: AgentCommand, name: string): boolean {
  return command.name === name || command.aliases.includes(name);
}

// The list an `init` gives: one record per name in `names`, in that order. Each
// name takes the first record it matches by name or alias that no earlier name
// took, or else a new record with empty text; a record no name took drops.
export function mergeInitNames(
  records: readonly AgentCommand[],
  names: readonly string[],
): AgentCommand[] {
  const taken = new Set<AgentCommand>();
  return names.map((name) => {
    const record = records.find(
      (candidate) => !taken.has(candidate) && answersTo(candidate, name),
    );
    if (record === undefined) {
      return { name, description: '', argumentHint: '', aliases: [] };
    }
    taken.add(record);
    return record;
  });
}
