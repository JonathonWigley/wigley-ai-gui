// The preview's built-in sample: open_primer arguments holding every need,
// both agent groups and every task card section in markdown, a task name long
// enough to wrap, and a task of six items, one long enough to wrap. Extra
// tasks and added items come only from the user, who adds them in the preview.
export const PREVIEW_PRIMER_ARGS: {
  feature: Record<string, string>;
  entries: Record<string, unknown>[];
} = {
  feature: {
    name: 'Layout preview',
    slug: 'layout-preview',
    spec: 'A sample primer for iterating the primer layout; nothing you edit here reaches an agent.',
    summary:
      'Every need, both agent groups and every card section, so each part of the layout shows. Sending or cancelling it closes the preview.',
  },
  entries: [
    {
      id: '1',
      number: 1,
      area: 'Data',
      task: 'Quest data model',
      need: 'yes',
      question: 'Does the feature need a **new data model** for its quests?',
      evidence:
        '- `QuestDefinition` holds no progress today\n- the save file has no quest section',
      probes:
        '1. Where is progress saved?\n2. Does a reset run at midnight, local time?',
      pointer:
        'See [the quest spec](https://example.com/quests) and `src/quests/definition.ts`.',
      items: [
        'Add QuestDefinition with its goal and reward',
        'Persist progress per quest in the profile',
        'Reset daily quests at midnight, local time, and keep the weekly ones until the end of their week even when the player was away for several days',
        'Migrate nothing: old saves start with empty progress',
        'Expose the active quests to the board',
        'Log each reward granted',
      ],
    },
    {
      id: '2',
      number: 2,
      area: 'Config',
      task: 'Remote config for quest rewards, read at start and again whenever the server pushes a change mid-session',
      need: 'unclear',
      question: 'Should rewards come from remote config?',
      evidence: 'The shop already reads its prices from `RemoteConfig`.',
      items: ['Read the reward table', 'Fall back to built-in rewards'],
    },
    {
      id: '3',
      number: 3,
      area: 'Audio',
      task: 'Quest sounds',
      need: 'no',
      items: ['Add a completion sound'],
    },
    {
      id: 'tests',
      group: 'standing',
      task: 'Tests',
      need: 'yes',
      probes: 'Which rules need a test: `reset`, `reward`, or both?',
      items: ['Unit tests for the reset rule', 'Unit tests for rewards'],
    },
  ],
};
