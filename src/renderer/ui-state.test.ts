import { describe, expect, it, vi } from 'vitest';
import type { UiState } from '../contracts/ui-state';
import { uiStateOver } from '../shared/fake-ui-state.test-support';
import { createPageUiState } from './ui-state';

function pageUiState(snapshot: Record<string, unknown>) {
  const writes: [string, unknown][] = [];
  const uiState = createPageUiState(snapshot, (key, value) =>
    writes.push([key, value]),
  );
  return { uiState, writes };
}

describe('createPageUiState', () => {
  it('scopes keys by prefix', () => {
    const { uiState } = pageUiState({ 'forms.rail': 240 });

    expect(uiState.scoped('forms').get('rail')).toBe(240);
    expect(uiState.scoped('chat').get('rail')).toBeUndefined();
  });

  it('set updates the page copy at once and sends the qualified key', () => {
    const { uiState, writes } = pageUiState({ 'forms.rail': 240 });
    const forms = uiState.scoped('forms');

    forms.set('rail', 300);

    expect(forms.get('rail')).toBe(300);
    expect(writes).toEqual([['forms.rail', 300]]);
  });

  it('set undefined deletes the key', () => {
    const { uiState, writes } = pageUiState({ 'forms.rail': 240 });
    const forms = uiState.scoped('forms');

    forms.set('rail', undefined);

    expect(forms.get('rail')).toBeUndefined();
    expect(writes).toEqual([['forms.rail', undefined]]);
  });

  it('get returns a copy, so mutating it leaves the page copy unchanged', () => {
    const { uiState, writes } = pageUiState({ 'forms.split': { rail: 240 } });
    const forms = uiState.scoped('forms');

    (forms.get('split') as { rail: number }).rail = 999;

    expect(forms.get('split')).toEqual({ rail: 240 });
    expect(writes).toEqual([]);
  });

  it('set stores a copy, so mutating the value afterwards leaves the page copy unchanged', () => {
    const { uiState } = pageUiState({});
    const forms = uiState.scoped('forms');
    const split = { rail: 240 };

    forms.set('split', split);
    split.rail = 999;

    expect(forms.get('split')).toEqual({ rail: 240 });
  });
});

describe('createPageUiState on', () => {
  type PageUiState = ReturnType<typeof createPageUiState>;
  it.each([
    {
      case: 'same scope',
      setFrom: (_: PageUiState, forms: UiState) => forms.set('rail', 300),
      calls: 1,
    },
    {
      case: 'another scope object of the prefix',
      setFrom: (page: PageUiState) => page.scoped('forms').set('rail', 300),
      calls: 1,
    },
    {
      case: 'another key',
      setFrom: (_: PageUiState, forms: UiState) => forms.set('other', 300),
      calls: 0,
    },
    {
      case: 'another prefix',
      setFrom: (page: PageUiState) => page.scoped('chat').set('rail', 300),
      calls: 0,
    },
    {
      case: 'after dispose',
      setFrom: (_: PageUiState, forms: UiState) => forms.set('rail', 300),
      calls: 0,
      isDisposed: true,
    },
  ])(
    'on hears a set of its own key only: $case',
    ({ setFrom, calls, isDisposed }) => {
      const { uiState } = pageUiState({});
      const forms = uiState.scoped('forms');
      const listener = vi.fn();
      const subscription = forms.on('rail', listener);
      if (isDisposed === true) {
        subscription.dispose();
      }

      setFrom(uiState, forms);

      expect(listener).toHaveBeenCalledTimes(calls);
    },
  );
});

describe('UiState stores', () => {
  const stores = [
    {
      store: 'page store',
      create: (): UiState => pageUiState({}).uiState.scoped('forms'),
    },
    { store: 'uiStateOver', create: (): UiState => uiStateOver(new Map()) },
  ];
  const cases = [
    {
      case: 'a set reads back',
      run: (state: UiState) => {
        state.set('rail', 300);
        return { value: state.get('rail'), calls: 0 };
      },
      expected: { value: 300, calls: 0 },
    },
    {
      case: 'a set of undefined deletes the key',
      run: (state: UiState) => {
        state.set('rail', 300);
        state.set('rail', undefined);
        return { value: state.get('rail'), calls: 0 };
      },
      expected: { value: undefined, calls: 0 },
    },
    {
      case: "a set calls the key's listener once",
      run: (state: UiState) => {
        const listener = vi.fn();
        state.on('rail', listener);
        state.set('rail', 300);
        return { value: state.get('rail'), calls: listener.mock.calls.length };
      },
      expected: { value: 300, calls: 1 },
    },
    {
      case: 'a disposed listener is not called',
      run: (state: UiState) => {
        const listener = vi.fn();
        state.on('rail', listener).dispose();
        state.set('rail', 300);
        return { value: state.get('rail'), calls: listener.mock.calls.length };
      },
      expected: { value: 300, calls: 0 },
    },
  ];
  it.each(
    stores.flatMap((store) => cases.map((row) => ({ ...store, ...row }))),
  )('$store: $case', ({ create, run, expected }) => {
    expect(run(create())).toEqual(expected);
  });
});
