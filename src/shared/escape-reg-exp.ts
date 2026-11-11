// `text` with every regular-expression metacharacter escaped, so it matches itself.
export const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
