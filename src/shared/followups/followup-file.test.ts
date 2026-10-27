import { describe, expect, it } from 'vitest';
import {
  applyFollowupEdit,
  newFollowupsFile,
  parseFollowups,
  type FollowupDraft,
  type FollowupEdit,
  type FollowupItem,
} from './followup-file';

function lines(...text: string[]): string {
  return text.join('\n') + '\n';
}

const SECTIONED = lines(
  '# Follow-ups — game',
  '',
  '**Contents**',
  '',
  '- **Fruit Blast coins** — *needs a feature plan*: replace the sink',
  '- **`Reward` popup** — fix the overlap',
  '',
  '## Fruit Blast coins',
  '',
  'Coins sink too fast.',
  '',
  '### What',
  '',
  'Replace the sink.',
  '',
  '## Reward popup',
  '',
  'The popup overlaps the bar.',
  '',
);

function appliedText(text: string, edit: FollowupEdit): string {
  const result = applyFollowupEdit(text, edit);
  if (result.type !== 'applied') {
    throw new Error(`expected applied, got ${result.type}`);
  }
  return result.text;
}

function itemNamed(text: string, title: string): FollowupItem {
  const item = parseFollowups(text).items.find((each) => each.title === title);
  if (item === undefined) {
    throw new Error(`no item ${title}`);
  }
  return item;
}

function expectDraftFields(item: FollowupItem, draft: FollowupDraft): void {
  expect({
    title: item.title,
    oneLine: item.oneLine,
    tags: item.tags,
    body: item.body,
  }).toEqual(draft);
}

describe('parseFollowups on a sectioned file', () => {
  it('reads one item per ## heading, ### subsections in its body', () => {
    const file = parseFollowups(SECTIONED);

    expect(file.shape).toBe('sections');
    expect(file.items.map((item) => item.title)).toEqual([
      'Fruit Blast coins',
      'Reward popup',
    ]);
    expect(file.items[0]).toEqual({
      title: 'Fruit Blast coins',
      oneLine: 'replace the sink',
      tags: ['needs a feature plan'],
      body: 'Coins sink too fast.\n\n### What\n\nReplace the sink.',
      line: 8,
      endLine: 14,
      done: false,
    });
  });

  it('matches a Contents line to its heading with backticks ignored', () => {
    const item = itemNamed(SECTIONED, 'Reward popup');

    expect(item.oneLine).toBe('fix the overlap');
    expect(item.line).toBe(16);
    expect(item.endLine).toBe(18);
  });

  it('leaves oneLine and tags empty for a heading with no Contents line', () => {
    const text = lines('**Contents**', '', '## Lonely', '', 'Body.');

    expect(itemNamed(text, 'Lonely')).toMatchObject({ oneLine: '', tags: [] });
  });

  it('is sectioned by a ### heading alone', () => {
    const text = lines('## One', '', '### What', '', 'Body.');

    expect(parseFollowups(text).shape).toBe('sections');
    expect(parseFollowups(text).items.map((item) => item.title)).toEqual([
      'One',
    ]);
  });

  it('marks done by a struck heading or a first body line starting shipped', () => {
    const text = lines(
      '**Contents**',
      '',
      '## ~~Struck~~',
      '',
      'Body.',
      '',
      '## Landed',
      '',
      '### Status',
      'Shipped in 1.2.',
      '',
      '## Open',
      '',
      'Not shipped yet.',
    );
    const done = parseFollowups(text).items.map((item) => [
      item.title,
      item.done,
    ]);

    expect(done).toEqual([
      ['Struck', true],
      ['Landed', true],
      ['Open', false],
    ]);
  });

  it('ignores headings and the Contents line inside fenced code', () => {
    const text = lines(
      '**Contents**',
      '',
      '## Real',
      '',
      '```markdown',
      '## Not a heading',
      '```',
    );
    const items = parseFollowups(text).items;

    expect(items.map((item) => item.title)).toEqual(['Real']);
    expect(items[0].body).toBe('```markdown\n## Not a heading\n```');
  });

  it('reads a fenced ### or Contents line as no reason to section', () => {
    const text = lines(
      '- **One** — gist',
      '',
      '```',
      '### fenced',
      '**Contents**',
      '```',
    );

    expect(parseFollowups(text).shape).toBe('list');
  });
});

