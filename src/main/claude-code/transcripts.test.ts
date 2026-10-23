import { describe, expect, it } from 'vitest';
import {
  endsInsideLine,
  projectFolderName,
  readTranscriptHead,
  sessionTitle,
  transcriptEntries,
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

function assistantLine(uuid: string, block: object) {
  return {
    type: 'assistant',
    uuid,
    cwd: '/w/app',
    sessionId: 's',
    isSidechain: false,
    message: { role: 'assistant', content: [block] },
  };
}

describe('projectFolderName', () => {
  it('projectFolderName_ReplacesEveryNonAlphanumeric', () => {
    expect(projectFolderName('/Users/jonathonwigley/.claude')).toBe(
      '-Users-jonathonwigley--claude',
    );
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
  it('endsInsideLine_CutFinalLine_True', () => {
    expect(
      endsInsideLine(jsonl([{ type: 'mode' }, '{"type":"user","mess'])),
    ).toBe(true);
  });

  it('endsInsideLine_EndsInNewline_False', () => {
    expect(endsInsideLine(`${jsonl([{ type: 'mode' }])}\n`)).toBe(false);
  });

  it('endsInsideLine_FinalLineParses_False', () => {
    expect(endsInsideLine(jsonl([{ type: 'mode' }, { type: 'system' }]))).toBe(
      false,
    );
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

  it('sessionTitle_Null_Untitled', () => {
    expect(sessionTitle(null)).toBe('Untitled session');
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
      { kind: 'user', id: 'history:u1', text: 'hi', images: [], raw: [u1] },
      {
        kind: 'assistant',
        id: 'history:a2-0',
        text: 'hello',
        streaming: false,
        raw: [a2],
      },
      {
        kind: 'tool',
        id: 'history:a3-0',
        toolUseId: 't1',
        name: 'Bash',
        input: { command: 'ls' },
        summary: 'ls',
        result: { text: 'out', isError: false },
        raw: [a3, u2],
      },
      { kind: 'raw', id: 'history:u3-0', raw: [u3] },
      { kind: 'raw', id: 'history:line-7', raw: ['not json'] },
      { kind: 'raw', id: 'history:line-9', raw: [brandNew] },
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
        text: 'Set model to opus',
        tone: 'info',
        raw: [s1],
      },
    ]);
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
        text: 'Set model to opus',
        tone: 'info',
        raw: [s1],
      },
    ]);
  });

  it('transcriptEntries_CompactSummary_RawEntry', () => {
    const u1 = userLine('u1', 'This session is being continued…', {
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    });

    expect(transcriptEntries(jsonl([u1]))).toEqual([
      { kind: 'raw', id: 'history:u1', raw: [u1] },
    ]);
  });

  it('transcriptEntries_VisibleInTranscriptOnly_RawEntry', () => {
    const u1 = userLine('u1', [{ type: 'text', text: 'shown only' }], {
      isVisibleInTranscriptOnly: true,
    });

    expect(transcriptEntries(jsonl([u1]))).toEqual([
      { kind: 'raw', id: 'history:u1', raw: [u1] },
    ]);
  });

  it('transcriptEntries_TaskNotification_RawEntry', () => {
    const u1 = userLine(
      'u1',
      '<task-notification>\n<task-id>t1</task-id>\n<status>completed</status>',
    );

    expect(transcriptEntries(jsonl([u1]))).toEqual([
      { kind: 'raw', id: 'history:u1', raw: [u1] },
    ]);
  });

  it('transcriptEntries_InterruptMarkers_RawEntries', () => {
    const u1 = userLine('u1', [
      { type: 'text', text: '[Request interrupted by user]' },
    ]);
    const u2 = userLine('u2', [
      { type: 'text', text: '[Request interrupted by user for tool use]' },
    ]);

    expect(transcriptEntries(jsonl([u1, u2]))).toEqual([
      { kind: 'raw', id: 'history:u1', raw: [u1] },
      { kind: 'raw', id: 'history:u2', raw: [u2] },
    ]);
  });

  it('transcriptEntries_ShellCommand_BangUserEntryThenRawOutput', () => {
    const u1 = userLine('u1', '<bash-input>ls</bash-input>');
    const u2 = userLine(
      'u2',
      '<bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr>',
    );

    expect(transcriptEntries(jsonl([u1, u2]))).toEqual([
      { kind: 'user', id: 'history:u1', text: '!ls', images: [], raw: [u1] },
      { kind: 'raw', id: 'history:u2', raw: [u2] },
    ]);
  });

  it('transcriptEntries_TypedTextNamingShellTags_UserEntryAsTyped', () => {
    const typed = 'why does <bash-input>ls</bash-input> show up?';
    const u1 = userLine('u1', typed);

    expect(transcriptEntries(jsonl([u1]))).toEqual([
      { kind: 'user', id: 'history:u1', text: typed, images: [], raw: [u1] },
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
        text: 'why did I see [Request interrupted by user]?',
        images: [],
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
        text: 'What colour is this?',
        images: [{ mediaType: 'image/png', data: 'iVBORw0K' }],
        raw: [u1],
      },
      {
        kind: 'user',
        id: 'history:u2',
        text: '',
        images: [{ mediaType: 'image/jpeg', data: '/9j/4AAQ' }],
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
});
