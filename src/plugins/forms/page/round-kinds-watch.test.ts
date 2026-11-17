import { describe, expect, it } from 'vitest';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { createFormsState } from './form-state';
import { BUILT_IN_PAGE_KINDS } from './kinds/formats';
import { createPageKinds } from './kinds/page-kinds';
import { poll, pollPageKind } from './kinds/plugin-page-kind.test-support';
import { watchRoundKinds } from './round-kinds-watch';
import { presentedRound, question } from './test-rounds';

// A store over the built-in kinds and whatever `kinds` registers later,
// re-derived on each change as start does, watched into `lines`.
function watched() {
  const kinds = createPageKinds();
  for (const kind of BUILT_IN_PAGE_KINDS) {
    kinds.register(kind);
  }
  const forms = createFormsState(() => kinds.table());
  const store = createReducerStore(
    forms.initialState([], 'r1-session'),
    forms.apply,
  );
  kinds.onChanged(() =>
    store.dispatch({ type: 'kindsChanged', kinds: kinds.table() }),
  );
  const lines: string[] = [];
  watchRoundKinds(
    store,
    (line) => lines.push(line),
    (text, tone) => lines.push(`toast ${tone}: ${text}`),
  );
  const show = (bodyKeys: Record<string, string> = {}) =>
    store.dispatch({
      type: 'formShown',
      form: presentedRound('r1', {
        questions: [question('One')],
        items: { poll: [poll('P1')], vote: [poll('V1'), poll('V2')] },
        bodyKeys: { poll: 'poll_answers', vote: 'vote_answers', ...bodyKeys },
      }),
    });
  return { kinds, lines, show };
}

describe('watchRoundKinds', () => {
  it('logs each kind with no page kind once at first show, with no toast', () => {
    const { lines, show } = watched();

    show();
    show();

    expect(lines).toEqual([
      'round r1 holds 1 poll items with no page kind',
      'round r1 holds 2 vote items with no page kind',
    ]);
  });

  it('toasts once per round and kind when a registered kind leaves', () => {
    const { kinds, lines, show } = watched();
    show();
    lines.length = 0;

    const pollKind = kinds.register(pollPageKind('poll'));
    const voteKind = kinds.register(pollPageKind('vote'));
    pollKind.dispose();
    voteKind.dispose();
    kinds.register(pollPageKind('poll')).dispose();

    expect(lines).toEqual([
      'toast info: 1 poll item in project · r1 waits for the plugin that draws it',
      'toast info: 2 vote items in project · r1 wait for the plugin that draws them',
    ]);
  });

  it("logs a registered kind whose body key differs from main's", () => {
    const { kinds, lines, show } = watched();
    kinds.register(pollPageKind('poll'));
    kinds.register(pollPageKind('vote'));

    show({ poll: 'polls_v2' });

    expect(lines).toEqual([
      "page kind poll body key poll_answers differs from main's polls_v2",
    ]);
  });
});
