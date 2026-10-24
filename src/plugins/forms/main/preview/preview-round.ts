// The preview's built-in sample: ask_round arguments holding every card kind,
// with long and short titles, inline code and a choice long enough to wrap.
export const PREVIEW_ROUND_ARGS: Record<string, unknown> = {
  heading: 'Layout preview',
  overview:
    'A sample round that shows every card the layout draws; nothing you answer here reaches an agent.',
  notices: [
    {
      title: 'Kept the sidebar on the left',
      context:
        'Decided to keep the sidebar on the left, since every mode already puts its list there.',
      badge: 'Decided',
    },
  ],
  findings: [
    {
      title: 'A closed session can still receive a round',
      origin: 'caused',
      severity: 'critical',
      impact:
        'An agent whose row the user closed sends a round that never shows, so the agent waits until its deadline.',
      finding:
        'The router looks the session up by `sessionId` after the row is gone, and drops the round without a reply.',
      proof:
        '- `session-list.ts`: the closed row is removed before `mark` runs\n' +
        '- the self-test log shows `mark for session … with no row ignored`',
      choices: [
        {
          text: 'Bring the row back at the end of the list when a round arrives for it.',
          reason: 'The user sees the round where new sessions appear.',
        },
        {
          text: 'Refuse the round with an error naming the closed row, so the agent stops waiting at once and can tell the user why nothing showed.',
          reason: 'The agent learns of the problem without a deadline passing.',
        },
        {
          text: 'Keep the round queued until the user reopens the row.',
          reason: 'Nothing is lost, but nothing shows either.',
        },
      ],
      recommend: 1,
      recommend_action: 'fix_now',
    },
    {
      title: 'Where theme tokens live',
      origin: 'design',
      impact:
        'Every layout reads colours by token name, so moving them later breaks user layouts.',
      finding:
        'Decide whether layouts read tokens as CSS variables or from a JSON object.',
      proof:
        '- `layout.d.ts` exposes no token object today\n- the default layout uses `var(--…)` throughout',
      choices: [
        {
          text: 'CSS variables, as the default layout uses now.',
          reason: 'No new API; a theme change restyles every card at once.',
        },
        {
          text: 'A typed token object in the layout kit.',
          reason: 'Layouts that draw on canvas can read colours too.',
          action: 'follow_up',
        },
      ],
      recommend: 2,
      recommend_action: 'follow_up',
    },
    {
      title: 'Typo',
      origin: 'nit',
      impact: 'None.',
      finding: 'A comment says "recieve".',
      proof: '- comments are not shipped',
      choices: [{ text: 'Spell it "receive".', reason: 'It reads right.' }],
      recommend_action: 'leave_it',
    },
  ],
  questions: [
    {
      title: 'Card width',
      context: '- cards fill the main area today',
      question: 'How wide should a card be?',
      choices: ['Full width', '72 characters', '96 characters'],
      recommend: 2,
      rationale: 'Lines of about 72 characters read fastest.',
    },
    {
      title:
        'What the Form tab shows when a session has several rounds waiting and the user switches away and back mid-answer',
      context:
        '- each session keeps at most one open round\n' +
        '- a re-sent round is pre-filled from its saved answers\n' +
        '- the rail lists every item of the open round\n\n' +
        '```ts\n' +
        'interface FormsSession {\n' +
        '  askRound(args: unknown, toolUseId: string | null, signal: AbortSignal): Promise<AnswersPayload>;\n' +
        '}\n' +
        '```\n\n' +
        ':::details Full text\n' +
        'A round waiting behind the open one opens only once the open one finishes, so the Form tab never ' +
        'holds two rounds of one session. Switching sessions keeps every answer typed so far.\n' +
        ':::',
      question: 'Which round should the tab show on the way back?',
      choices: [
        'The round the user left, with every answer kept.',
        'The newest round, with the earlier one one key away.',
        'A list of the waiting rounds to pick from.',
        'The oldest round still waiting.',
        'Whichever round has the nearest deadline.',
        'The round the user left, scrolled back to the top so the overview shows again before the item the user was on.',
      ],
      recommend: 1,
      rationale: 'Nothing moves under the user, and nothing typed is lost.',
    },
  ],
};
