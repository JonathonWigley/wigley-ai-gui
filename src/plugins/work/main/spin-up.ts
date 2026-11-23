import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { ChatMainExports } from '../../chat/contract';
import type {
  WorkCard,
  WorkItem,
  WorkLinkArg,
  WorkProjectSetting,
  WorkStartArg,
} from '../contract';
import type { Refusal } from './actions';
import type { WorkFile } from './store';

type JiraCard = Extract<WorkCard, { kind: 'jira' }>;

// `launched`: chat started row `rowId` visibly, and the page toasts `toast`. `prompt`: no project fits, so the page
// opens chat's new-session prompt with `message` waiting in the box. Either way the session links to `cardIds`.
export type SpinUpResult =
  | { kind: 'launched'; rowId: string; toast: string; cardIds: string[] }
  | { kind: 'prompt'; message: string; cardIds: string[] };

export interface SpinUpDeps {
  chat: Pick<ChatMainExports, 'launch' | 'projects' | 'defaultProfile'>;
  projects(): readonly WorkProjectSetting[]; // work.projects, read at each start
  log: PluginLog;
}

// The most Slack threads a spin-up message lists.
export const SPIN_UP_THREADS = 5;

const isCard = (target: WorkCard | WorkItem): target is WorkCard =>
  'kind' in target;

const namesKey = (item: WorkItem, key: string) =>
  item.ticketKeys.some((listed) => listed.toUpperCase() === key.toUpperCase());

const newestFirst = (items: readonly WorkItem[]) =>
  [...items].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));

// The part of a Jira key before its `-`, upper-cased.
const projectKeyOf = (key: string) => key.split('-')[0].toUpperCase();

function threadLine(item: WorkItem): string {
  return `- ${item.title}: ${item.summary} (${item.url})`;
}

// The Jira card form: the heading, the url when not null, then the threads under a blank line when there are any.
function ticketMessage(
  key: string,
  title: string,
  url: string | null,
  threads: readonly WorkItem[],
): string {
  const lines = [`Work on ${key}: ${title}`];
  if (url !== null) {
    lines.push(url);
  }
  if (threads.length > 0) {
    lines.push('', 'Slack threads about it:', ...threads.map(threadLine));
  }
  return lines.join('\n');
}

// The form of an item with no ticket.
function threadMessage(item: WorkItem): string {
  return [
    `Follow up on this Slack thread: ${item.title}`,
    item.url,
    '',
    item.summary,
    `Latest: ${item.latest}`,
  ].join('\n');
}

function localTaskMessage(
  task: Extract<WorkCard, { kind: 'local' }>,
  items: readonly WorkItem[],
): string {
  const lines = [`Work on: ${task.title}`];
  if (task.url !== null) {
    lines.push(task.url);
  }
  const source = items.find((item) => item.id === task.sourceItemId);
  if (source !== undefined) {
    lines.push('', threadMessage(source));
  }
  return lines.join('\n');
}

// The items naming `key`, newest first, at most `SPIN_UP_THREADS`; `first`, when given, leads and is not repeated.
function threadsAbout(
  key: string,
  items: readonly WorkItem[],
  first: WorkItem | null,
): WorkItem[] {
  const others = newestFirst(
    items.filter((item) => item.id !== first?.id && namesKey(item, key)),
  );
  const threads = first === null ? others : [first, ...others];
  return threads.slice(0, SPIN_UP_THREADS);
}

// The harness-neutral first message of a session started from `target`: a Jira card's key, title, url and the
// threads naming it; a local task's title, url and source thread; an item with a ticket as its first key's card,
// titled from the board's card when the board holds one; an item with none as the thread to follow up.
export function spinUpMessage(
  target: WorkCard | WorkItem,
  items: readonly WorkItem[],
  cards: readonly WorkCard[],
): string {
  if (isCard(target)) {
    if (target.kind === 'local') {
      return localTaskMessage(target, items);
    }
    return ticketMessage(
      target.key,
      target.title,
      target.url,
      threadsAbout(target.key, items, null),
    );
  }
  const key = target.ticketKeys.at(0);
  if (key === undefined) {
    return threadMessage(target);
  }
  const card = cards.find(
    (candidate): candidate is JiraCard =>
      candidate.kind === 'jira' &&
      candidate.key.toUpperCase() === key.toUpperCase(),
  );
  const threads = threadsAbout(key, items, target);
  if (card === undefined) {
    return ticketMessage(key, target.title, target.url, threads);
  }
  return ticketMessage(card.key, card.title, card.url, threads);
}

