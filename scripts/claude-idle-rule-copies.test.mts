// The layer rules keep the `claude-code` plugin and `src/session-host` from
// importing each other, so the process table's tests run Claude's idle rule
// from a copy; this test holds the two copies together.
import { describe, expect, it } from 'vitest';
import { CLAUDE_IDLE_RULE } from '../src/plugins/claude-code/main/claude-launch.ts';
import { CLAUDE_IDLE_RULE_COPY } from '../src/session-host/claude-idle-rule-copy.test-support.ts';

describe('the Claude idle rule copies', () => {
  it('hold one rule', () => {
    expect(CLAUDE_IDLE_RULE_COPY).toStrictEqual(CLAUDE_IDLE_RULE);
  });
});
