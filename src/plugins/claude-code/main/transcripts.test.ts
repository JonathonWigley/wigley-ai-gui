import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import {
  endsInsideLine,
  mainReplies,
  projectFolderName,
  readTranscriptHead,
  sessionTitle,
  SYNTHETIC_MODEL,
  transcriptEntries,
  transcriptName,
} from './transcripts';

function jsonl(lines: (object | string)[]): string {
  return lines
    .map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
    .join('\n');
}

function userLine(uuid: string, content: unknown, extra: object = {}) {
  return {
    type: 'user',
    uuid,
    cwd: '/w/app',
    sessionId: 's',
    isSidechain: false,
    message: { role: 'user', content },
    ...extra,
  };
}

function assistantLine(uuid: string, block: object, timestamp?: string) {
  return {
    type: 'assistant',
    uuid,
    cwd: '/w/app',
    sessionId: 's',
    isSidechain: false,
    message: { role: 'assistant', content: [block] },
    ...(timestamp === undefined ? {} : { timestamp }),
  };
}

// Two transcript `timestamp`s and their epoch milliseconds.
const AT_ONE_TEXT = '2026-10-27T16:07:09.193Z';
const AT_ONE = 1793117229193;
const AT_TWO_TEXT = '2026-10-27T16:07:12.500Z';
const AT_TWO = 1793117232500;

describe('projectFolderName', () => {
  it('projectFolderName_ReplacesEveryNonAlphanumeric', () => {
    expect(projectFolderName('/Users/u/.claude')).toBe('-Users-u--claude');
    expect(projectFolderName('/a/b_c d')).toBe('-a-b-c-d');
  });
});

