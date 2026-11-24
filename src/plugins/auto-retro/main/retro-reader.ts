import type { RetroContribution } from '../../../contracts/contributions';
import { isJsonObject } from '../../../shared/json';
import type { FeatureReader } from '../../contributions/contract';
import { SESSIONS_PLACEHOLDER } from './retro-queue';

type RetroTrigger = RetroContribution['on'][number];

const TRIGGERS: readonly RetroTrigger[] = ['close', 'clear'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function commandReasons(command: unknown): string[] {
  if (!isNonEmptyString(command)) {
    return ['command: not a non-empty string'];
  }
  const parts = command.split(SESSIONS_PLACEHOLDER);
  const placeholderCount = parts.length - 1;
  const reasons =
    placeholderCount === 1
      ? []
      : [`command: holds {sessions} ${placeholderCount} times, not once`];
  const hasTextBefore = parts[0].trim() !== '';
  if (placeholderCount > 0 && !hasTextBefore) {
    reasons.push('command: has no text before {sessions}');
  }
  return reasons;
}

function isTriggerList(on: unknown): on is RetroTrigger[] {
  return (
    Array.isArray(on) &&
    on.length > 0 &&
    on.every((each) => TRIGGERS.includes(each as RetroTrigger)) &&
    new Set(on).size === on.length
  );
}

// The `retro` section of `auri.json`: its `label`, `command`, `folder` and `on`, with every other key dropped.
export const retroReader: FeatureReader<RetroContribution> = {
  label: 'Retro',
  read(section) {
    if (!isJsonObject(section)) {
      return { ok: false, reasons: ['"retro" is not an object'] };
    }
    const { label, command, folder, on } = section;
    const reasons = commandReasons(command);
    if (!isNonEmptyString(folder)) {
      reasons.push('folder: not a non-empty string');
    }
    if (!isTriggerList(on)) {
      reasons.push('on: not a list of close and clear');
    }
    if (label !== undefined && typeof label !== 'string') {
      reasons.push('label: not a string');
    }
    if (reasons.length > 0) {
      return { ok: false, reasons };
    }
    // Every reason above is empty, so each field holds the type its check read.
    const value: RetroContribution = {
      command: command as string,
      folder: folder as string,
      on: [...(on as RetroTrigger[])],
    };
    return {
      ok: true,
      value: typeof label === 'string' ? { label, ...value } : value,
    };
  },
};
