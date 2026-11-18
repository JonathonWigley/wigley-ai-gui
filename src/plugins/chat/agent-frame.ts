// The frame line a message from another session's agent opens with, so the
// target agent knows the user did not type it. Chat's main part writes it and
// its page reads it back.

const FRAME_LINE =
  /^\[Message from the agent in session "((?:[^"\\]|\\.)*)" — not typed by the user\]$/;

// The longest sender name a frame carries, in code points, its `…` included.
const SENDER_NAME_CAP = 80;

// `text` opened with the frame line naming `senderName`, which
// `frameSenderName` has already escaped.
export function frameAgentMessage(senderName: string, text: string): string {
  return `[Message from the agent in session "${senderName}" — not typed by the user]\n${text}`;
}

// The sender, its escapes undone, and the text after the frame line; null for
// any text whose first line is not a whole frame line followed by a newline.
export function readAgentFrame(
  text: string,
): { from: string; body: string } | null {
  const newline = text.indexOf('\n');
  if (newline === -1) {
    return null;
  }
  const match = FRAME_LINE.exec(text.slice(0, newline));
  if (match === null) {
    return null;
  }
  return {
    from: match[1].replace(/\\(.)/g, '$1'),
    body: text.slice(newline + 1),
  };
}

// The name a frame gives its sender: the title, else the label, else the id,
// with whitespace runs collapsed, capped, and `\` and `"` escaped.
export function frameSenderName(
  title: string | null,
  label: string | null,
  sessionId: string,
): string {
  const name = cleanedName(title) || cleanedName(label) || sessionId;
  return name.replace(/[\\"]/g, '\\$&');
}

function cleanedName(name: string | null): string {
  const collapsed = (name ?? '').replace(/\s+/g, ' ').trim();
  const codePoints = [...collapsed];
  if (codePoints.length <= SENDER_NAME_CAP) {
    return collapsed;
  }
  return `${codePoints.slice(0, SENDER_NAME_CAP - 1).join('')}…`;
}