describe('readTranscriptHead', () => {
  it('readTranscriptHead_SlashCommand_TitlesNameAndArgs', () => {
    const head = jsonl([
      { type: 'mode' },
      userLine('u0', 'skill body', { isMeta: true }),
      userLine(
        'u1',
        '<command-message>wigley:feature</command-message>\n<command-name>/wigley:feature</command-name>\n<command-args>add a hello command</command-args>',
      ),
      '{"type":"user","mess',
    ]);

    expect(readTranscriptHead(head)).toEqual({
      cwd: '/w/app',
      firstMessage: '/wigley:feature add a hello command',
      sawUserLine: true,
    });
  });

  it('readTranscriptHead_SkipsCaveatAndMeta', () => {
    const head = jsonl([
      userLine('u0', 'expanded skill', { isMeta: true }),
      userLine(
        'u1',
        '<local-command-caveat>Caveat: the messages below…</local-command-caveat>',
      ),
      userLine('u2', 'fix   the\n bug'),
    ]);

    const { firstMessage } = readTranscriptHead(head);

    expect(firstMessage).toBe('fix   the\n bug');
    expect(sessionTitle(firstMessage)).toBe('fix the bug');
  });

  it('readTranscriptHead_SkipsCliWrittenUserLines', () => {
    const head = jsonl([
      userLine('u0', 'This session is being continued…', {
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
      }),
      userLine('u1', '<task-notification>\n<task-id>t1</task-id>'),
      userLine('u2', [{ type: 'text', text: '[Request interrupted by user]' }]),
      userLine('u3', 'the real ask'),
    ]);

    expect(readTranscriptHead(head).firstMessage).toBe('the real ask');
  });

  it('readTranscriptHead_ShellCommandFirst_TitlesBangCommand', () => {
    const head = jsonl([
      userLine('u1', '<bash-input>git status</bash-input>'),
      userLine(
        'u2',
        '<bash-stdout>On branch main</bash-stdout><bash-stderr></bash-stderr>',
      ),
    ]);

    expect(readTranscriptHead(head).firstMessage).toBe('!git status');
  });

  it('readTranscriptHead_ShellOutputOnly_NeverTitles', () => {
    const head = jsonl([
      userLine(
        'u1',
        '<bash-stdout>out</bash-stdout><bash-stderr></bash-stderr>',
      ),
      userLine('u2', 'the real ask'),
    ]);

    expect(readTranscriptHead(head).firstMessage).toBe('the real ask');
  });

  it('readTranscriptHead_NoUserLine_NullMessage', () => {
    const head = jsonl([
      { type: 'mode' },
      { type: 'system', subtype: 'turn_duration', cwd: '/w/app' },
    ]);

    expect(readTranscriptHead(head)).toEqual({
      cwd: '/w/app',
      firstMessage: null,
      sawUserLine: false,
    });
  });

  it('readTranscriptHead_UntypedUserLinesOnly_SawUserLineWithNullMessage', () => {
    const head = jsonl([
      userLine('u1', [
        { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
      ]),
      userLine('u2', '<task-notification>\n<task-id>t1</task-id>'),
      '{"type":"user","mess',
    ]);

    expect(readTranscriptHead(head)).toEqual({
      cwd: '/w/app',
      firstMessage: null,
      sawUserLine: true,
    });
  });
});

describe('endsInsideLine', () => {
  it.each([
    {
      name: 'a cut final line',
      text: jsonl([{ type: 'mode' }, '{"type":"user","mess']),
      expected: true,
    },
    {
      name: 'a final newline',
      text: `${jsonl([{ type: 'mode' }])}\n`,
      expected: false,
    },
    {
      name: 'a final line that parses',
      text: jsonl([{ type: 'mode' }, { type: 'system' }]),
      expected: false,
    },
  ])('$name → $expected', ({ text, expected }) => {
    expect(endsInsideLine(text)).toBe(expected);
  });
});

describe('transcriptName', () => {
  const AI_TITLE = { type: 'ai-title', aiTitle: 'Generated', sessionId: 's' };
  const CUSTOM_TITLE = {
    type: 'custom-title',
    customTitle: 'tournaments-wip',
    sessionId: 's',
  };

  it.each([
    { name: 'neither', lines: [{ type: 'mode' }], expected: null },
    { name: 'ai only', lines: [AI_TITLE], expected: 'Generated' },
    {
      name: 'custom beats a later ai',
      lines: [CUSTOM_TITLE, AI_TITLE],
      expected: 'tournaments-wip',
    },
    {
      name: 'last ai wins',
      lines: [AI_TITLE, { ...AI_TITLE, aiTitle: 'Newer' }],
      expected: 'Newer',
    },
    {
      name: 'last custom wins',
      lines: [CUSTOM_TITLE, { ...CUSTOM_TITLE, customTitle: 'renamed' }],
      expected: 'renamed',
    },
    {
      name: 'a user line quoting a title record is not one',
      lines: [
        {
          type: 'user',
          message: { content: '"type":"custom-title","customTitle":"quoted"' },
        },
      ],
      expected: null,
    },
    {
      name: 'an unparsable line is skipped',
      lines: ['{"type":"custom-title', AI_TITLE],
      expected: 'Generated',
    },
  ])('transcriptName_$name', ({ lines, expected }) => {
    expect(transcriptName(jsonl(lines))).toBe(expected);
  });
});

describe('sessionTitle', () => {
  it('sessionTitle_LongMessage_CutTo80WithEllipsis', () => {
    expect(sessionTitle('a'.repeat(100))).toBe(`${'a'.repeat(79)}…`);
    expect(sessionTitle('a'.repeat(80))).toBe('a'.repeat(80));
  });

  it('sessionTitle_SurrogatePairAtTheCut_KeptWholeAndCountedOnce', () => {
    const emoji = '😀';
    const long = `${'a'.repeat(78)}${emoji}${'b'.repeat(10)}`;
    const exact = `${'a'.repeat(79)}${emoji}`;

    expect(sessionTitle(long)).toBe(`${'a'.repeat(78)}${emoji}…`);
    expect(sessionTitle(exact)).toBe(exact);
  });
});

describe('transcriptEntries', () => {
  it('transcriptEntries_Conversation_BuildsEntriesInOrder', () => {
    const u1 = userLine('u1', 'hi');
    const a1 = assistantLine('a1', {
      type: 'thinking',
      thinking: '',
      signature: 'sig',
    });
    const a2 = assistantLine('a2', { type: 'text', text: 'hello' });
    const a3 = assistantLine('a3', {
      type: 'tool_use',
      id: 't1',
      name: 'Bash',
      input: { command: 'ls' },
    });
    const u2 = userLine('u2', [
      { type: 'tool_result', tool_use_id: 't1', content: 'out' },
    ]);
    const u3 = userLine('u3', [
      { type: 'tool_result', tool_use_id: 't9', content: 'x' },
    ]);
    const brandNew = { type: 'brand-new' };
    const sidechain = userLine('u4', 'subagent prompt', { isSidechain: true });
    const text = jsonl([
      u1,
      a1,
      a2,
      a3,
      u2,
      u3,
      'not json',
      { type: 'mode' },
      brandNew,
      sidechain,
    ]);

    expect(transcriptEntries(text)).toEqual([
      {
        kind: 'user',
        id: 'history:u1',
        at: 0,
        text: 'hi',
        images: [],
        delivery: null,
        raw: [u1],
      },
      {
        kind: 'assistant',
        id: 'history:a2-0',
        at: 0,
        agentId: MAIN_AGENT_ID,
        text: 'hello',
        streaming: false,
        raw: [a2],
      },
      {
        kind: 'tool',
        id: 'history:a3-0',
        at: 0,
        agentId: 'main',
        toolUseId: 't1',
        name: 'Bash',
        input: { command: 'ls' },
        summary: 'ls',
        result: { text: 'out', isError: false },
        raw: [a3, u2],
      },
      { kind: 'raw', id: 'history:u3-0', at: 0, raw: [u3] },
      { kind: 'raw', id: 'history:line-7', at: 0, raw: ['not json'] },
      { kind: 'raw', id: 'history:line-9', at: 0, raw: [brandNew] },
    ]);
  });

  it('transcriptEntries_LocalCommand_AddsNotice', () => {
    const s1 = {
      type: 'system',
      subtype: 'local_command',
      uuid: 's1',
      content: '<local-command-stdout>Set model to opus</local-command-stdout>',
    };

    expect(transcriptEntries(jsonl([s1]))).toEqual([
      {
        kind: 'notice',
        id: 'history:s1',
        at: 0,
        text: 'Set model to opus',
        tone: 'info',
        raw: [s1],
      },
    ]);
  });

  describe('compaction', () => {
    const boundary = (uuid: string, metadata: object, extra: object = {}) => ({
      type: 'system',
      subtype: 'compact_boundary',
      uuid,
      timestamp: '2026-11-04T00:54:57.884Z',
      content: 'Conversation compacted',
      parentUuid: null,
      logicalParentUuid: 'parent',
      isSidechain: false,
      compactMetadata: metadata,
      ...extra,
    });
    const SIZED = {
      trigger: 'manual',
      preTokens: 37559,
      postTokens: 9023,
      durationMs: 8303,
    };
    // Its context reads 38935 tokens.
    const reply = (
      uuid: string,
      extra: object = {},
      model = 'claude-opus-5-5',
    ) => ({
      type: 'assistant',
      uuid,
      isSidechain: false,
      message: {
        role: 'assistant',
        model,
        content: [],
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 909,
          cache_read_input_tokens: 38019,
          output_tokens: 5,
        },
      },
      ...extra,
    });
    const compactionEntries = (lines: object[]) =>
      transcriptEntries(jsonl(lines)).filter(
        (entry) => entry.kind === 'compaction',
      );
    const at = Date.parse('2026-11-04T00:54:57.884Z');

    it.each<{ name: string; lines: object[]; expected: object[] }>([
      {
        name: 'manual, a reply after',
        lines: [boundary('b1', SIZED), reply('a1')],
        expected: [
          {
            kind: 'compaction',
            id: 'history:b1',
            at,
            trigger: 'manual',
            beforeTokens: 37559,
            afterTokens: 38935,
            durationMs: 8303,
            raw: [boundary('b1', SIZED)],
          },
        ],
      },
      {
        name: 'auto',
        lines: [boundary('b1', { ...SIZED, trigger: 'auto' })],
        expected: [
          expect.objectContaining({ trigger: 'harness', afterTokens: null }),
        ],
      },
      {
        name: 'a sidechain and a synthetic reply first',
        lines: [
          boundary('b1', SIZED),
          {
            ...reply('a1', { isSidechain: true }),
            message: { usage: { input_tokens: 1 } },
          },
          {
            ...reply('a2', {}, SYNTHETIC_MODEL),
            message: { model: SYNTHETIC_MODEL, usage: { input_tokens: 2 } },
          },
          reply('a3'),
        ],
        expected: [expect.objectContaining({ afterTokens: 38935 })],
      },
      {
        name: 'a second boundary first',
        lines: [boundary('b1', SIZED), boundary('b2', SIZED), reply('a1')],
        expected: [
          expect.objectContaining({ id: 'history:b1', afterTokens: null }),
          expect.objectContaining({ id: 'history:b2', afterTokens: 38935 }),
        ],
      },
      {
        name: 'no metadata sizes',
        lines: [boundary('b1', { trigger: 'manual' })],
        expected: [
          expect.objectContaining({ beforeTokens: null, durationMs: null }),
        ],
      },
      {
        name: 'a sidechain boundary',
        lines: [boundary('b1', SIZED, { isSidechain: true })],
        expected: [],
      },
    ])(
      'transcriptEntries_CompactBoundary_CompactionEntry ($name)',
      ({ lines, expected }) => {
        expect(compactionEntries(lines)).toEqual(expected);
      },
    );

    it('transcriptEntries_CompactedUserLine_ReadsAsNothing', () => {
      const lines = [
        boundary('b1', SIZED),
        userLine(
          'u1',
          '<local-command-stdout>Compacted </local-command-stdout>',
        ),
      ];

      expect(
        transcriptEntries(jsonl(lines)).map((entry) => entry.kind),
      ).toEqual(['compaction']);
    });
  });

  it('transcriptEntries_LocalCommandWithoutUuid_TakesLineId', () => {
    const s1 = {
      type: 'system',
      subtype: 'local_command',
      content: '<local-command-stdout>Set model to opus</local-command-stdout>',
    };

    expect(transcriptEntries(jsonl([{ type: 'mode' }, s1]))).toEqual([
      {
        kind: 'notice',
        id: 'history:line-2',
        at: 0,
        text: 'Set model to opus',
        tone: 'info',
        raw: [s1],
      },
    ]);
  });

  it.each([
    {
      name: 'a compact summary',
      content: 'This session is being continued…',
      extra: { isCompactSummary: true, isVisibleInTranscriptOnly: true },
    },
    {
      name: 'a line visible in the transcript only',
      content: [{ type: 'text', text: 'shown only' }],
      extra: { isVisibleInTranscriptOnly: true },
    },
    {
      name: 'a task notification',
      content:
        '<task-notification>\n<task-id>t1</task-id>\n<status>completed</status>',
      extra: {},
    },
    {
      name: 'an interrupt marker',
      content: [{ type: 'text', text: '[Request interrupted by user]' }],
      extra: {},
    },
    {
      name: 'a tool-use interrupt marker',
      content: [
        { type: 'text', text: '[Request interrupted by user for tool use]' },
      ],
      extra: {},
    },
  ])('transcriptEntries: $name becomes a raw entry', ({ content, extra }) => {
    const u1 = userLine('u1', content, extra);

    expect(transcriptEntries(jsonl([u1]))).toEqual([
      { kind: 'raw', id: 'history:u1', at: 0, raw: [u1] },
    ]);
  });

  it('transcriptEntries_ShellCommand_BangUserEntryThenRawOutput', () => {
    const u1 = userLine('u1', '<bash-input>ls</bash-input>');
    const u2 = userLine(
      'u2',
      '<bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr>',
    );

    expect(transcriptEntries(jsonl([u1, u2]))).toEqual([
      {
        kind: 'user',
        id: 'history:u1',
        at: 0,
        text: '!ls',
        images: [],
        delivery: null,
        raw: [u1],
      },
      { kind: 'raw', id: 'history:u2', at: 0, raw: [u2] },
    ]);
  });

  it('transcriptEntries_TypedTextNamingShellTags_UserEntryAsTyped', () => {
    const typed = 'why does <bash-input>ls</bash-input> show up?';
    const u1 = userLine('u1', typed);

    expect(transcriptEntries(jsonl([u1]))).toEqual([
      {
        kind: 'user',
        id: 'history:u1',
        at: 0,
        text: typed,
        images: [],
        delivery: null,
        raw: [u1],
      },
    ]);
  });

  it('transcriptEntries_TypedTextNamingTheMarker_UserEntry', () => {
    const u1 = userLine('u1', [
      { type: 'text', text: 'why did I see [Request interrupted by user]?' },
    ]);

    expect(transcriptEntries(jsonl([u1]))).toEqual([
      {
        kind: 'user',
        id: 'history:u1',
        at: 0,
        text: 'why did I see [Request interrupted by user]?',
        images: [],
        delivery: null,
        raw: [u1],
      },
    ]);
  });

  it('transcriptEntries_UserImageLine_EntryCarriesImages', () => {
    const u1 = userLine('u1', [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' },
      },
      { type: 'text', text: 'What colour is this?' },
    ]);
    const u2 = userLine('u2', [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' },
      },
    ]);

    expect(transcriptEntries(jsonl([u1, u2]))).toEqual([
      {
        kind: 'user',
        id: 'history:u1',
        at: 0,
        text: 'What colour is this?',
        images: [{ mediaType: 'image/png', data: 'iVBORw0K' }],
        delivery: null,
        raw: [u1],
      },
      {
        kind: 'user',
        id: 'history:u2',
        at: 0,
        text: '',
        images: [{ mediaType: 'image/jpeg', data: '/9j/4AAQ' }],
        delivery: null,
        raw: [u2],
      },
    ]);
  });

  it('transcriptEntries_ImageCompanionLine_NoUserEntry', () => {
    const u1 = userLine(
      'u1',
      [
        {
          type: 'text',
          text: '[Image: source: /config/projects/-w-app/s/images/1.png]',
        },
      ],
      { isMeta: true, turnCompanion: true },
    );

    expect(transcriptEntries(jsonl([u1]))).toEqual([]);
  });

  it.each([
    {
      name: 'OwnTimestamp',
      lines: [assistantLine('a1', { type: 'text', text: 'hi' }, AT_ONE_TEXT)],
      expected: [['history:a1-0', AT_ONE]],
    },
    {
      name: 'NoTimestampTakesTheLastTimestamp',
      lines: [
        assistantLine('a1', { type: 'text', text: 'hi' }, AT_ONE_TEXT),
        userLine('u1', 'next'),
        userLine('u2', 'then', { timestamp: 'not a time' }),
      ],
      expected: [
        ['history:a1-0', AT_ONE],
        ['history:u1', AT_ONE],
        ['history:u2', AT_ONE],
      ],
    },
    {
      name: 'FirstLineWithNoneTakesZero',
      lines: [
        userLine('u1', 'first'),
        userLine('u2', 'second', { timestamp: AT_TWO_TEXT }),
      ],
      expected: [
        ['history:u1', 0],
        ['history:u2', AT_TWO],
      ],
    },
    {
      name: 'ToolResultKeepsToolUseTime',
      lines: [
        assistantLine(
          'a1',
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'ls' },
          },
          AT_ONE_TEXT,
        ),
        userLine(
          'u1',
          [{ type: 'tool_result', tool_use_id: 't1', content: 'out' }],
          { timestamp: AT_TWO_TEXT },
        ),
        userLine('u2', 'after', { timestamp: AT_TWO_TEXT }),
      ],
      expected: [
        ['history:a1-0', AT_ONE],
        ['history:u2', AT_TWO],
      ],
    },
    {
      name: 'NoTimestampTakesAPairedResultLineTime',
      lines: [
        assistantLine(
          'a1',
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'ls' },
          },
          AT_ONE_TEXT,
        ),
        userLine(
          'u1',
          [{ type: 'tool_result', tool_use_id: 't1', content: 'out' }],
          { timestamp: AT_TWO_TEXT },
        ),
        userLine('u2', 'after'),
      ],
      expected: [
        ['history:a1-0', AT_ONE],
        ['history:u2', AT_TWO],
      ],
    },
    {
      name: 'NoTimestampTakesASkippedLineTime',
      lines: [
        userLine('u1', 'first', { timestamp: AT_ONE_TEXT }),
        { type: 'last-prompt', timestamp: AT_TWO_TEXT },
        userLine('u2', 'after'),
      ],
      expected: [
        ['history:u1', AT_ONE],
        ['history:u2', AT_TWO],
      ],
    },
    {
      name: 'NoTimestampTakesASidechainLineTime',
      lines: [
        userLine('u1', 'first', { timestamp: AT_ONE_TEXT }),
        userLine('s1', 'subagent', {
          isSidechain: true,
          timestamp: AT_TWO_TEXT,
        }),
        userLine('u2', 'after'),
      ],
      expected: [
        ['history:u1', AT_ONE],
        ['history:u2', AT_TWO],
      ],
    },
    {
      name: 'NotJsonTakesTheLastTimestamp',
      lines: [
        userLine('u1', 'first', { timestamp: AT_ONE_TEXT }),
        { type: 'last-prompt', timestamp: AT_TWO_TEXT },
        'not json',
      ],
      expected: [
        ['history:u1', AT_ONE],
        ['history:line-3', AT_TWO],
      ],
    },
  ])('transcriptEntries_At_$name', ({ lines, expected }) => {
    const entries = transcriptEntries(jsonl(lines));

    expect(entries.map((entry) => [entry.id, entry.at])).toEqual(expected);
  });
});

