// @ts-check

// The built-in chat look. Every expander's body is built on its first open and
// kept, so an update refills it in place whether it is open or closed.

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
  const parts = [
    el('div', 'chat-section-label', 'Input'),
    kit.json(input.input),
  ];
  if (input.result === null) {
    parts.push(el('div', 'chat-muted', 'Running…'));
  } else {
    parts.push(
      el(
        'div',
        'chat-section-label',
        input.result.isError ? 'Error' : 'Result',
      ),
    );
    parts.push(el('pre', 'chat-tool-result', input.result.text));
  }
  body.replaceChildren(...parts);
}

/** @param {import('../layout').ToolInput} input */
function toolLine(input) {
  return input.summary === '' ? input.name : `${input.name} · ${input.summary}`;
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
      root.append(kit.markdown(input.text));
      return {
        element: root,
        update(next) {
          root.replaceChildren(kit.markdown(next.text));
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
    tool(input, kit) {
      let current = input;
      /** @type {HTMLElement | null} */
      let body = null;
      const root = el('div', 'chat-entry chat-tool');
      root.append(
        kit.expander(toolLine(input), () => {
          if (body === null) {
            body = el('div', 'chat-tool-body');
            fillToolBody(current, kit, body);
          }
          return body;
        }),
      );
      /** @param {import('../layout').ToolInput} shown */
      const markResult = (shown) => {
        root.classList.toggle('chat-tool-running', shown.result === null);
        root.classList.toggle(
          'chat-tool-error',
          shown.result !== null && shown.result.isError,
        );
      };
      markResult(input);
      return {
        element: root,
        update(next) {
          current = next;
          if (body !== null) {
            fillToolBody(next, kit, body);
          }
          markResult(next);
        },
      };
    },
    permission(input, kit) {
      const root = el('div', 'chat-entry chat-permission');
      root.append(
        el('div', 'chat-permission-head', `Allow ${input.toolName}?`),
        kit.json(input.input),
        kit.permissionActions(),
      );
      root.classList.toggle('chat-permission-answered', input.answer !== null);
      return {
        element: root,
        update(next) {
          root.classList.toggle(
            'chat-permission-answered',
            next.answer !== null,
          );
        },
      };
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