// The cards a session started from `target` links to: a card itself; an item's Jira cards by its ticket keys and the
// local tasks made from it.
export function spinUpCardIds(
  target: WorkCard | WorkItem,
  cards: readonly WorkCard[],
): string[] {
  if (isCard(target)) {
    return [target.id];
  }
  const keys = new Set(target.ticketKeys.map((key) => key.toUpperCase()));
  return cards
    .filter((card) =>
      card.kind === 'jira'
        ? keys.has(card.key.toUpperCase())
        : card.sourceItemId === target.id,
    )
    .map((card) => card.id);
}

// The Jira project key a target starts in: a Jira card's, an item's first ticket key's; null for a local task or an
// item with no ticket.
function projectKeyOfTarget(target: WorkCard | WorkItem): string | null {
  if (isCard(target)) {
    return target.kind === 'jira' ? projectKeyOf(target.key) : null;
  }
  const key = target.ticketKeys.at(0);
  return key === undefined ? null : projectKeyOf(key);
}

function targetOf(
  file: WorkFile,
  arg: WorkStartArg,
): WorkCard | WorkItem | Refusal {
  if (arg.source === 'card') {
    return (
      file.cards.find((card) => card.id === arg.id) ?? {
        refused: `No card ${arg.id}`,
      }
    );
  }
  if (arg.source === 'item') {
    return (
      file.items.find((item) => item.id === arg.id) ?? {
        refused: `No item ${arg.id}`,
      }
    );
  }
  return { refused: `No source ${arg.source}` };
}

// Starts a session from the card or item `arg` names. A target whose Jira project `work.projects` maps to a chat
// project chat lists launches there visibly, on that project's profile or chat's default; any other target returns
// the message for chat's new-session prompt.
export async function startFromWork(
  deps: SpinUpDeps,
  file: WorkFile,
  arg: WorkStartArg,
): Promise<SpinUpResult | Refusal> {
  const target = targetOf(file, arg);
  if ('refused' in target) {
    return target;
  }
  const message = spinUpMessage(target, file.items, file.cards);
  const cardIds = spinUpCardIds(target, file.cards);
  const projectKey = projectKeyOfTarget(target);
  const mapping =
    projectKey === null
      ? undefined
      : deps
          .projects()
          .find(
            (entry) => entry.jiraProject.trim().toUpperCase() === projectKey,
          );
  const project =
    mapping === undefined
      ? undefined
      : deps.chat.projects().find((listed) => listed.name === mapping.project);
  if (project === undefined) {
    return { kind: 'prompt', message, cardIds };
  }
  const profile = project.profile ?? deps.chat.defaultProfile(null);
  if (profile === null) {
    return { refused: 'Chat has no profiles' };
  }
  let rowId: string;
  try {
    rowId = await deps.chat.launch({
      project: project.name,
      profile,
      message: { text: message, images: [] },
    });
  } catch (error) {
    deps.log(`session not started: ${errorText(error)}`);
    return { refused: errorText(error) };
  }
  return {
    kind: 'launched',
    rowId,
    toast: `Session started in ${project.name}`,
    cardIds,
  };
}

// Links session `arg.sessionId` to each listed card, once; an unknown card id is skipped. The same object when every
// listed card already holds it.
export function linkSession(file: WorkFile, arg: WorkLinkArg): WorkFile {
  const listed = new Set(arg.cardIds);
  const needsLink = (card: WorkCard) =>
    listed.has(card.id) && !card.linkedSessionIds.includes(arg.sessionId);
  if (!file.cards.some(needsLink)) {
    return file;
  }
  return {
    ...file,
    cards: file.cards.map((card) =>
      needsLink(card)
        ? {
            ...card,
            linkedSessionIds: [...card.linkedSessionIds, arg.sessionId],
          }
        : card,
    ),
  };
}
