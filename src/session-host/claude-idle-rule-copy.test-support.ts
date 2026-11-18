import type { IdleRule } from '../contracts/session-host';

// A copy of claude-launch.ts's CLAUDE_IDLE_RULE, which the layer rules keep this folder's tests from importing;
// scripts/claude-idle-rule-copies.test.mts holds the two together.
export const CLAUDE_IDLE_RULE_COPY: IdleRule = {
  key: 'type',
  value: 'result',
  busyStdoutValues: ['assistant', 'stream_event'],
  busyStdinValues: ['user'],
  sideKey: 'parent_tool_use_id',
  messageIdKey: 'uuid',
  messageEnd: {
    value: 'command_lifecycle',
    idKey: 'command_uuid',
    stateKey: 'state',
    endStates: ['completed', 'cancelled', 'discarded', 'refused'],
  },
  turnEndIdsKey: 'user_message_uuids',
  background: {
    match: { type: 'system', subtype: 'background_tasks_changed' },
    listKey: 'tasks',
    kindKey: 'task_type',
    kinds: ['local_agent'],
  },
};