// An `assistant` reply line from `model` whose context is `inputTokens` plus
// 7 output tokens.
function replyLine(
  uuid: string,
  inputTokens: number,
  extra: object = {},
  model = 'claude-opus-5-5',
) {
  return {
    type: 'assistant',
    uuid,
    isSidechain: false,
    message: {
      model,
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: inputTokens, output_tokens: 7 },
    },
    ...extra,
  };
}

describe('transcriptEntries before', () => {
  const T0 = Date.parse('2026-01-01T00:00:00Z');
  const typed = (uuid: string, at?: number) =>
    userLine(
      uuid,
      uuid,
      at === undefined ? {} : { timestamp: new Date(at).toISOString() },
    );
  const threeLines = [
    typed('a', T0),
    typed('b', T0 + 1000),
    typed('c', T0 + 2000),
  ];
  const toolUse = assistantLine(
    'call',
    { type: 'tool_use', id: 't1', name: 'Read', input: {} },
    new Date(T0).toISOString(),
  );
  const toolResult = userLine(
    'answer',
    [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }],
    { timestamp: new Date(T0 + 2000).toISOString() },
  );
  const A = { id: 'history:a' };
  const B = { id: 'history:b' };

  it.each([
    {
      case: 'none',
      lines: threeLines,
      before: null,
      expected: [A, B, { id: 'history:c' }],
    },
    {
      case: 'between',
      lines: threeLines,
      before: T0 + 1500,
      expected: [A, B],
    },
    {
      case: 'at a line',
      lines: threeLines,
      before: T0 + 1000,
      expected: [A],
    },
    {
      case: 'no timestamp after a cut line',
      lines: [...threeLines, typed('d')],
      before: T0 + 1500,
      expected: [A, B],
    },
    {
      case: 'tool result after the cut',
      lines: [toolUse, toolResult],
      before: T0 + 1500,
      expected: [{ kind: 'tool', toolUseId: 't1', result: null }],
    },
    {
      case: 'unparseable line after a cut line',
      lines: [...threeLines, 'oops'],
      before: T0 + 1500,
      expected: [A, B],
    },
    {
      case: 'unparseable line before the cut',
      lines: [threeLines[0], 'oops', threeLines[1], threeLines[2]],
      before: T0 + 1500,
      expected: [A, { kind: 'raw', id: 'history:line-2', at: T0 }, B],
    },
  ])(
    'transcriptEntries_Before_KeepsLinesRecordedEarlier ($case)',
    ({ lines, before, expected }) => {
      expect(transcriptEntries(jsonl(lines), before)).toEqual(
        expected.map((entry) => expect.objectContaining(entry)),
      );
    },
  );
});

