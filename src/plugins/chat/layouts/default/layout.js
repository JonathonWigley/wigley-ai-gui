// @ts-check

// The built-in chat look: the entries, the activity lines (each one summary
// line, live or finished), the working block, the pending messages' rows, the
// composer, the list rows, the dialogs' bodies and the image viewer. Every
// collapsible row's body is built on its first open and kept, so an update
// refills it in place whether it is open or closed.

// The tool calls the working block's box lists; a user layout sets its own
// box's length.
const WORKING_ACTION_LINES = 3;

// The input field holding the file a tool acts on, by tool name.
/** @type {Record<string, string | undefined>} */
const TARGET_PATH_FIELDS = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

const WORKING_STATE_WORDS = {
  thinking: 'Thinking…',
  writing: 'Writing…',
  working: 'Working…',
  waiting: 'Waiting…',
};

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
    parts.push(`$${input.costUsd.toFixed(2)}`);
  }
  if (input.durationMs !== null) {
    parts.push(`${(input.durationMs / 1000).toFixed(1)} s`);
  }
  return parts.join(' · ');
}

// The text, then the thumbnails of any images under it, in place of what
// `turn` held. The user's own html block stays code.
/**
 * @param {HTMLElement} turn
 * @param {import('../layout').UserInput} input
 * @param {import('../layout').ChatKit} kit
 */
function fillUserTurn(turn, input, kit) {
  turn.replaceChildren();
  kit.markdown(turn, input.text, 'md', { liveFences: false });
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
function isFailedStep(step) {
  return step.kind === 'tool' && step.result !== null && step.result.isError;
}

/** @param {number} count */
function stepCount(count) {
  return count === 1 ? '1 step' : `${count} steps`;
}

// Each tool's name with its count, most used first, ties in order of first
// use.
/**
 * @param {import('../layout').StepInput[]} steps
 * @returns {[string, number][]}
 */
function toolCounts(steps) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const step of steps) {
    if (step.kind === 'tool') {
      counts.set(step.name, (counts.get(step.name) ?? 0) + 1);
    }
  }
  return [...counts].sort((left, right) => right[1] - left[1]);
}

// The summary line: the step count and the tools, a tool used once named
// alone, then the failed count, then the time.
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
      [
        stepCount(input.steps.length),
        ...toolCounts(input.steps).map(([name, count]) =>
          count === 1 ? name : `${name} ${count}`,
        ),
      ].join(' · '),
    ),
  );
  const failed = input.steps.filter(isFailedStep).length;
  if (failed > 0) {
    summary.append(el('span', 'chat-activity-failed', `· ${failed} failed`));
  }
  summary.append(time);
  return summary;
}

// The summary line, live or finished, open or closed; a live run's time
// runs to now.
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
  line.append(activitySummary(input, time));
}

// `m:ss` under an hour, `h:mm:ss` from one; a negative span is 0:00.
/** @param {number} ms */
function turnTime(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  if (hours === 0) {
    return `${minutes}:${seconds}`;
  }
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
}

// The file name in the tool's path field, else its summary.
/** @param {import('../layout').ToolInput} step */
function actionTarget(step) {
  const field = TARGET_PATH_FIELDS[step.name];
  const fields =
    typeof step.input === 'object' && step.input !== null
      ? /** @type {Record<string, unknown>} */ (step.input)
      : {};
  const path = field === undefined ? undefined : fields[field];
  if (typeof path !== 'string') {
    return step.summary;
  }
  return path.slice(
    Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1,
  );
}

/** @param {import('../layout').ToolInput} step */
function actionLine(step) {
  const target = actionTarget(step);
  return target === '' ? step.name : `${step.name} ${target}`;
}

// The latest tool calls, oldest first, the newest current.
/** @param {import('../layout').ToolInput[]} tools */
function workingBox(tools) {
  const box = el('div', 'chat-working-box');
  const shown = tools.slice(-WORKING_ACTION_LINES);
  shown.forEach((step, index) => {
    const line = el('div', 'chat-working-action', actionLine(step));
    line.classList.toggle('is-current', index === shown.length - 1);
    line.classList.toggle('is-failed', isFailedStep(step));
    box.append(line);
  });
  return box;
}

// The finished turn's one line: the word, the time, the cost when known, then
// each tool's count, all joined with ` · `.
/**
 * @param {import('../layout').DoneWorkingInput} input
 * @param {import('../layout').BaseKit} kit
 */
function doneLine(input, kit) {
  const isFinished =
    input.stopReason === 'end_turn' || input.stopReason === 'success';
  const parts = [
    isFinished ? 'Done' : input.stopReason,
    kit.duration(input.endedAt - input.startedAt),
  ];
  if (input.costUsd !== null) {
    parts.push(`$${input.costUsd.toFixed(2)}`);
  }
  for (const [name, count] of toolCounts(input.steps)) {
    parts.push(`${name} ${count}`);
  }
  return parts.join(' · ');
}

