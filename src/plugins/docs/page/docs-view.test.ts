import { describe, expect, it } from 'vitest';
import { callEach } from './docs-view';

describe('callEach', () => {
  it('callEach_TwoItemsThrow_CallsEveryItemAndThrowsTheFirstError', () => {
    const called: string[] = [];

    const call = () =>
      callEach(['tree', 'doc', 'dialogs'], (item) => {
        called.push(item);
        if (item !== 'dialogs') {
          throw new Error(`${item} broke`);
        }
      });

    expect(call).toThrow('tree broke');
    expect(called).toEqual(['tree', 'doc', 'dialogs']);
  });
});
