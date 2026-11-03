import { describe, expect, it } from 'vitest';
import type { SessionTitles, ToolResult } from '../contract';
import { SET_SESSION_TITLE_TOOL, startTitleTool } from './title-tool';

const SESSION_ID = 'row-1';
const CONTEXT = { toolUseId: null, signal: new AbortController().signal };

interface Row {
  name: string;
  args: unknown;
  // The user's title before the calls; `ended` makes the session not connected.
  user: string | null;
  ended: boolean;
  // One call with `args` per limit, in order; the result checked is the last.
  limits: number[];
  isError: boolean;
  text: string;
  stored: string | null;
}

const ROWS: Row[] = [
  {
    name: 'a title stores as the agent title',
    args: { title: 'Session titles' },
    user: null,
    ended: false,
    limits: [40],
    isError: false,
    text: 'Title set to "Session titles".',
    stored: 'Session titles',
  },
  {
    name: 'a blank title is refused',
    args: { title: '   ' },
    user: null,
    ended: false,
    limits: [40],
    isError: true,
    text: 'The title is empty.',
    stored: null,
  },
  {
    name: 'a title over the limit is refused naming both lengths',
    args: { title: 'x'.repeat(41) },
    user: null,
    ended: false,
    limits: [40],
    isError: true,
    text: 'The title is 41 characters; the limit is 40.',
    stored: null,
  },
  {
    name: 'a missing title is refused',
    args: {},
    user: null,
    ended: false,
    limits: [40],
    isError: true,
    text: 'title must be a string.',
    stored: null,
  },
  {
    name: "under a user title the agent title stores and the reply names the user's",
    args: { title: 'Theirs' },
    user: 'Mine',
    ended: false,
    limits: [40],
    isError: false,
    text: 'Saved "Theirs" as the agent title; the user\'s own title "Mine" shows until they clear it.',
    stored: 'Theirs',
  },
  {
    name: 'a call after the session ended is refused',
    args: { title: 'Session titles' },
    user: null,
    ended: true,
    limits: [40],
    isError: true,
    text: 'This session has ended.',
    stored: null,
  },
  {
    name: 'the limit is read on each call',
    args: { title: 'Session titles' },
    user: null,
    ended: false,
    limits: [40, 10],
    isError: true,
    text: 'The title is 14 characters; the limit is 10.',
    stored: 'Session titles',
  },
];

describe('set_session_title', () => {
  it.each(ROWS)('$name', async (row) => {
    const titles: SessionTitles = {
      user: row.user,
      agent: null,
      firstMessage: null,
    };
    let limit = 0;
    const toolSession = startTitleTool({
      setTitle: (sessionId, source, title) => {
        expect(sessionId).toBe(SESSION_ID);
        titles[source] = title;
      },
      titles: (sessionId) =>
        row.ended || sessionId !== SESSION_ID ? null : { ...titles },
      maxLength: () => limit,
    })({
      id: SESSION_ID,
      info: {
        sessionId: 'host-1',
        projectDir: null,
        deadlineSeconds: null,
        harness: 'claude',
      },
    });

    let result: ToolResult | undefined;
    for (const each of row.limits) {
      limit = each;
      result = await toolSession.call(
        SET_SESSION_TITLE_TOOL.name,
        row.args,
        CONTEXT,
      );
    }

    expect(result?.isError ?? false).toBe(row.isError);
    expect(result?.content).toEqual([{ type: 'text', text: row.text }]);
    expect(titles.agent).toBe(row.stored);
    expect(titles.user).toBe(row.user);
  });

  it('describes itself with the pinned name, description and schema', () => {
    expect(SET_SESSION_TITLE_TOOL).toEqual({
      name: 'set_session_title',
      description:
        'Name this session in the Auri side bar so the user can tell it apart from their other sessions. Give a title of 2 to 4 words, at most 30 characters, that names the topic of the work like a heading ("Agent Status Line", "Forms Crash on Resume"), not a sentence describing the request. Call it at the end of your first turn, and again only when the work\'s focus clearly changes. A title over the length limit is refused with the limit; send a shorter one.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              'A 2 to 4 word heading naming this session’s topic, at most 30 characters.',
          },
        },
        required: ['title'],
        additionalProperties: false,
      },
    });
  });
});
