import { asArray, asJson, asString } from './json-fields';

// A tool result's content as text: a string as it stands, a block array as
// its text blocks' texts, each other block written `[<type>]`.
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return asArray(content)
    .map((block) => {
      const fields = asJson(block);
      return fields.type === 'text'
        ? asString(fields.text)
        : `[${asString(fields.type)}]`;
    })
    .join('\n');
}
