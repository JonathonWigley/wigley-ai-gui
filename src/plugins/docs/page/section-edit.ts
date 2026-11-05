// The doc view's pure section-editing rules: which rendered blocks an editor
// hides, where a section went in another text, and which heading a move lands
// on.

import { type DocSection, sectionsOf } from '../sections';

// One flag per direct child of the body, whose body-relative source line is
// `lines`'s entry, or null for a child with none. A child hides when its range
// overlaps the section: it runs to the line before the next child with a line,
// and a child with no line takes the flag of the child before it.
export function hiddenBlockFlags(
  lines: readonly (number | null)[],
  section: DocSection,
  bodyStartLine: number,
): boolean[] {
  const flags: boolean[] = [];
  for (const [index, line] of lines.entries()) {
    if (line === null) {
      flags.push(flags.at(-1) ?? false);
      continue;
    }
    const next = lines.slice(index + 1).find((later) => later !== null);
    const start = line + bodyStartLine - 1;
    const end =
      next === undefined || next === null
        ? Number.POSITIVE_INFINITY
        : next + bodyStartLine - 2;
    flags.push(start <= section.endLine && end >= section.startLine);
  }
  return flags;
}

// The section of `toText` that matches the section at `startLine` of
// `fromText`: the same title and level, and the same count among earlier
// sections with both. Null when `toText` holds no such section.
export function relocateSection(
  fromText: string,
  startLine: number,
  toText: string,
): DocSection | null {
  const from = sectionsOf(fromText);
  const index = from.findIndex((section) => section.startLine === startLine);
  if (index === -1) {
    return null;
  }
  const { title, level } = from[index];
  const isSameHeading = (section: DocSection) =>
    section.title === title && section.level === level;
  const earlier = from.slice(0, index).filter(isSameHeading).length;
  return sectionsOf(toText).filter(isSameHeading)[earlier] ?? null;
}

// The `startLine` of the heading a move lands on, null when it has none to
// land on. From the held heading it is that heading's neighbour; with none
// held, the first heading below the top of sight, or the last above it.
// `headings` is in file order.
export function sectionMoveTarget(
  headings: readonly { startLine: number; top: number }[],
  scrollTop: number,
  direction: 1 | -1,
  heldLine: number | null,
): number | null {
  if (heldLine !== null) {
    const held = headings.findIndex(({ startLine }) => startLine === heldLine);
    return headings[held + direction]?.startLine ?? null;
  }
  const top = Math.round(scrollTop);
  const heading =
    direction === 1
      ? headings.find((candidate) => candidate.top > top)
      : headings.findLast((candidate) => candidate.top < top);
  return heading?.startLine ?? null;
}
