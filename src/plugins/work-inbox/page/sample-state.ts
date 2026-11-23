import type { WorkItem, WorkState } from '../../work/contract';

const MINUTE_MS = 60_000;

// The Inbox demo's work state, its times counted back from `now` (epoch ms). Newest first: the dismissed item, so All
// opens on it; the Needs you item with a ticket key and a worker draft; a second Needs you item; then one item in each
// other section, Waiting on others with a nudge. Three items hold ticket keys, and the last job is a finished sweep
// with a row, so every card action's and the status line's anchors draw. Ids are sample ids main never holds.
export function sampleInboxState(now: number): WorkState {
  const ago = (minutes: number) =>
    new Date(now - minutes * MINUTE_MS).toISOString();
  const item = (
    id: string,
    minutes: number,
    fields: Pick<WorkItem, 'section' | 'channel' | 'author' | 'title'> &
      Partial<WorkItem>,
  ): WorkItem => ({
    id: `sample-${id}`,
    at: ago(minutes),
    summary: '',
    latest: '',
    participants: [fields.author],
    url: `https://slack.example/sample-${id}`,
    ticketKeys: [],
    linkReason: null,
    why: null,
    draft: null,
    state: 'open',
    snoozedUntil: null,
    firstSeen: ago(minutes + 5),
    note: null,
    sending: null,
    ...fields,
  });
  return {
    items: [
      item('old-ask', 2, {
        section: 'needs_you',
        channel: '#design',
        author: 'Mia',
        title: 'Which icon set for the toolbar?',
        summary: 'Mia asked which icon set to ship; answered in a call.',
        latest: 'Mia: thanks, sorted',
        state: 'dismissed',
      }),
      item('review', 6, {
        section: 'needs_you',
        channel: '#platform',
        author: 'Ann',
        title: 'Review the retry change',
        summary:
          'Ann asks for a review of the sync retry change before Friday.',
        latest: 'Ann: any chance today?',
        participants: ['Ann', 'Bo'],
        ticketKeys: ['PLAT-142'],
        draft: 'On it now, comments within the hour.',
      }),
      item('dm', 25, {
        section: 'needs_you',
        channel: 'DM',
        author: 'Bo',
        title: 'Lunch on Thursday?',
        summary: 'Bo asks whether Thursday lunch still works.',
        latest: 'Bo: still on for Thursday?',
      }),
      item('promise', 90, {
        section: 'promised',
        channel: '#release',
        author: 'Cy',
        title: 'Send the release notes',
        summary: 'You said you would post the release notes by end of day.',
        latest: 'You: will post them by five',
        ticketKeys: ['REL-9'],
      }),
      item('nudge', 180, {
        section: 'waiting',
        channel: '#backend',
        author: 'Dee',
        title: 'Schema sign-off',
        summary: 'You asked Dee to sign off the schema change two days ago.',
        latest: 'You: does the schema look right?',
        draft: 'Any word on the schema? Happy to walk through it.',
      }),
      item('thread', 300, {
        section: 'my_threads',
        channel: '#platform',
        author: 'You',
        title: 'Flaky upload test',
        summary: 'Your thread on the flaky upload test has two new replies.',
        latest: 'Eli: reproduced it on CI',
        ticketKeys: ['PLAT-150'],
      }),
      item('around', 600, {
        section: 'around',
        channel: '#mobile',
        author: 'Fay',
        title: 'New crash on Android 15',
        summary: 'The mobile team is chasing a crash in the sync client.',
        latest: 'Fay: seems tied to the retry path',
        why: 'It touches the retry code you are changing.',
      }),
      item('news', 1440, {
        section: 'worth_knowing',
        channel: '#announcements',
        author: 'Gus',
        title: 'CI moves to the new runners',
        summary: 'CI jobs move to the new runners next Monday.',
        latest: 'Gus: expect a short outage at nine',
        why: 'Your release build runs that morning.',
      }),
    ],
    cards: [],
    suggestions: [],
    columns: [],
    job: {
      running: null,
      last: {
        kind: 'sweep',
        state: 'done',
        rowId: 'sample-sweep-row',
        at: ago(4),
        note: null,
      },
    },
    problem: null,
  };
}
