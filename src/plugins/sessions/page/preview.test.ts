import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import { HARNESSES } from '../contract';
import { PREVIEW_STATE, PREVIEW_STATUSES } from './preview';
import {
  drawnRows,
  rowNamed,
  sessionsViewSetup,
  stateOf,
} from './sessions-view-fakes';

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessions preview', () => {
  it('preview_SampleRows_CoverEveryRowState', () => {
    const { rows, selectedSessionId } = PREVIEW_STATE;
    const statusOf = (sessionId: string) => PREVIEW_STATUSES[sessionId] ?? null;

    expect(rows.map((row) => row.sessionId)).toContain(selectedSessionId);
    expect(rows.some((row) => row.marked)).toBe(true);
    expect(rows.some((row) => !row.marked)).toBe(true);
    expect(new Set(rows.map((row) => row.harness))).toEqual(
      new Set([...HARNESSES, null]),
    );
    expect(rows.some((row) => statusOf(row.sessionId) !== null)).toBe(true);
    expect(rows.some((row) => statusOf(row.sessionId) === null)).toBe(true);
  });

  it('sessionsView_PreviewShown_SendsNothingAndRestoresRealRows', () => {
    const { view, sideBar, activated } = sessionsViewSetup();
    view.render(stateOf(['real-1', 'real-2'], 'real-1'));

    view.showPreview(true);
    rowNamed(drawnRows(sideBar), 'scratch').click();
    const selected = rowNamed(drawnRows(sideBar), 'scratch');
    view.render(stateOf(['real-3'], 'real-3'));
    const rowsWhileShown = drawnRows(sideBar).map((row) => row.textContent);
    view.showPreview(false);

    expect(activated).toEqual([]);
    expect(selected.classList.contains('is-selected')).toBe(true);
    expect(rowsWhileShown).toHaveLength(PREVIEW_STATE.rows.length);
    const realRows = drawnRows(sideBar);
    expect(realRows).toHaveLength(1);
    expect(realRows[0].textContent).toContain('label real-3');
  });
});