describe('mainReplies', () => {
  it.each([
    {
      name: 'SidechainAndSyntheticAfter_MainRepliesAlone',
      lines: [
        replyLine('a1', 1000, { timestamp: AT_ONE_TEXT }),
        replyLine('a2', 3000, { timestamp: AT_TWO_TEXT }),
        replyLine('a3', 9000, {
          isSidechain: true,
          timestamp: '2026-10-27T16:08:00.000Z',
        }),
        replyLine('a4', 0, {}, SYNTHETIC_MODEL),
      ],
      expected: [
        [1007, AT_ONE],
        [3007, AT_TWO],
      ],
    },
    {
      name: 'NoMainReply_Empty',
      lines: [
        userLine('u1', 'hi', { timestamp: AT_ONE_TEXT }),
        replyLine('a1', 0, {}, SYNTHETIC_MODEL),
        assistantLine('a2', { type: 'text', text: 'no usage' }, AT_TWO_TEXT),
      ],
      expected: [],
    },
    {
      name: 'MalformedLineBetween_Skipped',
      lines: [
        replyLine('a1', 1000, { timestamp: AT_ONE_TEXT }),
        '{"type":"assistant",',
        replyLine('a2', 3000, { timestamp: AT_TWO_TEXT }),
      ],
      expected: [
        [1007, AT_ONE],
        [3007, AT_TWO],
      ],
    },
    {
      name: 'NoTimestamp_TakesTheLastLineSeen',
      lines: [
        replyLine('a1', 1000, { timestamp: AT_ONE_TEXT }),
        userLine('u1', 'sub', { isSidechain: true, timestamp: AT_TWO_TEXT }),
        replyLine('a2', 3000),
      ],
      expected: [
        [1007, AT_ONE],
        [3007, AT_TWO],
      ],
    },
    {
      name: 'MainBoundary_KeepsOnlyTheRepliesAfterIt',
      lines: [
        replyLine('a1', 1000, { timestamp: AT_ONE_TEXT }),
        { type: 'system', subtype: 'compact_boundary', isSidechain: false },
        replyLine('a2', 3000, { timestamp: AT_TWO_TEXT }),
      ],
      expected: [[3007, AT_TWO]],
    },
    {
      name: 'MainBoundaryLast_Empty',
      lines: [
        replyLine('a1', 1000, { timestamp: AT_ONE_TEXT }),
        { type: 'system', subtype: 'compact_boundary', isSidechain: false },
      ],
      expected: [],
    },
    {
      name: 'SidechainBoundary_KeepsTheReplies',
      lines: [
        replyLine('a1', 1000, { timestamp: AT_ONE_TEXT }),
        { type: 'system', subtype: 'compact_boundary', isSidechain: true },
      ],
      expected: [[1007, AT_ONE]],
    },
  ])('mainReplies_$name', ({ lines, expected }) => {
    const replies = mainReplies(jsonl(lines));

    expect(replies.map(({ reply, at }) => [reply.contextTokens, at])).toEqual(
      expected,
    );
  });
});
