// @ts-check

// The built-in chat look: the entries, the activity lines, the pending
// messages' rows, the composer, the list rows, the dialogs' bodies and the
// image viewer. Every collapsible row's body is built on its first open and
// kept, so an update refills it in place whether it is open or closed.

// The steps a live, closed activity line lists under its header; a user
// layout sets its own shortlist's length.
const LIVE_STEP_LINES = 5;

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
  body.replaceChildren();
  kit.sectionHeader(body, 'Input');
  kit.json(body, input.input);
  if (input.result === null) {
    body.append(el('div', 'chat-muted', 'Running…'));
  } else {
    kit.sectionHeader(body, input.result.isError ? 'Error' : 'Result');
    body.append(el('pre', 'chat-tool-result', input.result.text));
  }
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

// The text, then the thumbnails of any images under it, in place of what
// `turn` held.
/**
 * @param {HTMLElement} turn
 * @param {import('../layout').UserInput} input
 * @param {import('../layout').ChatKit} kit
 */
function fillUserTurn(turn, input, kit) {
  turn.replaceChildren();
  kit.markdown(turn, input.text, 'md');
  if (input.images.length > 0) {
    kit.images(turn);
  }
}

/** @param {'info' | 'error'} tone */
function noticeClass(tone) {
  return `chat-entry chat-notice chat-notice-${tone}`;
}

/**
 * @param {HTMLElement} parent
 * @param {string} className
 * @param {string} [text]
 */
function root(parent, className, text) {
  const element = el('div', className, text);
  parent.append(element);
  return element;
}

/** @param {import('../layout').StepInput} step */
function stepAction(step) {
  if (step.kind === 'tool') {
    return toolLine(step);
  }
  return step.kind === 'thinking' ? 'Thinking' : 'Raw event';
}

/** @param {import('../layout').StepInput} step */
function isFailedStep(step) {
  return step.kind === 'tool' && step.result !== null && step.result.isError;
}

/** @param {number} count */
function stepCount(count) {
  return count === 1 ? '1 step' : `${count} steps`;
}

