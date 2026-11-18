export const TOOL_SUMMARY_LENGTH = 80;

// The input field that names what each built-in tool acts on.
const SUMMARY_FIELDS: Readonly<Record<string, string>> = {
  Bash: 'command',
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  Task: 'description',
  Agent: 'description',
};

function fieldsOf(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null
    ? (input as Record<string, unknown>)
    : {};
}

function firstStringField(fields: Record<string, unknown>): string {
  const found = Object.values(fields).find(
    (value): value is string => typeof value === 'string',
  );
  return found ?? '';
}

function namedField(name: string, fields: Record<string, unknown>): string {
  const value = fields[SUMMARY_FIELDS[name]];
  if (typeof value !== 'string') {
    return firstStringField(fields);
  }
  return name === 'Bash' ? value.split('\n')[0] : value;
}

function truncated(text: string): string {
  return text.length > TOOL_SUMMARY_LENGTH
    ? `${text.slice(0, TOOL_SUMMARY_LENGTH - 1)}…`
    : text;
}

// The one-line description of a tool call shown on its compact line.
export function toolSummary(name: string, input: unknown): string {
  const fields = fieldsOf(input);
  const isNamedTool = Object.hasOwn(SUMMARY_FIELDS, name);
  return truncated(
    isNamedTool ? namedField(name, fields) : firstStringField(fields),
  );
}
