import type { ModePlace } from '../../contracts/plugin';
import type { ActivityBarSetting } from '../../contracts/settings';

// An added mode as the activity bar arranges it: `id` is the qualified mode id
// `modes.show` takes and the setting names (`work-inbox.main`); `firstAdd`
// ranks the mode by its id's first add, earliest lowest.
export interface ActivityModeEntry {
  id: string;
  place: ModePlace | undefined;
  firstAdd: number;
}

// The activity bar's groups of mode ids, each edge's top to bottom.
export interface ActivityGroups {
  top: string[][];
  bottom: string[][];
}

type Edge = 'top' | 'bottom';

interface ListedGroup {
  ids: string[];
  at: Edge;
}

// With no setting group, the modes sit in their suggested places: by edge,
// then `group`, then `order`, ties by first add, and modes with no place in a
// last top group. With setting groups, each lists its ids naming an added mode
// on its edge, an id's first listing winning, and the modes no group lists
// form one group after the last top group, in suggestion order. `hidden`
// removes its ids either way, and a group left empty is dropped. The setting
// arrives unchecked from `settings.json`, so a malformed group, id or `hidden`
// is skipped and an `at` other than `bottom` reads as `top`.
export function arrangeActivityItems(
  modes: readonly ActivityModeEntry[],
  setting: ActivityBarSetting,
): ActivityGroups {
  const hidden = new Set(readHidden(setting));
  const shown = modes.filter((mode) => !hidden.has(mode.id));
  const listed = readGroups(setting);
  return listed.length === 0
    ? arrangeBySuggestion(shown)
    : arrangeByGroups(shown, listed);
}

function arrangeBySuggestion(
  modes: readonly ActivityModeEntry[],
): ActivityGroups {
  const groups: ActivityGroups = { top: [], bottom: [] };
  let lastKey: string | undefined;
  let current: string[] = [];
  for (const mode of [...modes].sort(bySuggestion)) {
    const key = suggestedGroupKey(mode.place);
    if (key !== lastKey) {
      current = [];
      groups[edgeOf(mode.place?.at)].push(current);
      lastKey = key;
    }
    current.push(mode.id);
  }
  return groups;
}

function arrangeByGroups(
  modes: readonly ActivityModeEntry[],
  listed: readonly ListedGroup[],
): ActivityGroups {
  const added = new Set(modes.map((mode) => mode.id));
  const placed = new Set<string>();
  const groups: ActivityGroups = { top: [], bottom: [] };
  for (const group of listed) {
    const ids: string[] = [];
    for (const id of group.ids) {
      if (added.has(id) && !placed.has(id)) {
        placed.add(id);
        ids.push(id);
      }
    }
    if (ids.length > 0) {
      groups[group.at].push(ids);
    }
  }
  const unlisted = modes
    .filter((mode) => !placed.has(mode.id))
    .sort(bySuggestion)
    .map((mode) => mode.id);
  if (unlisted.length > 0) {
    groups.top.push(unlisted);
  }
  return groups;
}

// Edge, then `group`, then `order`, then first add; modes with no place last.
function bySuggestion(a: ActivityModeEntry, b: ActivityModeEntry): number {
  if (a.place === undefined || b.place === undefined) {
    const unplacedLast =
      Number(a.place === undefined) - Number(b.place === undefined);
    return unplacedLast !== 0 ? unplacedLast : a.firstAdd - b.firstAdd;
  }
  return (
    edgeRank(a.place) - edgeRank(b.place) ||
    a.place.group - b.place.group ||
    a.place.order - b.place.order ||
    a.firstAdd - b.firstAdd
  );
}

function suggestedGroupKey(place: ModePlace | undefined): string {
  return place === undefined ? 'unplaced' : `${edgeOf(place.at)}:${place.group}`;
}

function edgeRank(place: ModePlace): number {
  return edgeOf(place.at) === 'bottom' ? 1 : 0;
}

function edgeOf(at: unknown): Edge {
  return at === 'bottom' ? 'bottom' : 'top';
}

function readGroups(setting: ActivityBarSetting): ListedGroup[] {
  const groups: unknown = setting.groups;
  if (!Array.isArray(groups)) {
    return [];
  }
  return groups.filter(isGroupValue).map((group) => ({
    ids: group.modes.filter(isString),
    at: edgeOf(group.at),
  }));
}

function readHidden(setting: ActivityBarSetting): string[] {
  const hidden: unknown = setting.hidden;
  return Array.isArray(hidden) ? hidden.filter(isString) : [];
}

function isGroupValue(
  value: unknown,
): value is { modes: unknown[]; at?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { modes?: unknown }).modes)
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
