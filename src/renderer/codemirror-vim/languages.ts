import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  LanguageDescription,
  type LanguageSupport,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const MARKDOWN = 'Markdown';
const PATH_SEPARATOR = /[/\\]/;

// Built on first load: GFM markdown whose fences highlight by their info string.
let markdownSupport: LanguageSupport | null = null;

// Exact, case-insensitive match on a language's name or alias.
export function findLanguageByName(name: string): LanguageDescription | null {
  return LanguageDescription.matchLanguageName(languages, name, false);
}

// The language's file name pattern first, then the file's extension.
export function findLanguageByFile(
  fileNameOrPath: string,
): LanguageDescription | null {
  const fileName = fileNameOrPath.split(PATH_SEPARATOR).pop() ?? '';
  return LanguageDescription.matchFilename(languages, fileName);
}

export function loadLanguage(
  language: LanguageDescription,
): Promise<LanguageSupport> {
  if (language.name === MARKDOWN) {
    markdownSupport ??= markdown({
      base: markdownLanguage,
      codeLanguages: languages,
    });
    return Promise.resolve(markdownSupport);
  }
  return language.load();
}
