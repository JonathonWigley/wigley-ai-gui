import { describe, expect, it } from 'vitest';
import type { AppUpdateStatus } from '../contract';
import { updateStatusOf } from './update-decision';

const INSTALLED = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ORIGIN = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('updateStatusOf', () => {
  it.each<{
    case: string;
    origin: string | null;
    isAncestor: boolean;
    status: AppUpdateStatus;
  }>([
    {
      case: 'origin ahead of the installed commit',
      origin: ORIGIN,
      isAncestor: true,
      status: { kind: 'available', sha: '2222222' },
    },
    {
      case: 'origin on the installed commit',
      origin: INSTALLED,
      isAncestor: true,
      status: { kind: 'none' },
    },
    {
      case: 'installed from a newer local commit',
      origin: ORIGIN,
      isAncestor: false,
      status: { kind: 'none' },
    },
    {
      case: 'no origin main',
      origin: null,
      isAncestor: false,
      status: { kind: 'none' },
    },
  ])('updateStatusOf_$case', ({ origin, isAncestor, status }) => {
    expect(updateStatusOf(INSTALLED, origin, isAncestor)).toEqual(status);
  });
});
