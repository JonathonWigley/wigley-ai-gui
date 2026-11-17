import { describe, expect, it } from 'vitest';
import type { AgentHarness } from '../contracts/agent';
import { harnessLabel, registeredInfos } from './agent-harness-label';
import {
  harnessInfo,
  harnessRegistryOf,
} from './agent-harness-registry.test-support';

describe('harnessLabel', () => {
  const claudeOnly = new Map([
    ['claude', harnessInfo({ label: 'Claude Code' })],
  ]);
  const codexRegistered = new Map([
    ['codex', harnessInfo({ label: 'Codex CLI' })],
  ]);

  it.each([
    { infos: claudeOnly, id: 'claude', label: 'Claude Code' },
    { infos: claudeOnly, id: 'codex', label: 'Codex' },
    { infos: codexRegistered, id: 'codex', label: 'Codex CLI' },
    { infos: claudeOnly, id: 'gemini', label: 'gemini' },
    { infos: claudeOnly, id: 'constructor', label: 'constructor' },
  ])('labels $id as $label', ({ infos, id, label }) => {
    expect(harnessLabel(infos, id)).toBe(label);
  });
});

describe('registeredInfos', () => {
  it('registeredInfos_TwoHarnesses_InfoById', () => {
    const harnessOf = (id: string, label: string) =>
      ({ id, info: () => harnessInfo({ label }) }) as unknown as AgentHarness;
    const registry = harnessRegistryOf([
      harnessOf('a', 'A'),
      harnessOf('b', 'B'),
    ]);

    expect([...registeredInfos(registry)]).toEqual([
      ['a', harnessInfo({ label: 'A' })],
      ['b', harnessInfo({ label: 'B' })],
    ]);
  });
});
