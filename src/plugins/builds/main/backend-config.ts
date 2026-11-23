import { isJsonObject, type JsonObject } from '../../../shared/json';
import type {
  BackendEntry,
  BuildKindEntry,
  BuildSetEntry,
  GameEntry,
} from '../contract';

// One element of the `backends` setting as `builds` read it. `id` is the element's id, or `#<n>` (its 1-based place)
// when it has no valid one, and `<id>#<n>` for a duplicate; `label` falls back to the id. `entry` is null when the
// backend itself fails a check, so it is not polled; a game that fails a check is left out of `entry`. `problems` holds
// the backend's own problem first, then each dropped game's, in game order.
export interface ParsedBackend {
  id: string;
  kind: string;
  label: string;
  entry: BackendEntry | null;
  problems: string[];
}

const VALID_ID = /^[A-Za-z0-9._-]+$/;

// Parses the `backends` setting. Each backend, game, kind and set gives only its first failing check. A `clone` is
// passed through `expandTilde`; `config` and each kind's `target` pass through unread.
export function parseBackends(
  value: readonly unknown[],
  expandTilde: (text: string) => string,
): ParsedBackend[] {
  const seenIds = new Set<string>();
  return value.map((element, index) =>
    parseBackend(element, index + 1, seenIds, expandTilde),
  );
}

function parseBackend(
  element: unknown,
  n: number,
  seenIds: Set<string>,
  expandTilde: (text: string) => string,
): ParsedBackend {
  if (!isJsonObject(element)) {
    return failed(`#${n}`, '', `#${n}`, `entry ${n} is not an object`);
  }
  const kind = isFilledText(element.kind) ? element.kind : '';
  const ownLabel = (id: string) =>
    isFilledText(element.label) ? element.label : id;
  const { id } = element;
  if (!isFilledText(id)) {
    return failed(`#${n}`, kind, ownLabel(`#${n}`), `entry ${n} has no id`);
  }
  if (!VALID_ID.test(id) || id === '.' || id === '..') {
    return failed(`#${n}`, kind, ownLabel(`#${n}`), `${id} is not a valid id`);
  }
  const folded = id.toLowerCase();
  if (seenIds.has(folded)) {
    const placed = `${id}#${n}`;
    return failed(
      placed,
      kind,
      ownLabel(placed),
      `duplicate backend id "${id}"`,
    );
  }
  seenIds.add(folded);
  const label = ownLabel(id);
  if (!isFilledText(element.kind)) {
    return failed(id, kind, label, `${id} has no kind`);
  }
  if (!isFilledText(element.label)) {
    return failed(id, kind, label, `${id} has no label`);
  }
  if (!Array.isArray(element.games)) {
    return failed(id, kind, label, `${id}: games is not a list`);
  }
  const problems: string[] = [];
  const games: GameEntry[] = [];
  const gameIds = new Set<string>();
  element.games.forEach((game: unknown, gameIndex) => {
    const result = parseGame(game, gameIndex + 1, gameIds, expandTilde);
    if (typeof result === 'string') {
      problems.push(result);
    } else {
      games.push(result);
    }
  });
  return {
    id,
    kind,
    label,
    entry: { id, kind, label, config: element.config, games },
    problems,
  };
}

function failed(
  id: string,
  kind: string,
  label: string,
  problem: string,
): ParsedBackend {
  return { id, kind, label, entry: null, problems: [problem] };
}

