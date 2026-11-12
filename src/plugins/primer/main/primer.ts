import { createHash } from 'node:crypto';
import type { AgentFormEndKind } from '../../../contracts/agent-forms';
import { isJsonObject, type JsonObject } from '../../../shared/json';
import {
  MAX_PRIMER_ENTRIES,
  MAX_PRIMER_ITEMS,
  PRIMER_NEEDS,
  PRIMER_SLUG_PATTERN,
  type Primer,
  type PrimerBody,
  type PrimerEntry,
  type PrimerFeature,
  type PrimerGroup,
  type PrimerItem,
  type PrimerNeed,
  type PrimerPayload,
} from '../contract';
import { PrimerError } from './primer-error';

// The groups an agent may send; `extra` is the user's alone.
const AGENT_GROUPS: readonly PrimerGroup[] = ['primer', 'standing'];

const NEXT_ON_DRAFT =
  'The user has not submitted yet. Call collect_last_primer to keep waiting. ' +
  'Do not open a second primer.';

const NEXT_ON_CANCELLED =
  'The user cancelled the primer. Write nothing, and ask the user how to ' +
  'proceed.';

const NEXT_ON_NO_PRIMER =
  'No primer is open for this session, and no finished answers are waiting ' +
  'for it. If you sent a primer whose answers you never received, send the ' +
  "same primer again with open_primer: the user's saved answers fill in. Do " +
  'not move the questions into the reply.';

function isPrimerNeed(value: unknown): value is PrimerNeed {
  return PRIMER_NEEDS.some((need) => need === value);
}

function isAgentGroup(value: unknown): value is PrimerGroup {
  return AGENT_GROUPS.some((group) => group === value);
}

// The field trimmed, or '' when it is not a string.
function textOf(source: JsonObject, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

function requiredText(source: JsonObject, key: string, where: string): string {
  const value = textOf(source, key);
  if (value === '') {
    throw new PrimerError(
      `${where}.${key} is required and must be a non-empty string.`,
    );
  }
  return value;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function parseItemTexts(items: unknown, where: string): string[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PrimerError(
      `${where}.items must list the work items as strings, two to six of them.`,
    );
  }
  if (items.length > MAX_PRIMER_ITEMS) {
    throw new PrimerError(
      `${where}.items holds ${items.length} items; the limit is ${MAX_PRIMER_ITEMS}.`,
    );
  }
  return items.map((item: unknown, i) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new PrimerError(
        `${where}.items[${i + 1}] must be a non-empty string.`,
      );
    }
    return item.trim();
  });
}

// `index` is 1-based, as the messages name it.
function parseEntry(entry: unknown, index: number): PrimerEntry {
  const where = `entries[${index}]`;
  if (!isJsonObject(entry)) {
    throw new PrimerError(`${where} must be an object.`);
  }
  const group = entry.group === undefined ? 'primer' : entry.group;
  if (!isAgentGroup(group)) {
    throw new PrimerError(`${where}.group must be 'primer' or 'standing'.`);
  }
  const { need } = entry;
  if (!isPrimerNeed(need)) {
    throw new PrimerError(`${where}.need must be 'yes', 'no' or 'unclear'.`);
  }
  const texts = parseItemTexts(entry.items, where);
  const task = requiredText(entry, 'task', where);
  const number = Number.isInteger(entry.number)
    ? (entry.number as number)
    : null;
  return {
    id: requiredText(entry, 'id', where),
    group,
    number,
    area: textOf(entry, 'area'),
    question: textOf(entry, 'question') || task,
    task,
    need,
    evidence: textOf(entry, 'evidence'),
    probes: textOf(entry, 'probes'),
    pointer: textOf(entry, 'pointer'),
    comment: '',
    // A row the agent judged not needed opens with its items left out.
    items: texts.map((text) => ({
      text,
      include: need !== 'no',
      comment: '',
      added: false,
    })),
  };
}

function parseEntries(entries: unknown): PrimerEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new PrimerError(
      "'entries' must be a non-empty array: the primer rows, then the standing tasks.",
    );
  }
  if (entries.length > MAX_PRIMER_ENTRIES) {
    throw new PrimerError(
      `'entries' holds ${entries.length} entries; the limit is ${MAX_PRIMER_ENTRIES}.`,
    );
  }
  const seen = new Set<string>();
  return entries.map((raw: unknown, i) => {
    const entry = parseEntry(raw, i + 1);
    if (seen.has(entry.id)) {
      throw new PrimerError(
        `entries[${i + 1}].id '${entry.id}' repeats an earlier entry.`,
      );
    }
    seen.add(entry.id);
    return entry;
  });
}

