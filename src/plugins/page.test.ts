import { describe, expect, it } from 'vitest';
import { startPlugins } from '../shared/plugin-host';
import { pageParts } from './page';

describe('pageParts', () => {
  it('pageParts_DependencyOrder_KeysStartsFirst', () => {
    const started: string[] = [];

    startPlugins(pageParts, 'page', ({ manifest }) => {
      started.push(manifest.id);
      return {};
    });

    expect(started[0]).toBe('keys');
  });
});
