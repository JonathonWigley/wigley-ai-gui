import { describe, expect, it } from 'vitest';
import type { Bridge } from '../contracts/bridge';
import { bridgeClaim } from './bridge-claim';

describe('bridgeClaim', () => {
  it('returns the bridge to the first claim and throws on the second', () => {
    const bridge = {} as Bridge;
    const exposed = bridgeClaim(bridge);
    expect(exposed.claim()).toBe(bridge);
    expect(() => exposed.claim()).toThrow(/^the bridge was already claimed$/);
  });
});
