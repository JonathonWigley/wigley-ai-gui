// What a Claude Code session sets for its own children, which an app started
// from a Claude Code terminal inherits: the names claude-stream.md § Launch
// lists. Other `CLAUDE_CODE_*` names are the user's config.
export const NESTED_SESSION_ENV: readonly string[] = [
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AFK_TIMEOUT_MS',
  'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
];

// The row id `unity-pool` records as a claim's holder.
export const SESSION_ROW_ENV = 'WIGLEY_SESSION_ROW';

// Every name that marks a run as some session's: a parent Claude session's
// variables and the app's session row. A run without them acts as the user.
export const SESSION_IDENTITY_ENV: readonly string[] = [
  ...NESTED_SESSION_ENV,
  SESSION_ROW_ENV,
];
