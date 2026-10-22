import { describe, expect, it } from 'vitest';
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
