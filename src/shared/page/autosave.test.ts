import { describe, expect, it } from 'vitest';
import { saveLabel } from './autosave';

describe('saveLabel', () => {
  it('shows the failed save message while unsaved', () => {
    expect(saveLabel('unsaved', 'disk full')).toContain('disk full');
  });
});
