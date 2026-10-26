import { describe, expect, it } from 'vitest';
import { saveLabel } from './autosave';

describe('saveLabel', () => {
  it('shows the failed save message while unsaved', () => {
    expect(saveLabel('unsaved', 'disk full')).toBe('Unsaved — disk full');
  });

  it('shows the plain state without a message', () => {
    expect(saveLabel('unsaved', null)).toBe('Unsaved');
    expect(saveLabel('saving', null)).toBe('Saving…');
    expect(saveLabel('saved', null)).toBe('Saved');
  });
});
