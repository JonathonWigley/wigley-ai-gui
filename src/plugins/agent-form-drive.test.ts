import { describe, expect, it } from 'vitest';
import { fakeDriveHost } from '../shared/fake-drive-host';
import { addDriveActions as addFormsDriveActions } from './forms/main/start';
import { addDriveActions as addPrimerDriveActions } from './primer/main/start';
import type { SessionsState, ToolResult } from './sessions/contract';
import { createSessionList } from './sessions/main/session-list';
import { addDriveActions as addSessionsDriveActions } from './sessions/main/start';

// The real session list, with `ask_round` and `open_primer` contributed as
// tools whose calls never answer; each call is kept by row id and tool name.
function sessionList() {
  const calls: [string, string][] = [];
  const endedListeners: ((rowId: string) => void)[] = [];
  let state: SessionsState = { rows: [], selectedSessionId: null };
  let ids = 0;
  const list = createSessionList({
    randomHex: () => `row-${++ids}`,
    clock: { now: () => 0 },
    log: () => undefined,
    emit: (event, data) => {
      if (event === 'ended') {
        for (const listener of endedListeners) {
          listener((data as { sessionId: string }).sessionId);
        }
      }
    },
    stateChanged: (next) => {
      state = next;
    },
    activated: () => undefined,
    projectName: async () => null,
  });
  for (const name of ['ask_round', 'open_primer']) {
    list.contributeTools(
      [{ name, description: name, inputSchema: {} }],
      (session) => ({
        call: (tool) => {
          calls.push([session.id, tool]);
          return new Promise<ToolResult>(() => {});
        },
        end: () => undefined,
      }),
    );
  }
  return {
    list,
    calls,
    rows: () => state.rows,
    onEnded: (listener: (rowId: string) => void) => {
      endedListeners.push(listener);
    },
  };
}

describe('agent form drive actions across plugins', () => {
  it('a round and a primer opened under one sessions.open id land on its one row', async () => {
    const sessions = sessionList();
    const sessionsDrive = fakeDriveHost();
    const formsDrive = fakeDriveHost();
    const primerDrive = fakeDriveHost();
    addSessionsDriveActions(
      sessionsDrive.host,
      sessions.list,
      sessions.onEnded,
    );
    addFormsDriveActions(formsDrive.host, sessions.list, sessions.onEnded);
    addPrimerDriveActions(primerDrive.host, sessions.list, sessions.onEnded);

    const { rowId } = (await sessionsDrive.run('open', {
      sessionId: 's',
    })) as { rowId: string };
    const round = await formsDrive.run('openRound', { sessionId: 's' });
    const primer = await primerDrive.run('openPrimer', { sessionId: 's' });

    expect(round).toEqual({ sessionId: 's', rowId });
    expect(primer).toEqual({ sessionId: 's', rowId });
    expect(sessions.rows().map((row) => row.sessionId)).toEqual([rowId]);
    expect(sessions.calls).toEqual([
      [rowId, 'ask_round'],
      [rowId, 'open_primer'],
    ]);
  });
});