// Every error fires here, before anything is shown, so a malformed primer
// costs the caller one retry and the user sees nothing.
export function parsePrimer(args: unknown): Primer {
  if (!isJsonObject(args)) {
    throw new PrimerError(
      "open_primer takes an object with 'feature' and 'entries'.",
    );
  }
  const { feature } = args;
  if (!isJsonObject(feature)) {
    throw new PrimerError(
      "'feature' must be an object with name, slug, spec and summary.",
    );
  }
  const name = requiredText(feature, 'name', 'feature');
  const slug = requiredText(feature, 'slug', 'feature');
  if (!PRIMER_SLUG_PATTERN.test(slug)) {
    throw new PrimerError(
      `feature.slug '${slug}' must be lowercase letters, digits and dashes.`,
    );
  }
  return {
    feature: {
      name,
      slug,
      spec: textOf(feature, 'spec'),
      summary: textOf(feature, 'summary'),
      notes: '',
    },
    entries: parseEntries(args.entries),
  };
}

function copyItems(items: PrimerItem[]): PrimerItem[] {
  return items.map((item) => ({ ...item }));
}

// The sent items, the first MAX_PRIMER_ITEMS only, or a copy of `fallback`
// when `sent` is not a list.
function itemsFrom(sent: unknown, fallback: PrimerItem[]): PrimerItem[] {
  if (!Array.isArray(sent)) {
    return copyItems(fallback);
  }
  const items: PrimerItem[] = [];
  for (const item of sent.slice(0, MAX_PRIMER_ITEMS) as unknown[]) {
    if (!isJsonObject(item)) {
      continue;
    }
    const text = stringOr(item.text, '').trim();
    if (text === '') {
      continue;
    }
    items.push({
      text,
      include: item.include !== false,
      comment: stringOr(item.comment, ''),
      added: item.added === true,
    });
  }
  return items;
}

// The user's fields from `sent` on a copy of the agent's entry: need, comment
// and items.
function mergeEntry(
  original: PrimerEntry,
  sent: JsonObject | undefined,
): PrimerEntry {
  if (sent === undefined) {
    return { ...original, items: copyItems(original.items) };
  }
  return {
    ...original,
    need: isPrimerNeed(sent.need) ? sent.need : original.need,
    comment: stringOr(sent.comment, original.comment),
    items: itemsFrom(sent.items, original.items),
  };
}

function extraEntry(id: string, sent: JsonObject): PrimerEntry {
  const task = stringOr(sent.task, '').trim();
  return {
    id,
    group: 'extra',
    number: null,
    area: '',
    question: task,
    task,
    need: isPrimerNeed(sent.need) ? sent.need : 'yes',
    evidence: '',
    probes: '',
    pointer: '',
    comment: stringOr(sent.comment, ''),
    items: itemsFrom(sent.items, []),
  };
}

function readFeature(base: PrimerFeature, raw: unknown): PrimerFeature {
  const sent = isJsonObject(raw) ? raw : {};
  const sentSlug = typeof sent.slug === 'string' ? sent.slug.trim() : '';
  return {
    name: stringOr(sent.name, base.name),
    slug: PRIMER_SLUG_PATTERN.test(sentSlug) ? sentSlug : base.slug,
    spec: stringOr(sent.spec, base.spec),
    summary: stringOr(sent.summary, base.summary),
    notes: stringOr(sent.notes, base.notes),
  };
}

// The page's body rebuilt field by field onto the primer's own. The agent's
// fields (question, evidence, probes, pointer) never come from the body; the
// user's do: need, comments, items, the feature fields, and extra entries.
export function readPrimerBody(primer: Primer, raw: unknown): PrimerBody {
  const sent = isJsonObject(raw) ? raw : {};
  const sentEntries = (Array.isArray(sent.entries) ? sent.entries : []).filter(
    (entry: unknown): entry is JsonObject & { id: string } =>
      isJsonObject(entry) && typeof entry.id === 'string',
  );
  const byId = new Map(sentEntries.map((entry) => [entry.id, entry]));
  const entries = primer.entries.map((original) =>
    mergeEntry(original, byId.get(original.id)),
  );
  const known = new Set(primer.entries.map((entry) => entry.id));
  for (const entry of sentEntries) {
    if (entry.group === 'extra' && !known.has(entry.id)) {
      entries.push(extraEntry(entry.id, entry));
      known.add(entry.id);
    }
  }
  return { feature: readFeature(primer.feature, sent.feature), entries };
}