// The game, or the text of its first failing check. `gameIds` collects the id of every game that got past the id
// checks, so a later game with the same id is a duplicate.
function parseGame(
  game: unknown,
  n: number,
  gameIds: Set<string>,
  expandTilde: (text: string) => string,
): GameEntry | string {
  if (!isJsonObject(game) || !isFilledText(game.id)) {
    return `game ${n} has no id`;
  }
  const { id } = game;
  if (gameIds.has(id)) {
    return `duplicate game id "${id}"`;
  }
  gameIds.add(id);
  if (!isFilledText(game.label)) {
    return `game ${id} has no label`;
  }
  const hasClone = game.clone !== undefined && game.clone !== null;
  if (hasClone && typeof game.clone !== 'string') {
    return `game ${id}: clone is not a path`;
  }
  if (!isFilledText(game.defaultBranch)) {
    return `game ${id} has no defaultBranch`;
  }
  if (!isJsonObject(game.kinds) || Object.keys(game.kinds).length === 0) {
    return `game ${id} has no kinds`;
  }
  const kinds = parseKinds(game.kinds);
  if (typeof kinds === 'string') {
    return `game ${id}: kind ${kinds} needs a label and a target`;
  }
  const sets = game.sets === undefined ? [] : parseSets(game.sets, kinds);
  if (typeof sets === 'string') {
    return `game ${id}: ${sets}`;
  }
  return {
    id,
    label: game.label,
    clone: typeof game.clone === 'string' ? expandTilde(game.clone) : null,
    defaultBranch: game.defaultBranch,
    kinds,
    sets,
  };
}

// The kinds, or the id of the first kind that is not an object with a string `label` and a `target` key.
function parseKinds(kinds: JsonObject): Record<string, BuildKindEntry> | string {
  const parsed: Record<string, BuildKindEntry> = {};
  for (const [kindId, kind] of Object.entries(kinds)) {
    const isKind =
      isJsonObject(kind) &&
      typeof kind.label === 'string' &&
      Object.hasOwn(kind, 'target');
    if (!isKind) {
      return kindId;
    }
    parsed[kindId] = { label: kind.label as string, target: kind.target };
  }
  return parsed;
}

// The sets, or the first failing check's text without its `game <id>: ` lead.
function parseSets(
  sets: unknown,
  kinds: Record<string, BuildKindEntry>,
): BuildSetEntry[] | string {
  if (!Array.isArray(sets)) {
    return 'sets is not a list';
  }
  const parsed: BuildSetEntry[] = [];
  const setIds = new Set<string>();
  for (const [index, set] of sets.entries()) {
    const result = parseSet(set as unknown, index + 1, setIds, kinds);
    if (typeof result === 'string') {
      return result;
    }
    parsed.push(result);
  }
  return parsed;
}

function parseSet(
  set: unknown,
  n: number,
  setIds: Set<string>,
  kinds: Record<string, BuildKindEntry>,
): BuildSetEntry | string {
  if (!isJsonObject(set) || !isFilledText(set.id)) {
    return `set ${n} has no id`;
  }
  const { id } = set;
  if (setIds.has(id)) {
    return `duplicate set id "${id}"`;
  }
  setIds.add(id);
  if (Object.hasOwn(kinds, id)) {
    return `set "${id}" has a kind's id`;
  }
  if (!isFilledText(set.label)) {
    return `set ${id} has no label`;
  }
  const setKinds = set.kinds;
  const isKindList =
    Array.isArray(setKinds) &&
    setKinds.length > 0 &&
    setKinds.every((kind) => typeof kind === 'string');
  if (!isKindList) {
    return `set ${id} has no kinds`;
  }
  const unknownKind = (setKinds as string[]).find(
    (kind) => !Object.hasOwn(kinds, kind),
  );
  if (unknownKind !== undefined) {
    return `set ${id} names no kind "${unknownKind}"`;
  }
  if (!isFilledText(set.branches)) {
    return `set ${id} has no branches`;
  }
  const prompt = set.agentPrompt;
  const isPrompt =
    prompt === undefined || prompt === null || typeof prompt === 'string';
  if (!isPrompt) {
    return `set ${id}: agentPrompt is not text`;
  }
  return {
    id,
    label: set.label,
    kinds: [...(setKinds as string[])],
    branches: set.branches,
    agentPrompt: typeof prompt === 'string' ? prompt : null,
  };
}

function isFilledText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}
