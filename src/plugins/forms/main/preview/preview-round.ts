// The preview's built-in sample: ask_round arguments holding every card kind,
// three notices (one per badge), long and short titles, inline code and a
// choice long enough to wrap. Its Defect groups a deferral choice under
// Follow-up, and its Decision and Nit each carry the reason for the deferral
// action they recommend.
export const PREVIEW_ROUND_ARGS: Record<string, unknown> = {
  heading: 'Layout preview',
  overview:
    'A sample round that shows every card the layout draws; nothing you answer here reaches an agent.',
  notices: [
    {
      title: 'Rail entries show their full title on hover',
      context:
        ':::tree\nRail\n  + each entry shows its full title on hover\n:::',
      badge: 'Applied',
    },
    {
      title: 'Long choices wrap under their number',
      context:
        ':::changes\n~ a long choice wraps under its number instead of running off the card\n:::',
      badge: 'Dispatched',
    },
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
          action: 'follow_up',
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
      action_reasons: {
        follow_up:
          'No layout draws on canvas yet, so a plan can weigh the token object when one does.',
      },
    },
    {
      title: 'Typo',
      origin: 'nit',
      impact: 'None.',
      finding: 'A comment says "recieve".',
      proof: '- comments are not shipped',
      choices: [{ text: 'Spell it "receive".', reason: 'It reads right.' }],
      recommend_action: 'leave_it',
      action_reasons: {
        leave_it: 'Comments are not shipped, so nobody reads the typo.',
      },
    },
  ],
  questions: [
    {
      title: 'Card width',
      summary:
        'Pick how wide a card draws. Every card in the form popup takes this width, so it sets how long each line of context runs.',
      context:
        'Cards fill the main area today. On a wide window a line of context runs past a hundred characters, and the eye loses its place at the start of the next line.\n\n' +
        'A cap keeps each line short. The rail and the space around the card stay as they are.\n\n' +
        ':::details Sources\n' +
        '- the forms view: a card takes the full width of the main area\n' +
        ':::',
      choices: ['Full width', '72 characters', '96 characters'],
      recommend: 2,
      rationale: 'Lines of about 72 characters read fastest.',
    },
    {
      title:
        'What the form popup shows when a session has several rounds waiting and the user switches away and back mid-answer',
      summary:
        'Choose which round the form popup shows when the user comes back to a session that has several rounds waiting.',
      context:
        'Each session keeps at most one open round. A round waiting behind it opens only once the open one finishes, so ' +
        'the form popup never holds two rounds of one session. The user can still switch to another session halfway ' +
        'through an answer and come back.\n\n' +
        'Switching sessions keeps every answer typed so far, and a re-sent round is pre-filled from its saved answers. So ' +
        'nothing is lost either way; the choice is only which round greets the user on the way back.\n\n' +
        ':::details Sources\n' +
        '- the rail lists every item of the open round\n' +
        '- `FormsSession.open`:\n\n' +
        '```ts\n' +
        'interface FormsSession {\n' +
        '  open(args: unknown, toolUseId: string | null, signal: AbortSignal): Promise<AnswersPayload>;\n' +
        '}\n' +
        '```\n' +
        ':::',
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
