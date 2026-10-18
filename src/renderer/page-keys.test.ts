import { describe, expect, it } from 'vitest';
import type { PageBind, ViewScope } from '../contracts/keymap';
import { createSequenceMatcher } from './key-sequences';
import { feedPageKey } from './page-keys';

const TIMEOUT_MS = 1000;

const binds: PageBind[] = [
  { keys: ['g', 'u', 'x'], scope: 'forms', command: 'test.long' },
  { keys: ['u'], scope: 'forms', command: 'test.openReview' },
  { keys: ['a'], scope: 'forms', command: 'test.editBox' },
  { keys: ['j'], scope: 'forms', command: 'test.down' },
  { keys: ['j'], scope: 'review', command: 'test.reviewDown' },
];

// A page whose commands change its scope or focus an editor, as the forms
// view's do, recording each command it runs and the keys typed into its editor.
function fakePage() {
  const page = {
    scope: 'forms' as ViewScope,
    isEditorFocused: false,
    ran: [] as string[],
    typed: [] as string[],
  };
  const target = {
    scope: () => page.scope,
    editorHasFocus: () => page.isEditorFocused,
    run: (bind: PageBind) => {
      page.ran.push(bind.command);
      if (bind.command === 'test.openReview') {
        page.scope = 'review';
      }
      if (bind.command === 'test.editBox') {
        page.isEditorFocused = true;
      }
    },
    typeIntoEditor: (keys: string[]) => {
      page.typed.push(...keys);
    },
  };
  return { page, target };
}

describe('feedPageKey', () => {
  it('feeds the keys after a broken sequence in the scope its bind left', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, 'g', 0, target);
    feedPageKey(matcher, 'u', 100, target);
    expect(feedPageKey(matcher, 'j', 200, target)).toBe(true);
    expect(page.ran).toEqual(['test.openReview', 'test.reviewDown']);
    expect(page.typed).toEqual([]);
  });

  it('types the keys after a bind that focused an editor into the editor', () => {
    const editBinds: PageBind[] = [
      { keys: ['g', 'a', 'x', 'y'], scope: 'forms', command: 'test.long' },
      ...binds.slice(2),
    ];
    const matcher = createSequenceMatcher(editBinds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, 'g', 0, target);
    feedPageKey(matcher, 'a', 100, target);
    feedPageKey(matcher, 'x', 200, target);
    expect(feedPageKey(matcher, 'j', 300, target)).toBe(true);
    expect(page.ran).toEqual(['test.editBox']);
    expect(page.typed).toEqual(['x', 'j']);
  });

  it('leaves a key with no bind unconsumed', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    const { page, target } = fakePage();
    expect(feedPageKey(matcher, 'q', 0, target)).toBe(false);
    expect(page.ran).toEqual([]);
  });
});