// Each tool's name with its count, most used first, ties in order of first
// use; a tool used once is named alone.
/** @param {import('../layout').StepInput[]} steps */
function toolTally(steps) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const step of steps) {
    if (step.kind === 'tool') {
      counts.set(step.name, (counts.get(step.name) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort((left, right) => right[1] - left[1])
    .map(([name, count]) => (count === 1 ? name : `${name} ${count}`));
}

// The finished line: the step count and the tools, then the failed count,
// then the time.
/**
 * @param {import('../layout').ActivityInput} input
 * @param {HTMLElement} time
 */
function activitySummary(input, time) {
  const summary = el('div', 'chat-activity-summary');
  summary.append(
    el(
      'span',
      'chat-activity-steps',
      [stepCount(input.steps.length), ...toolTally(input.steps)].join(' · '),
    ),
  );
  const failed = input.steps.filter(isFailedStep).length;
  if (failed > 0) {
    summary.append(el('span', 'chat-activity-failed', `· ${failed} failed`));
  }
  summary.append(time);
  return summary;
}

// The latest steps, oldest first, the last one current.
/** @param {import('../layout').StepInput[]} steps */
function activityShortlist(steps) {
  const shortlist = el('div', 'chat-activity-shortlist');
  const shown = steps.slice(-LIVE_STEP_LINES);
  shown.forEach((step, index) => {
    const line = el('div', 'chat-activity-step', stepAction(step));
    line.classList.toggle('is-current', index === shown.length - 1);
    line.classList.toggle('is-failed', isFailedStep(step));
    shortlist.append(line);
  });
  return shortlist;
}

// A live run: its header, over the shortlist while closed. A finished run:
// the summary line, open or closed.
/**
 * @param {HTMLElement} line
 * @param {import('../layout').ActivityInput} input
 * @param {import('../layout').BaseKit} kit
 */
function fillActivity(line, input, kit) {
  line.replaceChildren();
  line.classList.toggle('is-live', input.live);
  const time = el(
    'span',
    'chat-activity-time',
    `· ${kit.duration((input.endedAt ?? input.now) - input.startedAt)}`,
  );
  if (!input.live) {
    line.append(activitySummary(input, time));
    return;
  }
  const head = el('div', 'chat-activity-head');
  line.append(head);
  kit.statusDot(head, 'running');
  head.append(
    el('span', 'chat-activity-action', stepAction(input.current)),
    el('span', 'chat-activity-count', `· ${stepCount(input.steps.length)}`),
    time,
  );
  if (!input.open) {
    line.append(activityShortlist(input.steps));
  }
}

/** @param {number} imageCount */
function queuedLabel(imageCount) {
  if (imageCount === 0) {
    return 'pending';
  }
  return `pending · ${imageCount} ${imageCount === 1 ? 'image' : 'images'}`;
}

/**
 * @param {HTMLElement} label
 * @param {HTMLElement} text
 * @param {import('../layout').QueuedMessageInput} input
 */
function showQueued(label, text, input) {
  label.textContent = queuedLabel(input.imageCount);
  text.textContent = input.text;
}

const WAITING_TEXT = 'Waiting for the sign-in link…';

/** @param {string | null} link */
function linkText(link) {
  return link ?? WAITING_TEXT;
}

// The image, then its place under it, hidden for a single image.
/**
 * @param {HTMLImageElement} picture
 * @param {HTMLElement} counter
 * @param {import('../layout').ImageViewerInput} input
 */
function showImage(picture, counter, input) {
  const place = `${input.index + 1} of ${input.count}`;
  picture.src = input.src;
  picture.alt = `Image ${place}`;
  counter.textContent = place;
  counter.hidden = input.count < 2;
}

/** @type {import('../layout').CompleteChatLayout} */
const layout = {
  entries: {
    user(parent, input, kit) {
      const entry = root(parent, 'chat-entry chat-user');
      const turn = kit.card(entry);
      fillUserTurn(turn, input, kit);
      return {
        element: entry,
        update(next) {
          fillUserTurn(turn, next, kit);
        },
      };
    },
    assistant(parent, input, kit) {
      const entry = root(parent, 'chat-entry chat-assistant');
      kit.markdown(entry, input.text, 'md');
      entry.classList.toggle('chat-streaming', input.streaming);
      return {
        element: entry,
        update(next) {
          entry.replaceChildren();
          kit.markdown(entry, next.text, 'md');
          entry.classList.toggle('chat-streaming', next.streaming);
        },
      };
    },
    thinking(parent, input, kit) {
      let current = input;
      /** @type {HTMLElement | null} */
      let body = null;
      const entry = root(parent, 'chat-entry chat-thinking');
      kit.collapsibleRow(entry, {
        summary: 'Thinking',
        body: () => {
          if (body === null) {
            body = el('div', 'chat-thinking-body');
            kit.markdown(body, current.text, 'md');
          }
          return body;
        },
      });
      entry.classList.toggle('chat-streaming', input.streaming);
      return {
        element: entry,
        update(next) {
          current = next;
          if (body !== null) {
            body.replaceChildren();
            kit.markdown(body, next.text, 'md');
          }
          entry.classList.toggle('chat-streaming', next.streaming);
        },
      };
    },
    // Built closed; the result arriving sets the dot and refills the body,
    // leaving the row open or closed as it was.
    tool(parent, input, kit) {
      let current = input;
      /** @type {HTMLElement | null} */
      let body = null;
      const entry = root(parent, 'chat-entry chat-tool');
      const dot = kit.statusDot(entry, toolStatus(input));
      kit.collapsibleRow(entry, {
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
      });
      return {
        element: entry,
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
    permission(parent, input, kit) {
      const entry = root(parent, 'chat-entry chat-permission');
      const prompt = kit.edgeCard(
        entry,
        input.answer === null ? 'attention' : null,
      );
      prompt.append(
        el('div', 'chat-permission-head', `Allow ${input.toolName}?`),
      );
      kit.json(prompt, input.input);
      kit.permissionActions(prompt);
      return { element: entry };
    },
    result(parent, input) {
      const entry = root(
        parent,
        'chat-entry chat-result chat-muted',
        resultLine(input),
      );
      return {
        element: entry,
        update(next) {
          entry.textContent = resultLine(next);
        },
      };
    },
    notice(parent, input) {
      const entry = root(parent, noticeClass(input.tone), input.text);
      return {
        element: entry,
        update(next) {
          entry.className = noticeClass(next.tone);
          entry.textContent = next.text;
        },
      };
    },
    raw(parent, input, kit) {
      let current = input;
      /** @type {HTMLElement | null} */
      let body = null;
      const entry = root(parent, 'chat-entry chat-raw');
      kit.collapsibleRow(entry, {
        summary: 'Raw event',
        body: () => {
          if (body === null) {
            body = el('div', 'chat-raw-body');
            kit.json(body, current.raw);
          }
          return body;
        },
      });
      return {
        element: entry,
        update(next) {
          current = next;
          if (body !== null) {
            body.replaceChildren();
            kit.json(body, next.raw);
          }
        },
      };
    },
  },
  // Every update draws the line afresh, so a run turning finished or a tick
  // moving `now` redraws only this line.
  activity(parent, input, kit) {
    const line = root(parent, 'chat-activity');
    fillActivity(line, input, kit);
    return {
      element: line,
      update(next) {
        fillActivity(line, next, kit);
      },
    };
  },
  // The dim label, with the image count when there are images, over the text
  // as typed.
  queuedMessage(parent, input) {
    const row = root(parent, 'chat-queued');
    const label = el('div', 'chat-queued-label');
    const text = el('div', 'chat-queued-text');
    row.append(label, text);
    showQueued(label, text, input);
    return {
      element: row,
      update(next) {
        showQueued(label, text, next);
      },
    };
  },
  // The glass panel: other plugins' parts, the attached images, the box, then
  // the bar.
  composer(parent, _input, kit) {
    const panel = kit.floatingPanel(parent);
    panel.classList.add('chat-composer');
    kit.contributedParts(panel);
    kit.attachments(panel);
    kit.box(panel);
    kit.bar(panel);
    return { element: panel };
  },
  // The box's mode, the type hint, a chip per control, then the running
  // indicator and send at the end.
  composerBar(parent, input, kit) {
    const bar = root(parent, 'chat-composer-bar');
    bar.append(el('span', 'chat-box-mode', input.modeLabel));
    kit.typeHint(bar);
    for (const control of input.controls) {
      kit.controlChip(bar, control);
    }
    kit.running(bar);
    kit.sendButton(bar);
    return { element: bar };
  },
  attachments(parent, input, kit) {
    const strip = root(parent, 'chat-attachments');
    for (const image of input.images) {
      const held = el('div', 'chat-attachment');
      const thumbnail = /** @type {HTMLImageElement} */ (
        el('img', 'chat-attachment-image')
      );
      thumbnail.src = image.src;
      thumbnail.alt = `Attached image ${image.index + 1}`;
      held.append(thumbnail);
      kit.removeButton(held, image.index);
      strip.append(held);
    }
    return { element: strip };
  },
  pickerRow(parent, input, kit) {
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.label,
      trailing: kit.cursorEnd(),
    });
    return { element: row };
  },
  // The link beside Copy, then the code box and the actions.
  signIn(parent, input, kit) {
    const body = root(parent, 'chat-dialog-part');
    body.append(el('p', 'chat-dialog-text', 'Finish sign-in in your browser.'));
    const linkRow = el('div', 'chat-sign-in-link-row');
    const link = el('span', 'chat-sign-in-link', linkText(input.link));
    linkRow.append(link);
    kit.copyButton(linkRow);
    body.append(
      linkRow,
      el('p', 'chat-dialog-text', 'If the page shows a code, paste it here.'),
    );
    kit.codeBox(body);
    kit.actions(body);
    return {
      element: body,
      update(next) {
        link.textContent = linkText(next.link);
      },
    };
  },
  reasonBox(parent, _input, kit) {
    const body = root(parent, 'chat-dialog-part');
    body.append(
      el(
        'p',
        'chat-dialog-text',
        'Optional: tell Claude why. It reads your reason.',
      ),
    );
    kit.reasonBox(body);
    kit.actions(body);
    return { element: body };
  },
  closeConfirm(parent, _input, kit) {
    const body = root(parent, 'chat-dialog-part');
    body.append(
      el(
        'p',
        'chat-dialog-text',
        'Claude is still working. Ending the session stops it.',
      ),
    );
    kit.actions(body);
    return { element: body };
  },
  imageViewer(parent, input) {
    const frame = root(parent, 'chat-image-viewer-frame');
    const picture = /** @type {HTMLImageElement} */ (
      el('img', 'chat-image-viewer-image')
    );
    const counter = el('div', 'chat-image-viewer-count');
    frame.append(picture, counter);
    showImage(picture, counter, input);
    return {
      element: frame,
      update(next) {
        showImage(picture, counter, next);
      },
    };
  },
};

export default layout;
