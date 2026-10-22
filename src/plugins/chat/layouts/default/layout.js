// @ts-check

// The built-in chat look. Every expander's and collapsible card's body is
// built on its first open and kept, so an update refills it in place whether
// it is open or closed.

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
function el(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

/**
 * @param {import('../layout').ToolInput} input
 * @param {import('../layout').ChatKit} kit
 * @param {HTMLElement} body
 */
function fillToolBody(input, kit, body) {
  const parts = [kit.sectionHeader('Input'), kit.json(input.input)];
  if (input.result === null) {
    parts.push(el('div', 'chat-muted', 'Running…'));
  } else {
    parts.push(kit.sectionHeader(input.result.isError ? 'Error' : 'Result'));
    parts.push(el('pre', 'chat-tool-result', input.result.text));
  }
  body.replaceChildren(...parts);
}

/** @param {import('../layout').ToolInput} input */
function toolLine(input) {
  return input.summary === '' ? input.name : `${input.name} · ${input.summary}`;
}

// Running until the result arrives, then the result's outcome.
/**
 * @param {import('../layout').ToolInput} input
 * @returns {import('../layout').DotStatus}
 */
function toolStatus(input) {
  if (input.result === null) {
    return 'running';
  }
  return input.result.isError ? 'error' : 'success';
}

/** @param {import('../layout').ResultInput} input */
function resultLine(input) {
  const parts = [input.stopReason];
  if (input.costUsd !== null) {
    parts.push(`$${input.costUsd.toFixed(4)}`);
  }
  if (input.durationMs !== null) {
    parts.push(`${(input.durationMs / 1000).toFixed(1)} s`);
  }
  return parts.join(' · ');
}

/** @param {'info' | 'error'} tone */
function noticeClass(tone) {
  return `chat-entry chat-notice chat-notice-${tone}`;
}

/** @type {import('../layout').ChatLayout} */
const layout = {
  entries: {
    user(input, kit) {
      const root = el('div', 'chat-entry chat-user');
      const turn = kit.card();
      turn.append(kit.markdown(input.text));
      root.append(turn);
      return {
        element: root,
        update(next) {
          turn.replaceChildren(kit.markdown(next.text));
        },
      };
    },
    assistant(input, kit) {
      const root = el('div', 'chat-entry chat-assistant');
      root.append(kit.markdown(input.text));
      root.classList.toggle('chat-streaming', input.streaming);
      return {
        element: root,
        update(next) {
          root.replaceChildren(kit.markdown(next.text));
          root.classList.toggle('chat-streaming', next.streaming);
        },
      };
    },
    thinking(input, kit) {
      let current = input;
      /** @type {HTMLElement | null} */
      let body = null;
      const root = el('div', 'chat-entry chat-thinking');
      root.append(
        kit.expander('Thinking', () => {
          if (body === null) {
            body = el('div', 'chat-thinking-body');
            body.append(kit.markdown(current.text));
          }
          return body;
        }),
      );
      root.classList.toggle('chat-streaming', input.streaming);
      return {
        element: root,
        update(next) {
          current = next;
          if (body !== null) {
            body.replaceChildren(kit.markdown(next.text));
          }
          root.classList.toggle('chat-streaming', next.streaming);
        },
      };
    },
    // Built closed; the result arriving sets the dot and refills the body,
    // leaving the card open or closed as it was.
    tool(input, kit) {
      let current = input;
      /** @type {HTMLElement | null} */
      let body = null;
      const dot = kit.statusDot(toolStatus(input));
      const root = el('div', 'chat-entry chat-tool');
      root.append(
        kit.collapsibleCard({
          summary: toolLine(input),
          mono: true,
          leading: dot,
          body: () => {
            if (body === null) {
              body = el('div', 'chat-tool-body');
              fillToolBody(current, kit, body);
            }
            return body;
          },
        }).element,
      );
      return {
        element: root,
        update(next) {
          current = next;
          if (body !== null) {
            fillToolBody(next, kit, body);
          }
          kit.setDotStatus(dot, toolStatus(next));
        },
      };
    },
    // No update: an answer builds the entry again, its card losing the
    // attention edge.
    permission(input, kit) {
      const root = el('div', 'chat-entry chat-permission');
      const prompt = kit.card(input.answer === null ? 'attention' : null);
      prompt.append(
        el('div', 'chat-permission-head', `Allow ${input.toolName}?`),
        kit.json(input.input),
        kit.permissionActions(),
      );
      root.append(prompt);
      return { element: root };
    },
    result(input) {
      const root = el(
        'div',
        'chat-entry chat-result chat-muted',
        resultLine(input),
      );
      return {
        element: root,
        update(next) {
          root.textContent = resultLine(next);
        },
      };
    },
    notice(input) {
      const root = el('div', noticeClass(input.tone), input.text);
      return {
        element: root,
        update(next) {
          root.className = noticeClass(next.tone);
          root.textContent = next.text;
        },
      };
    },
    raw(input, kit) {
      let current = input;
      /** @type {HTMLElement | null} */
      let body = null;
      const root = el('div', 'chat-entry chat-raw');
      root.append(
        kit.expander('Raw event', () => {
          if (body === null) {
            body = el('div', 'chat-raw-body');
            body.append(kit.json(current.raw));
          }
          return body;
        }),
      );
      return {
        element: root,
        update(next) {
          current = next;
          if (body !== null) {
            body.replaceChildren(kit.json(next.raw));
          }
        },
      };
    },
  },
};

export default layout;
