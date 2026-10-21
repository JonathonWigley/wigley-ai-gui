import './syntax.css';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import type { CodeHighlighter } from '../../contracts/highlight';
import { findLanguageByName, loadLanguage } from './languages';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

// Highlights with the same parsers the editor uses, outside any editor.
export function createCodeMirrorHighlighter(): CodeHighlighter {
  return {
    highlight: async (code, language) => {
      const description = findLanguageByName(language);
      if (description === null) {
        return null;
      }
      const support = await loadLanguage(description);
      const tree = support.language.parser.parse(code);
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
