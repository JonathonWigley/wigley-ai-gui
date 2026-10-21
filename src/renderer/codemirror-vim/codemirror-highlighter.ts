import './syntax.css';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  LanguageDescription,
  type LanguageSupport,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import type { CodeHighlighter } from '../../contracts/highlight';
import { findLanguageByName, loadLanguage } from './languages';

const MARKDOWN = 'Markdown';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

// GFM markdown whose fences take only a language already loaded, and add each
// unloaded one they name to `requested`. A fence naming a description makes
// the parser start a load that, outside an editor, nothing awaits or catches.
function markdownLoadingNoFences(
  requested: Set<LanguageDescription>,
): LanguageSupport {
  return markdown({
    base: markdownLanguage,
    codeLanguages: (info) => {
      const found = LanguageDescription.matchLanguageName(
        languages,
        info,
        true,
      );
      if (found?.support) {
        return found.support.language;
      }
      if (found) {
        requested.add(found);
      }
      return null;
    },
  });
}

// Highlights with the same parsers the editor uses, outside any editor. A
// fence inside markdown highlights in its language once that loads, and stays
// plain when the load fails, as an unknown language does.
export function createCodeMirrorHighlighter(): CodeHighlighter {
  const requested = new Set<LanguageDescription>();
  const markdownSupport = markdownLoadingNoFences(requested);

  // Parses, loads the fence languages that parse met unloaded, and parses
  // again if it met any. The clear and the parse run in one synchronous
  // stretch, so a concurrent highlight cannot mix its fences into this one's.
  async function parseMarkdown(code: string) {
    requested.clear();
    const tree = markdownSupport.language.parser.parse(code);
    const unloaded = [...requested];
    if (unloaded.length === 0) {
      return tree;
    }
    await Promise.allSettled(unloaded.map((language) => language.load()));
    return markdownSupport.language.parser.parse(code);
  }

  return {
    highlight: async (code, language) => {
      const description = findLanguageByName(language);
      if (description === null) {
        return null;
      }
      const tree =
        description.name === MARKDOWN
          ? await parseMarkdown(code)
          : (await loadLanguage(description)).language.parser.parse(code);
      let html = '';
      highlightCode(
        code,
        tree,
        classHighlighter,
        (text, classes) => {
          html += classedText(text, classes);
        },
        () => {
          html += '\n';
        },
      );
      return html;
    },
  };
}

function classedText(text: string, classes: string): string {
  const escaped = escapeHtml(text);
  return classes === ''
    ? escaped
    : `<span class="${classes}">${escaped}</span>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => HTML_ESCAPES[char]);
}
