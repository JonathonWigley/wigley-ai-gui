import type {
  PresentedPrimer,
  PrimerBody,
  PrimerEntry,
  PrimerFeature,
  PrimerGroup,
  PrimerItem,
} from '../contract';

export function primerFeature(
  overrides: Partial<PrimerFeature> = {},
): PrimerFeature {
  return {
    name: 'Primer port',
    slug: 'primer-port',
    spec: '',
    summary: '',
    notes: '',
    ...overrides,
  };
}

export function primerItem(
  text: string,
  overrides: Partial<PrimerItem> = {},
): PrimerItem {
  return { text, include: true, comment: '', added: false, ...overrides };
}

export function primerEntry(
  id: string,
  group: PrimerGroup,
  overrides: Partial<PrimerEntry> = {},
): PrimerEntry {
  return {
    id,
    group,
    number: group === 'extra' ? null : 1,
    area: `${id} area`,
    question: `${id} question?`,
    task: `${id} task`,
    need: 'unclear',
    evidence: '',
    probes: '',
    pointer: '',
    comment: '',
    items: [],
    ...overrides,
  };
}

// One task per group: `1` (primer, two items), `s1` (standing, no items) and
// `extra-1` (extra, no items).
export function primerEntries(): PrimerEntry[] {
  return [
    primerEntry('1', 'primer', {
      items: [primerItem('Read the store'), primerItem('Write the store')],
    }),
    primerEntry('s1', 'standing'),
    primerEntry('extra-1', 'extra'),
  ];
}

export function presentedPrimer(
  primerId: string,
  parts: {
    feature?: PrimerFeature;
    entries?: PrimerEntry[];
    draft?: PrimerBody | null;
  } = {},
): PresentedPrimer {
  return {
    formId: primerId,
    sessionId: `${primerId}-session`,
    label: `project · ${primerId}`,
    form: {
      feature: parts.feature ?? primerFeature(),
      entries: parts.entries ?? primerEntries(),
    },
    draft: parts.draft ?? null,
  };
}