describe('parseFollowups on a list file', () => {
  it('reads bold-lead tags and oneLine', () => {
    const text = lines(
      '- **Fruit Blast coins** — *needs a feature plan*: replace the sink',
    );

    expect(parseFollowups(text).items[0]).toMatchObject({
      title: 'Fruit Blast coins',
      tags: ['needs a feature plan'],
      oneLine: 'replace the sink',
    });
  });

  it('reads an underscore span and several tags', () => {
    const text = lines('- **Coins** — _agent-ready, art_: gist');

    expect(parseFollowups(text).items[0]).toMatchObject({
      tags: ['agent-ready', 'art'],
      oneLine: 'gist',
    });
  });

  it('reads the colon form', () => {
    const text = lines('- **Title**: the gist');

    expect(parseFollowups(text).items[0]).toMatchObject({
      title: 'Title',
      oneLine: 'the gist',
      tags: [],
    });
  });

  it('titles a line with no bold lead by its first sentence, trailing period dropped', () => {
    const text = lines('- Command palette. Opens on Cmd+P.', '- Vim marks.');
    const items = parseFollowups(text).items;

    expect(items.map((item) => [item.title, item.oneLine])).toEqual([
      ['Command palette', 'Opens on Cmd+P.'],
      ['Vim marks', ''],
    ]);
  });

  it('takes continuation lines as the body, never the title', () => {
    const text = lines(
      '- Command palette',
      '  lists every command.',
      '',
      '  Second paragraph.',
      '',
      '- **Next** — gist',
    );
    const items = parseFollowups(text).items;

    expect(items[0]).toMatchObject({
      title: 'Command palette',
      oneLine: '',
      body: 'lists every command.\n\nSecond paragraph.',
      line: 1,
      endLine: 4,
    });
    expect(items[1].line).toBe(6);
  });

  it('reads numbered items', () => {
    const text = lines('1. **First** — a', '2. **Second** — b');

    expect(parseFollowups(text).items.map((item) => item.title)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('marks done by a strike or a oneLine starting shipped', () => {
    const text = lines(
      '- ~~**Struck** — gone~~',
      '- **Landed** — *agent-ready*: Shipped in 1.2',
      '- **Open** — not shipped',
    );
    const done = parseFollowups(text).items.map((item) => [
      item.title,
      item.done,
    ]);

    expect(done).toEqual([
      ['Struck', true],
      ['Landed', true],
      ['Open', false],
    ]);
  });

  it('ignores list items inside fenced code', () => {
    const text = lines(
      '- **Real** — gist',
      '',
      '```',
      '- **Fake** — gist',
      '```',
    );

    expect(parseFollowups(text).items.map((item) => item.title)).toEqual([
      'Real',
    ]);
  });
});

describe('applyFollowupEdit create', () => {
  it('adds a Contents line after the list and a section at the end', () => {
    const draft = {
      title: 'Hint button',
      oneLine: 'add a hint',
      tags: ['agent-ready'],
      body: 'Players get stuck.',
    };
    const result = applyFollowupEdit(SECTIONED, { type: 'create', draft });

    expect(result).toEqual({
      type: 'applied',
      text: SECTIONED.replace(
        '- **`Reward` popup** — fix the overlap\n',
        '- **`Reward` popup** — fix the overlap\n- **Hint button** — *agent-ready*: add a hint\n',
      ).replace(
        'The popup overlaps the bar.\n\n',
        'The popup overlaps the bar.\n\n## Hint button\n\nPlayers get stuck.\n',
      ),
      line: 21,
    });
    expectDraftFields(
      itemNamed((result as { text: string }).text, 'Hint button'),
      draft,
    );
  });

  it('writes oneLine as the section body when the body is empty', () => {
    const draft = { title: 'Short', oneLine: 'just this', tags: [], body: '' };
    const text = appliedText(SECTIONED, { type: 'create', draft });

    expect(text.endsWith('## Short\n\njust this\n')).toBe(true);
    expect(text).toContain('- **Short** — just this\n');
  });

  it('puts the first entry of a new file between Contents and the paragraph', () => {
    const draft = { title: 'First', oneLine: 'gist', tags: [], body: 'Body.' };
    const result = applyFollowupEdit(newFollowupsFile('game'), {
      type: 'create',
      draft,
    });

    expect(result).toEqual({
      type: 'applied',
      text: lines(
        '# Follow-ups — game',
        '',
        '**Contents**',
        '',
        '- **First** — gist',
        '',
        'Deferred work for the game repo. Each entry is one `##` section and stands on its own as a task brief.',
        '',
        '## First',
        '',
        'Body.',
      ),
      line: 9,
    });
    expectDraftFields(
      itemNamed((result as { text: string }).text, 'First'),
      draft,
    );
  });

  it('appends a list item at the end of the last list run', () => {
    const text = lines(
      '# Ideas',
      '',
      '- **One** — a',
      '  more',
      '',
      'Closing note.',
    );
    const draft = {
      title: 'Two',
      oneLine: 'b',
      tags: ['x'],
      body: 'Line one.\n\nLine two.',
    };
    const result = applyFollowupEdit(text, { type: 'create', draft });

    expect(result).toEqual({
      type: 'applied',
      text: lines(
        '# Ideas',
        '',
        '- **One** — a',
        '  more',
        '- **Two** — *x*: b',
        '  Line one.',
        '',
        '  Line two.',
        '',
        'Closing note.',
      ),
      line: 5,
    });
    expectDraftFields(
      itemNamed((result as { text: string }).text, 'Two'),
      draft,
    );
  });

  it('numbers a new item in a numbered run', () => {
    const text = lines('1. **One** — a', '2. **Two** — b');
    const draft = { title: 'Three', oneLine: 'c', tags: [], body: '' };

    expect(appliedText(text, { type: 'create', draft })).toBe(
      lines('1. **One** — a', '2. **Two** — b', '3. **Three** — c'),
    );
  });

  it('refuses a title another item has', () => {
    const draft = { title: 'Reward popup', oneLine: '', tags: [], body: '' };

    expect(applyFollowupEdit(SECTIONED, { type: 'create', draft })).toEqual({
      type: 'titleTaken',
      title: 'Reward popup',
    });
  });
});

describe('applyFollowupEdit edit', () => {
  it('renames the heading and Contents line together and replaces the body', () => {
    const draft = {
      title: 'Coin sink',
      oneLine: 'slow the sink',
      tags: ['agent-ready'],
      body: 'New body.',
    };
    const result = applyFollowupEdit(SECTIONED, {
      type: 'edit',
      title: 'Fruit Blast coins',
      draft,
    });

    expect(result).toEqual({
      type: 'applied',
      text: lines(
        '# Follow-ups — game',
        '',
        '**Contents**',
        '',
        '- **Coin sink** — *agent-ready*: slow the sink',
        '- **`Reward` popup** — fix the overlap',
        '',
        '## Coin sink',
        '',
        'New body.',
        '',
        '## Reward popup',
        '',
        'The popup overlaps the bar.',
        '',
      ),
      line: 8,
    });
    expectDraftFields(
      itemNamed((result as { text: string }).text, 'Coin sink'),
      draft,
    );
  });

  it('rewrites a first-sentence list item in the bold-lead form, other lines untouched', () => {
    const text = lines(
      '- Command palette. Opens on Cmd+P.',
      '  body',
      '- **Other**: kept as is',
    );
    const draft = {
      title: 'Command palette',
      oneLine: 'opens',
      tags: [],
      body: 'new',
    };

    expect(
      appliedText(text, { type: 'edit', title: 'Command palette', draft }),
    ).toBe(
      lines(
        '- **Command palette** — opens',
        '  new',
        '- **Other**: kept as is',
      ),
    );
  });

  it('keeps a numbered marker', () => {
    const text = lines('1. **One** — a', '2. **Two** — b');
    const draft = { title: 'Two', oneLine: 'changed', tags: [], body: '' };

    expect(appliedText(text, { type: 'edit', title: 'Two', draft })).toBe(
      lines('1. **One** — a', '2. **Two** — changed'),
    );
  });

  it('refuses a rename onto another item title', () => {
    const draft = { title: 'Reward popup', oneLine: '', tags: [], body: '' };

    expect(
      applyFollowupEdit(SECTIONED, {
        type: 'edit',
        title: 'Fruit Blast coins',
        draft,
      }),
    ).toEqual({ type: 'titleTaken', title: 'Reward popup' });
  });

  it('reports a missing title', () => {
    const draft = { title: 'Gone', oneLine: '', tags: [], body: '' };

    expect(
      applyFollowupEdit(SECTIONED, { type: 'edit', title: 'Gone', draft }),
    ).toEqual({
      type: 'missing',
      title: 'Gone',
    });
  });
});

describe('applyFollowupEdit setTags', () => {
  it('adds a tag by changing only the Contents line', () => {
    const result = applyFollowupEdit(SECTIONED, {
      type: 'setTags',
      title: 'Reward popup',
      tags: ['agent-ready'],
    });

    expect(result).toEqual({
      type: 'applied',
      text: SECTIONED.replace(
        '- **`Reward` popup** — fix the overlap',
        '- **`Reward` popup** — *agent-ready*: fix the overlap',
      ),
      line: 16,
    });
    expect(
      itemNamed((result as { text: string }).text, 'Reward popup').tags,
    ).toEqual(['agent-ready']);
  });

  it('changes and clears tags', () => {
    const changed = appliedText(SECTIONED, {
      type: 'setTags',
      title: 'Fruit Blast coins',
      tags: ['agent-ready', 'art'],
    });
    const cleared = appliedText(changed, {
      type: 'setTags',
      title: 'Fruit Blast coins',
      tags: [],
    });

    expect(changed).toContain(
      '- **Fruit Blast coins** — *agent-ready, art*: replace the sink\n',
    );
    expect(cleared).toContain('- **Fruit Blast coins** — replace the sink\n');
    expect(itemNamed(cleared, 'Fruit Blast coins').tags).toEqual([]);
  });

  it('keeps a list item marker and its continuation', () => {
    const text = lines('1. **One** — a', '   more', '2. Two. b');

    expect(
      appliedText(text, {
        type: 'setTags',
        title: 'Two',
        tags: ['agent-ready'],
      }),
    ).toBe(lines('1. **One** — a', '   more', '2. **Two** — *agent-ready*: b'));
    expect(
      appliedText(text, { type: 'setTags', title: 'One', tags: ['x'] }),
    ).toBe(lines('1. **One** — *x*: a', '   more', '2. Two. b'));
  });

  it('rewrites a colon-form line in the dash form', () => {
    const text = lines('- **Title**: gist');

    expect(
      appliedText(text, { type: 'setTags', title: 'Title', tags: ['t'] }),
    ).toBe(lines('- **Title** — *t*: gist'));
  });

  it('reports a missing title', () => {
    expect(
      applyFollowupEdit(SECTIONED, {
        type: 'setTags',
        title: 'Gone',
        tags: [],
      }),
    ).toEqual({
      type: 'missing',
      title: 'Gone',
    });
  });
});

describe('applyFollowupEdit delete', () => {
  it('removes a section and its Contents line, the neighbours byte-identical', () => {
    const result = applyFollowupEdit(SECTIONED, {
      type: 'delete',
      title: 'Fruit Blast coins',
    });

    expect(result).toEqual({
      type: 'applied',
      text: lines(
        '# Follow-ups — game',
        '',
        '**Contents**',
        '',
        '- **`Reward` popup** — fix the overlap',
        '',
        '## Reward popup',
        '',
        'The popup overlaps the bar.',
        '',
      ),
      line: 7,
    });
  });

  it('removes the last section without leaving a trailing blank line', () => {
    expect(
      appliedText(SECTIONED, { type: 'delete', title: 'Reward popup' }),
    ).toBe(
      lines(
        '# Follow-ups — game',
        '',
        '**Contents**',
        '',
        '- **Fruit Blast coins** — *needs a feature plan*: replace the sink',
        '',
        '## Fruit Blast coins',
        '',
        'Coins sink too fast.',
        '',
        '### What',
        '',
        'Replace the sink.',
      ),
    );
  });

  it('removes a list item with its continuation', () => {
    const text = lines('- **One** — a', '  more', '- **Two** — b');

    expect(applyFollowupEdit(text, { type: 'delete', title: 'One' })).toEqual({
      type: 'applied',
      text: lines('- **Two** — b'),
      line: 1,
    });
  });

  it('clamps the line to the file end', () => {
    const text = lines('- **One** — a', '- **Two** — b');

    expect(applyFollowupEdit(text, { type: 'delete', title: 'Two' })).toEqual({
      type: 'applied',
      text: lines('- **One** — a'),
      line: 1,
    });
  });

  it('reports a missing title', () => {
    expect(
      applyFollowupEdit(SECTIONED, { type: 'delete', title: 'Gone' }),
    ).toEqual({
      type: 'missing',
      title: 'Gone',
    });
  });
});

describe('applyFollowupEdit on a sections file with no Contents list', () => {
  it('builds the list from the headings on the first edit', () => {
    const text = lines(
      '# Follow-ups',
      '',
      '## Alpha',
      '',
      '### What',
      '',
      'Alpha does a thing. More detail',
      'on two lines.',
      '',
      '## Beta',
      '',
      'Beta body',
    );

    expect(
      applyFollowupEdit(text, {
        type: 'setTags',
        title: 'Beta',
        tags: ['agent-ready'],
      }),
    ).toEqual({
      type: 'applied',
      text: lines(
        '# Follow-ups',
        '',
        '**Contents**',
        '',
        '- **Alpha** — Alpha does a thing.',
        '- **Beta** — *agent-ready*: Beta body',
        '',
        '## Alpha',
        '',
        '### What',
        '',
        'Alpha does a thing. More detail',
        'on two lines.',
        '',
        '## Beta',
        '',
        'Beta body',
      ),
      line: 15,
    });
  });
});

describe('newFollowupsFile', () => {
  it('writes the canonical empty file', () => {
    expect(newFollowupsFile('game')).toBe(
      lines(
        '# Follow-ups — game',
        '',
        '**Contents**',
        '',
        'Deferred work for the game repo. Each entry is one `##` section and stands on its own as a task brief.',
      ),
    );
    expect(parseFollowups(newFollowupsFile('game'))).toEqual({
      shape: 'sections',
      items: [],
    });
  });
});
