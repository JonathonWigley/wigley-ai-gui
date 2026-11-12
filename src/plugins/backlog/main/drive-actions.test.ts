import { describe, expect, it } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { errorResult } from '../../sessions/contract';
import { startBacklogTools } from './backlog-tools';
import { addDriveActions } from './drive-actions';

const ASSISTANT_ROW = 'row-1';

// Backlog's drive actions over real tools whose `scopeOf` knows only
// ASSISTANT_ROW; `assistantSession` is what the assistant's `sessionOf` gives.
function driveOver(assistantSession: string | null) {
  const drive = fakeDriveHost();
  const tools = startBacklogTools({
    scopeOf: async (session) =>
      session.id === ASSISTANT_ROW ? 'global' : null,
    rows: async () => [],
    loadRows: async () => [],
    staleness: () => ({}),
    chunks: { chunks: async () => [], replaceUnstarted: async () => [] },
    place: () => null,
  });
  addDriveActions(drive.host, {
    assistantSession: async () => assistantSession,
    tools,
  });
  return drive;
}

describe('backlog drive actions', () => {
  it('callTool_Assistant_RunsAsTheAssistant', async () => {
    const drive = driveOver(ASSISTANT_ROW);

    const result = await drive.run('callTool', {
      session: 'assistant',
      tool: 'read_backlog_state',
    });

    expect(result).toMatchObject({
      content: [
        {
          type: 'text',
          text: expect.stringContaining(
            'The Backlog page has not been opened.',
          ),
        },
      ],
    });
  });

  it('callTool_OtherRow_GetsTheRefusal', async () => {
    const drive = driveOver(ASSISTANT_ROW);

    const result = await drive.run('callTool', {
      session: 'row-2',
      tool: 'set_backlog_chunks',
      args: { repo: 'r', chunks: [] },
    });

    expect(result).toEqual(
      errorResult(
        'set_backlog_chunks answers only the Backlog assistant session.',
      ),
    );
  });

  it('callTool_AssistantNotLaunched_Rejects', async () => {
    const drive = driveOver(null);

    await expect(
      drive.run('callTool', {
        session: 'assistant',
        tool: 'read_backlog_state',
      }),
    ).rejects.toThrow('The assistant has no session yet');
  });
});
