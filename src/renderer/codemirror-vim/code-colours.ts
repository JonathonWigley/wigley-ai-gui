// The tag map is from @catppuccin/codemirror 1.0.3 (MIT, Catppuccin).
import { HighlightStyle, type TagStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// Held apart from `HighlightStyle.define`, whose `define([` the layer check's
// import scan reads as an AMD module list.
const MOCHA_TAG_STYLES: readonly TagStyle[] = [
  { tag: tags.keyword, color: '#cba6f7' },
  {
    tag: [
      tags.name,
      tags.definition(tags.name),
      tags.deleted,
      tags.character,
      tags.macroName,
    ],
    color: '#cdd6f4',
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.propertyName,
      tags.labelName,
    ],
    color: '#89b4fa',
  },
  {
    tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: '#fab387',
  },
  { tag: [tags.self, tags.atom], color: '#f38ba8' },
  {
    tag: [
      tags.typeName,
      tags.className,
      tags.changed,
      tags.annotation,
      tags.namespace,
    ],
    color: '#f9e2af',
  },
  { tag: [tags.operator], color: '#89dceb' },
  { tag: [tags.url, tags.link], color: '#94e2d5' },
  { tag: [tags.escape, tags.regexp], color: '#f5c2e7' },
  {
    tag: [tags.meta, tags.punctuation, tags.separator, tags.comment],
    color: '#9399b2',
  },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#89b4fa', textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: 'bold', color: '#89b4fa' },
  { tag: [tags.special(tags.variableName)], color: '#b4befe' },
  { tag: [tags.bool, tags.number], color: '#fab387' },
  {
    tag: [tags.processingInstruction, tags.string, tags.inserted],
    color: '#a6e3a1',
  },
  { tag: tags.invalid, color: '#f38ba8' },
];

// Catppuccin Mocha's code colours, fixed under any theme: editors highlight
// through it, and the highlighter gives markdown code blocks its classes.
export const codeColours = HighlightStyle.define(MOCHA_TAG_STYLES);

// Adds the code colours' rules to the page, for highlighted code shown
// outside any editor, which would otherwise mount them.
export function mountCodeColours(doc: Document): void {
  const rules = codeColours.module;
  if (rules === null) {
    throw new Error('The code colour style has no style rules');
  }
  const style = doc.createElement('style');
  style.textContent = rules.getRules();
  doc.head.append(style);
}
