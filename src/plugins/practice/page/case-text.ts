import type { JsonValue, Signature } from '../problem';

// A value as the console shows it: its JSON text, `null` for none.
export function valueText(value: JsonValue | null): string {
  return JSON.stringify(value);
}

// A case's input as the console shows it: a function case whose input holds
// one value per parameter is one `<name> = <value>` line per parameter; any
// other input (a design or codec case, a length mismatch) is its JSON text.
export function caseInputText(signature: Signature, input: JsonValue): string {
  const isOneValuePerParam =
    signature.kind === 'function' &&
    Array.isArray(input) &&
    input.length === signature.params.length;
  if (!isOneValuePerParam) {
    return JSON.stringify(input);
  }
  return signature.params
    .map((param, index) => `${param.name} = ${valueText(input[index])}`)
    .join('\n');
}