// What a re-sent primer is matched on: the parsed feature but its notes, and
// the parsed entries.
export function primerFingerprint(primer: Primer): string {
  const { name, slug, spec, summary } = primer.feature;
  const text = JSON.stringify({
    feature: { name, slug, spec, summary },
    entries: primer.entries,
  });
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function savedPrimerHeading(args: unknown): string | null {
  const feature = isJsonObject(args) ? args.feature : undefined;
  const name = isJsonObject(feature) ? feature.name : undefined;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
}

function summarise(entries: PrimerEntry[], stillOpen: boolean): string {
  const counts: Record<PrimerNeed, number> = { yes: 0, no: 0, unclear: 0 };
  let comments = 0;
  for (const entry of entries) {
    counts[entry.need] += 1;
    const commentedItems = entry.items.filter((item) => item.comment !== '');
    comments += (entry.comment !== '' ? 1 : 0) + commentedItems.length;
  }
  const line =
    `${entries.length} entries: ${counts.yes} yes, ${counts.unclear} ` +
    `unclear, ${counts.no} no; ${comments} comments.`;
  return stillOpen ? `${line} The form is still open.` : line;
}

const NEXT_BY_OUTCOME: Record<AgentFormEndKind | 'draft', string> = {
  draft: NEXT_ON_DRAFT,
  cancelled: NEXT_ON_CANCELLED,
  submitted: '',
};

// The tool result for a primer that ran: the user's feature and entries.
export function primerPayload(
  primer: Primer,
  outcome: AgentFormEndKind | 'draft',
  body: PrimerBody,
): PrimerPayload {
  const read = readPrimerBody(primer, body);
  return {
    outcome,
    summary: summarise(read.entries, outcome === 'draft'),
    next: NEXT_BY_OUTCOME[outcome],
    feature: read.feature,
    entries: read.entries,
  };
}

// An earlier primer's finished answers, returned by an open_primer that did
// not open its own primer.
export function primerHandedBackPayload(
  primer: Primer,
  outcome: AgentFormEndKind,
  body: PrimerBody,
): PrimerPayload {
  const { name } = primer.feature;
  return {
    ...primerPayload(primer, outcome, body),
    next:
      `These answers are for an earlier primer, '${name}', that you never ` +
      `received. Read them as that primer's answers. The primer you just ` +
      `sent was not opened: send it again with open_primer.`,
    earlier_heading: name,
  };
}

// collect_last_primer with nothing to collect: a normal payload, not an error.
export function noPrimerPayload(): PrimerPayload {
  return {
    outcome: 'no_primer',
    summary: 'No primer is open.',
    next: NEXT_ON_NO_PRIMER,
  };
}

// The draft a call returns when its primer was never shown, so it holds the
// agent's own triage; it names the blocking primer, when one is open, for the
// agent to point the user at.
export function primerNotShownPayload(
  primer: Primer,
  blockingHeading: string | null,
): PrimerPayload {
  const other =
    blockingHeading === null
      ? 'another primer'
      : `the primer '${blockingHeading}'`;
  return {
    ...primerPayload(primer, 'draft', readPrimerBody(primer, {})),
    summary:
      `This primer, '${primer.feature.name}', was not shown: ${other} is ` +
      `still open in the app.`,
    next:
      `The user has not finished ${other} in the app, so this primer was not ` +
      `opened and has no answers. Send this primer again with open_primer, ` +
      `and again after every draft like this one. Once the user finishes ` +
      `${other}, a send may return that primer's answers instead, marked ` +
      `with earlier_heading: act on them, then send this primer again. If ` +
      `${other} is no longer needed, ask the user to cancel it in the app. ` +
      `Do not call collect_last_primer for this primer: that returns the ` +
      `other primer's answers.`,
  };
}
