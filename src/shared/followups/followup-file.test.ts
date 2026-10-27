import { describe, expect, it } from 'vitest';
import {
  applyFollowupEdit,
  followupTitleProblem,
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

describe('parseFollowups Contents list', () => {
  const LOOSE = lines(
    '**Contents**',
    '',
    'One line per follow-up.',
    '',
    '- **One** — *art*: first',
    '',
    '- **Two** — second',
    '',
    '## One',
    '',
    'Body one.',
    '',
    '## Two',
    '',
    'Body two.',
  );

  it('reads every list item before the first ## heading, past blanks and prose', () => {
    expect(
      parseFollowups(LOOSE).items.map((item) => [
        item.title,
        item.tags,
        item.oneLine,
      ]),
    ).toEqual([
      ['One', ['art'], 'first'],
      ['Two', [], 'second'],
    ]);
  });

  it('reads a wrapped Contents line as one line', () => {
    const text = lines(
      '**Contents**',
      '',
      '- **One** — starts here',
      '  and wraps on.',
      '',
      '## One',
      '',
      'Body.',
    );

    expect(itemNamed(text, 'One').oneLine).toBe('starts here and wraps on.');
  });

  it('adds a Contents line to a loose list after a blank line', () => {
    const draft = { title: 'Three', oneLine: 'third', tags: [], body: '' };

    expect(appliedText(LOOSE, { type: 'create', draft })).toBe(
      LOOSE.replace(
        '- **Two** — second\n',
        '- **Two** — second\n\n- **Three** — third\n',
      ) + '\n## Three\n\nthird\n',
    );
  });

  it('deletes a loose Contents line with one of its blank lines', () => {
    expect(appliedText(LOOSE, { type: 'delete', title: 'One' })).toBe(
      lines(
        '**Contents**',
        '',
        'One line per follow-up.',
        '',
        '- **Two** — second',
        '',
        '## Two',
        '',
        'Body two.',
      ),
    );
  });

  it('deletes the only Contents line of a new file without a double blank', () => {
    const draft = { title: 'Only', oneLine: '', tags: [], body: '' };
    const created = appliedText(newFollowupsFile('game'), {
      type: 'create',
      draft,
    });

    expect(appliedText(created, { type: 'delete', title: 'Only' })).toBe(
      newFollowupsFile('game'),
    );
  });
});

describe('CRLF files', () => {
  it('reads a sectioned file', () => {
    const text = SECTIONED.replaceAll('\n', '\r\n');

    expect(itemNamed(text, 'Fruit Blast coins')).toMatchObject({
      tags: ['needs a feature plan'],
      oneLine: 'replace the sink',
      body: 'Coins sink too fast.\n\n### What\n\nReplace the sink.',
    });
  });

  it('reads a list file', () => {
    const text = lines('- **One** — *art*: a', '- Two. b').replaceAll(
      '\n',
      '\r\n',
    );

    expect(
      parseFollowups(text).items.map((item) => [item.title, item.tags]),
    ).toEqual([
      ['One', ['art']],
      ['Two', []],
    ]);
  });

  it('writes an edit back in CRLF, the Contents line not duplicated', () => {
    const text = SECTIONED.replaceAll('\n', '\r\n');

    const tagged = appliedText(text, {
      type: 'setTags',
      title: 'Reward popup',
      tags: ['art'],
    });

    expect(tagged).toBe(
      SECTIONED.replace(
        '- **`Reward` popup** — fix the overlap',
        '- **`Reward` popup** — *art*: fix the overlap',
      ).replaceAll('\n', '\r\n'),
    );
  });

  it('writes a list item create back in CRLF', () => {
    const draft = { title: 'Two', oneLine: 'b', tags: [], body: '' };

    expect(appliedText('- **One** — a\r\n', { type: 'create', draft })).toBe(
      '- **One** — a\r\n- **Two** — b\r\n',
    );
  });

  it('writes an LF file with one stray CRLF line back in LF', () => {
    const draft = { title: 'Three', oneLine: 'c', tags: [], body: '' };
    const text = '- **One** — a\r\n- **Two** — b\n\nTail.\n';

    expect(appliedText(text, { type: 'create', draft })).toBe(
      '- **One** — a\n- **Two** — b\n- **Three** — c\n\nTail.\n',
    );
  });

  it('writes a CRLF file with one stray LF line back in CRLF', () => {
    const draft = { title: 'Three', oneLine: 'c', tags: [], body: '' };
    const text = '- **One** — a\n- **Two** — b\r\n\r\nTail.\r\n';

    expect(appliedText(text, { type: 'create', draft })).toBe(
      '- **One** — a\r\n- **Two** — b\r\n- **Three** — c\r\n\r\nTail.\r\n',
    );
  });

  it('writes a file with one CRLF line and one LF line back in LF', () => {
    const draft = { title: 'Three', oneLine: 'c', tags: [], body: '' };
    const text = '- **One** — a\r\n- **Two** — b\n';

    expect(appliedText(text, { type: 'create', draft })).toBe(
      '- **One** — a\n- **Two** — b\n- **Three** — c\n',
    );
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

  it('reads a tag span after a first-sentence title', () => {
    const item = parseFollowups(lines('- Fix it. *agent-ready*: gist'))
      .items[0];

    expect([item.title, item.tags, item.oneLine]).toEqual([
      'Fix it',
      ['agent-ready'],
      'gist',
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

describe('parseFollowups on a list file with a fence at column 0', () => {
  it('ends the open item at the fence', () => {
    const text = lines('- **Real** — gist', '```', 'code', '```');

    expect(parseFollowups(text).items[0]).toMatchObject({
      body: '',
      endLine: 1,
    });
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

describe('applyFollowupEdit on a wrapped Contents line', () => {
  const WRAPPED = lines(
    '**Contents**',
    '',
    '- **One** — starts here',
    '  and wraps on.',
    '',
    '## One',
    '',
    'Body.',
  );

  it('keeps the wrapped text through an edit', () => {
    const draft = itemNamed(WRAPPED, 'One');

    expect(
      appliedText(WRAPPED, {
        type: 'edit',
        title: 'One',
        draft: {
          title: draft.title,
          oneLine: draft.oneLine,
          tags: ['art'],
          body: draft.body,
        },
      }),
    ).toContain('- **One** — *art*: starts here and wraps on.\n\n## One');
  });

  it('keeps the wrapped text through a tag change, without a stray line', () => {
    expect(
      appliedText(WRAPPED, { type: 'setTags', title: 'One', tags: ['art'] }),
    ).toBe(
      lines(
        '**Contents**',
        '',
        '- **One** — *art*: starts here and wraps on.',
        '',
        '## One',
        '',
        'Body.',
      ),
    );
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

  it('keeps a grouped list list-shaped after its last item goes, so a create adds a list item', () => {
    const text = lines(
      '# Follow-ups',
      '',
      '## Design issues',
      '',
      '- **One** — a',
    );
    const emptied = appliedText(text, { type: 'delete', title: 'One' });
    const draft = { title: 'Two', oneLine: 'b', tags: [], body: '' };

    expect(parseFollowups(emptied)).toEqual({ shape: 'list', items: [] });
    expect(appliedText(emptied, { type: 'create', draft })).toBe(
      lines('# Follow-ups', '', '## Design issues', '', '- **Two** — b'),
    );
  });

  it('removes a list item between blank lines with one of them', () => {
    const text = lines(
      '- **One** — a',
      '',
      '- **Two** — b',
      '',
      '- **Three** — c',
    );

    expect(appliedText(text, { type: 'delete', title: 'Two' })).toBe(
      lines('- **One** — a', '', '- **Three** — c'),
    );
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

// The same texts as docs-index's tests/test_markdown.py in wigley-ai-marketplace,
// so the two readers agree on them.
describe('parseFollowups on texts the index reader shares', () => {
  const WRAPPED_TITLE = lines(
    '1. **The read-only trait as an optional interface is a runtime type test, and `ITool` freezes once',
    '   plugins compile against it** — *agent-ready*: callers find it by a type test.',
    '   Fix: a required member.',
    '2. **Next** — b',
  );
  const WRAPPED_TITLE_TEXT =
    'The read-only trait as an optional interface is a runtime type test, and `ITool` freezes once plugins compile against it';

  it('reads a bold title wrapped onto its continuation whole, the body after it', () => {
    const items = parseFollowups(WRAPPED_TITLE).items;

    expect(items.map((item) => [item.title, item.tags, item.oneLine])).toEqual([
      [WRAPPED_TITLE_TEXT, ['agent-ready'], 'callers find it by a type test.'],
      ['Next', [], 'b'],
    ]);
    expect(items[0]).toMatchObject({
      body: ' Fix: a required member.',
      line: 1,
      endLine: 3,
    });
  });

  it('keeps the first-sentence title of an unclosed bold with no close below', () => {
    const text = lines('- **Open bold. Rest', '  no close here');

    expect(parseFollowups(text).items.map((item) => item.title)).toEqual([
      '**Open bold',
    ]);
  });

  it('sections ## headings with no list item', () => {
    const text = lines(
      '# Follow-ups',
      '',
      '## One',
      '',
      'Body one.',
      '',
      '## Two',
      '',
      'Body two.',
    );
    const file = parseFollowups(text);

    expect(file.shape).toBe('sections');
    expect(file.items.map((item) => item.title)).toEqual(['One', 'Two']);
  });

  it('keeps a grouped list file list-shaped', () => {
    const text = lines(
      '## Group',
      '',
      '- **A** — a',
      '',
      '## Other',
      '',
      '- **B** — b',
    );
    const file = parseFollowups(text);

    expect(file.shape).toBe('list');
    expect(file.items.map((item) => item.title)).toEqual(['A', 'B']);
  });

  it('keeps ## headings with empty bodies list-shaped, with no items', () => {
    const text = lines(
      '# Follow-ups',
      '',
      'Intro.',
      '',
      '## Group',
      '',
      '## Other',
    );
    const file = parseFollowups(text);

    expect(file.shape).toBe('list');
    expect(file.items).toEqual([]);
  });

  it('reads tags and a title from a wrapped Contents line', () => {
    const text = lines(
      '**Contents**',
      '',
      '- **One** —',
      '  *agent-ready*: starts here',
      '  and wraps on.',
      '- **A long',
      '  title** — *art*: wraps',
      '',
      '## One',
      '',
      'Body.',
      '',
      '## A long title',
      '',
      'Body two.',
    );

    expect(
      parseFollowups(text).items.map((item) => [
        item.title,
        item.tags,
        item.oneLine,
      ]),
    ).toEqual([
      ['One', ['agent-ready'], 'starts here and wraps on.'],
      ['A long title', ['art'], 'wraps'],
    ]);
  });

  it('reads a dash with nothing after it as an empty one line', () => {
    const text = '- **Fresh** — \n- **Next** — b\n';

    expect(
      parseFollowups(text).items.map((item) => [
        item.title,
        item.oneLine,
        item.tags,
      ]),
    ).toEqual([
      ['Fresh', '', []],
      ['Next', 'b', []],
    ]);
  });

  it('writes a wrapped title on one line through setTags and edit', () => {
    const tagged = appliedText(WRAPPED_TITLE, {
      type: 'setTags',
      title: WRAPPED_TITLE_TEXT,
      tags: ['art'],
    });
    const edited = appliedText(WRAPPED_TITLE, {
      type: 'edit',
      title: WRAPPED_TITLE_TEXT,
      draft: {
        title: WRAPPED_TITLE_TEXT,
        oneLine: 'new',
        tags: [],
        body: 'Fix.',
      },
    });

    expect(tagged).toBe(
      lines(
        `1. **${WRAPPED_TITLE_TEXT}** — *art*: callers find it by a type test.`,
        '   Fix: a required member.',
        '2. **Next** — b',
      ),
    );
    expect(itemNamed(tagged, WRAPPED_TITLE_TEXT).tags).toEqual(['art']);
    expect(edited).toBe(
      lines(`1. **${WRAPPED_TITLE_TEXT}** — new`, '  Fix.', '2. **Next** — b'),
    );
  });
});

describe('applyFollowupEdit create with openOneLine', () => {
  const draft = { title: 'Fresh', oneLine: '', tags: [], body: '' };

  it('writes the list item with its dash, the line on it', () => {
    expect(
      applyFollowupEdit(lines('- **A** — a'), {
        type: 'create',
        draft,
        openOneLine: true,
      }),
    ).toEqual({
      type: 'applied',
      text: lines('- **A** — a', '- **Fresh** — '),
      line: 2,
    });
  });

  it('writes the Contents line with its dash, the line on it', () => {
    const result = applyFollowupEdit(SECTIONED, {
      type: 'create',
      draft,
      openOneLine: true,
    });

    expect(result).toEqual({
      type: 'applied',
      text:
        SECTIONED.replace(
          '- **`Reward` popup** — fix the overlap\n',
          '- **`Reward` popup** — fix the overlap\n- **Fresh** — \n',
        ).trimEnd() + '\n\n## Fresh\n',
      line: 7,
    });
    expect(itemNamed((result as { text: string }).text, 'Fresh').oneLine).toBe(
      '',
    );
  });
});

describe('followupTitleProblem', () => {
  it('names each title that would not read back', () => {
    expect(
      [' ', 'a\nb', 'a\rb', ' a', 'a ', '~~a~~ b', 'a **b** c', 'a*', 'a:'].map(
        followupTitleProblem,
      ),
    ).toEqual([
      'A follow-up title is required',
      'A follow-up title is one line',
      'A follow-up title is one line',
      'A follow-up title does not start or end with a space',
      'A follow-up title does not start or end with a space',
      'A follow-up title does not start with ~~',
      'A follow-up title holds no ** and does not end with *',
      'A follow-up title holds no ** and does not end with *',
      'A follow-up title does not end with :',
    ]);
  });

  it('passes a title that reads back in both shapes', () => {
    const title = '`Reward` popup: *the* bar ~~x~~ — 2.0.';
    const draft = { title, oneLine: 'o', tags: [], body: '' };

    expect(followupTitleProblem(title)).toBe(null);
    expect(
      itemNamed(appliedText(SECTIONED, { type: 'create', draft }), title).title,
    ).toBe(title);
    expect(
      itemNamed(
        appliedText(lines('- **A** — a'), { type: 'create', draft }),
        title,
      ).title,
    ).toBe(title);
  });
});
