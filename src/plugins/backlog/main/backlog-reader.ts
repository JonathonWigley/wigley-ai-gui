import type { BacklogContribution } from '../../../contracts/contributions';
import { isJsonObject, isNonEmptyString } from '../../../shared/json';
import type { FeatureReader } from '../../contributions/contract';
import { templateProblem } from '../../docs/features-homes';

function isFileName(value: unknown): value is string {
  return isNonEmptyString(value) && !/[/\\]/.test(value);
}

function homesReasons(homes: unknown): string[] {
  const isTemplateList =
    Array.isArray(homes) &&
    homes.length > 0 &&
    homes.every((home) => typeof home === 'string');
  if (!isTemplateList) {
    return ['homes: not a list of folder templates'];
  }
  return homes.flatMap((home: string, index) => {
    const problem = templateProblem(home);
    return problem === null ? [] : [`homes[${index}]: ${problem}`];
  });
}

function isAssistant(value: unknown): value is { instructions: string } {
  return isJsonObject(value) && isNonEmptyString(value.instructions);
}

// The `backlog` section of `auri.json`: its `label`, `homes`, `file`,
// `areaFolder` and `assistant`, with every other key dropped.
export const backlogReader: FeatureReader<BacklogContribution> = {
  label: 'Backlog',
  read(section) {
    if (!isJsonObject(section)) {
      return { ok: false, reasons: ['"backlog" is not an object'] };
    }
    const { label, homes, file, areaFolder, assistant } = section;
    const reasons = homesReasons(homes);
    if (!(isFileName(file) && file.endsWith('.md'))) {
      reasons.push('file: not a .md file name');
    }
    if (areaFolder !== undefined && !isFileName(areaFolder)) {
      reasons.push('areaFolder: not a folder name');
    }
    if (assistant !== undefined && !isAssistant(assistant)) {
      reasons.push('assistant: not { "instructions": text }');
    }
    if (label !== undefined && typeof label !== 'string') {
      reasons.push('label: not a string');
    }
    if (reasons.length > 0) {
      return { ok: false, reasons };
    }
    // Every reason above is empty, so each field holds the type its check read.
    const value: BacklogContribution = {
      ...(typeof label === 'string' ? { label } : {}),
      homes: [...(homes as string[])],
      file: file as string,
      ...(typeof areaFolder === 'string' ? { areaFolder } : {}),
      ...(isAssistant(assistant)
        ? { assistant: { instructions: assistant.instructions } }
        : {}),
    };
    return { ok: true, value };
  },
};
