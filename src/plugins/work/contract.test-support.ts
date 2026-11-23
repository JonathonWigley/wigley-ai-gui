import type { WorkCard, WorkItem } from './contract';

type JiraCard = Extract<WorkCard, { kind: 'jira' }>;
type LocalCard = Extract<WorkCard, { kind: 'local' }>;

// An open Needs you item `id`, with `overrides` laid over it.
export function workItem(
  id: string,
  overrides: Partial<WorkItem> = {},
): WorkItem {
  return {
    id,
    section: 'needs_you',
    channel: '#team',
    author: 'Ann',
    at: '2026-11-23T10:00:00.000Z',
    title: `Thread ${id}`,
    summary: 'Ann asks for a review.',
    latest: 'Ann: any news?',
    participants: ['Ann', 'Bo'],
    url: `https://slack.example/${id}`,
    ticketKeys: [],
    linkReason: null,
    why: null,
    draft: null,
    state: 'open',
    snoozedUntil: null,
    firstSeen: '2026-11-23T10:05:00.000Z',
    note: null,
    sending: null,
    ...overrides,
  };
}

// A Jira card for `key` in status `jiraStatus`, with `overrides` laid over it.
export function jiraCard(
  key: string,
  jiraStatus: string,
  overrides: Partial<JiraCard> = {},
): JiraCard {
  return {
    kind: 'jira',
    id: key,
    key,
    title: `Ticket ${key}`,
    url: `https://jira.example/browse/${key}`,
    column: 'Backlog',
    movingTo: null,
    note: null,
    linkedSessionIds: [],
    movedAt: null,
    jiraStatus,
    priority: null,
    reachableStatuses: null,
    ...overrides,
  };
}

// A local task `id` in `column`, with `overrides` laid over it.
export function localCard(
  id: string,
  column: string,
  overrides: Partial<LocalCard> = {},
): LocalCard {
  return {
    kind: 'local',
    id,
    title: `Task ${id}`,
    url: null,
    column,
    movingTo: null,
    note: null,
    linkedSessionIds: [],
    movedAt: null,
    sourceItemId: null,
    ...overrides,
  };
}