// A finished turn's one line; a running turn's header (time, state), then,
// once the turn has a tool call, the box and the tool counts.
/**
 * @param {HTMLElement} block
 * @param {import('../layout').WorkingInput} input
 * @param {import('../layout').BaseKit} kit
 */
function fillWorking(block, input, kit) {
  block.replaceChildren();
  block.classList.toggle('is-done', input.state === 'done');
  if (input.state === 'done') {
    block.append(el('div', 'chat-working-done', doneLine(input, kit)));
    return;
  }
  const head = el('div', 'chat-working-head');
  head.append(
    el('span', 'chat-working-time', turnTime(input.now - input.startedAt)),
    el('span', 'chat-working-state', WORKING_STATE_WORDS[input.state]),
  );
  block.append(head);
  /** @type {import('../layout').ToolInput[]} */
  const tools = [];
  for (const step of input.steps) {
    if (step.kind === 'tool') {
      tools.push(step);
    }
  }
  if (tools.length === 0) {
    return;
  }
  block.append(
    workingBox(tools),
    el(
      'div',
      'chat-working-counts',
      toolCounts(tools)
        .map(([name, count]) => `${name} ${count}`)
        .join(' '),
    ),
  );
}

// `pending`, or `sending` once the row is sent, then its image count:
// `sending · 2 images`.
/**
 * @param {number} imageCount
 * @param {boolean} sent
 */
function queuedLabel(imageCount, sent) {
  const state = sent ? 'sending' : 'pending';
  if (imageCount === 0) {
    return state;
  }
  return `${state} · ${imageCount} ${imageCount === 1 ? 'image' : 'images'}`;
}

/**
 * @param {HTMLElement} label
 * @param {HTMLElement} text
 * @param {import('../layout').QueuedMessageInput} input
 */
function showQueued(label, text, input) {
  label.textContent = queuedLabel(input.imageCount, input.sent);
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
  activityInTranscript: false,
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
    // An update draws the new markdown before removing the old, so each
    // unchanged visual moves across and stays loaded.
    assistant(parent, input, kit) {
      const entry = root(parent, 'chat-entry chat-assistant');
      let md = kit.markdown(entry, input.text, 'md');
      entry.classList.toggle('chat-streaming', input.streaming);
      return {
        element: entry,
        update(next) {
          const drawn = kit.markdown(entry, next.text, 'md');
          md.remove();
          md = drawn;
          entry.classList.toggle('chat-streaming', next.streaming);
        },
      };
    },
    // An update draws the new markdown before removing the old, as the
    // assistant's does.
    thinking(parent, input, kit) {
      let current = input;
      /** @type {HTMLElement | null} */
      let body = null;
      /** @type {HTMLElement | null} */
      let md = null;
      const entry = root(parent, 'chat-entry chat-thinking');
      kit.collapsibleRow(entry, {
        summary: 'Thinking',
        body: () => {
          if (body === null) {
            body = el('div', 'chat-thinking-body');
            md = kit.markdown(body, current.text, 'md');
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
            const drawn = kit.markdown(body, next.text, 'md');
            md?.remove();
            md = drawn;
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
  // The summary line, live or finished, open or closed. Every update draws
  // the line afresh, so a run turning finished or a tick moving `now` redraws
  // only this line.
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
  // Every update draws the block afresh, as `activity` does; a `done` input
  // draws the finished turn's one line.
  working(parent, input, kit) {
    const block = root(parent, 'chat-working');
    fillWorking(block, input, kit);
    return {
      element: block,
      update(next) {
        fillWorking(block, next, kit);
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
  // The glass panel: other plugins' parts, the working slot, the attached
  // images, the box, then the status line.
  composer(parent, _input, kit) {
    const panel = kit.floatingPanel(parent);
    panel.classList.add('chat-composer');
    kit.contributedParts(panel);
    kit.working(panel);
    kit.attachments(panel);
    kit.box(panel);
    kit.statusLine(panel);
    return { element: panel };
  },
  // The repo and branch, the type hint, the model · effort chip, a chip per
  // other control, other plugins' status parts, then the running indicator
  // and send at the end.
  statusLine(parent, input, kit) {
    const line = root(parent, 'chat-status-line');
    line.append(el('span', 'chat-status-repo', input.repo));
    if (input.branch !== null) {
      line.append(el('span', 'chat-status-branch', input.branch));
    }
    kit.typeHint(line);
    if (input.modelEffort !== null) {
      kit.modelEffortChip(line, input.modelEffort);
    }
    for (const control of input.controls) {
      kit.controlChip(line, control);
    }
    kit.statusParts(line);
    kit.running(line);
    kit.sendButton(line);
    return { element: line };
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
