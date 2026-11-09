export type Difficulty = 'easy' | 'medium' | 'hard';

export type CompareMode = 'exact' | 'anyOrder' | 'anyOrderDeep' | 'float';

export type ScalarType =
  | 'int'
  | 'long long'
  | 'double'
  | 'bool'
  | 'char'
  | 'string';

/** A supported C++ type, always in its canonical spelling (see `parseValueType`). */
export type ValueType =
  | ScalarType
  | 'ListNode*'
  | 'TreeNode*'
  | 'void'
  | `vector<${string}>`;

export interface Param {
  name: string;
  type: ValueType;
}

export interface FunctionSignature {
  kind: 'function';
  method: string;
  params: Param[];
  returns: ValueType;
}

export interface DesignSignature {
  kind: 'design';
  className: string;
  constructor: Param[];
  methods: { name: string; params: Param[]; returns: ValueType }[];
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface FunctionCase {
  input: JsonValue[];
  expected: JsonValue;
  visible: boolean;
}

export interface DesignCase {
  ops: string[];
  args: JsonValue[][];
  expected: JsonValue[];
  visible: boolean;
}

export interface Problem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  lists: string[];
  signature: FunctionSignature | DesignSignature;
  compare: CompareMode;
  cases: (FunctionCase | DesignCase)[];
}

export type CustomInput =
  | { input: JsonValue[] }
  | { ops: string[]; args: JsonValue[][] };

export class ProblemError extends Error {
  readonly field: string;

  constructor(field: string, reason: string) {
    super(`${field}: ${reason}`);
    this.name = 'ProblemError';
    this.field = field;
  }
}

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
const COMPARE_MODES: readonly CompareMode[] = [
  'exact',
  'anyOrder',
  'anyOrderDeep',
  'float',
];
const SCALAR_TYPES: readonly ScalarType[] = [
  'int',
  'long long',
  'double',
  'bool',
  'char',
  'string',
];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

const ROOT_KEYS = [
  'title',
  'difficulty',
  'tags',
  'lists',
  'compare',
  'signature',
  'cases',
];
const FUNCTION_SIGNATURE_KEYS = ['kind', 'method', 'params', 'returns'];
const DESIGN_SIGNATURE_KEYS = ['kind', 'className', 'constructor', 'methods'];
const PARAM_KEYS = ['name', 'type'];
const METHOD_KEYS = ['name', 'params', 'returns'];
const FUNCTION_CASE_KEYS = ['input', 'expected', 'visible'];
const DESIGN_CASE_KEYS = ['ops', 'args', 'expected', 'visible'];
const CUSTOM_DESIGN_KEYS = ['ops', 'args'];

type JsonObject = Record<string, unknown>;
type Method = DesignSignature['methods'][number];

export function parseProblem(json: unknown, slug: string): Problem {
  if (!SLUG.test(slug)) {
    fail('slug', `${describe(slug)} is not lower-case words joined by "-"`);
  }
  const root = readObject(json, '', ROOT_KEYS);
  const title = readNonEmptyString(requiredField(root, 'title', ''), 'title');
  const difficulty = readChoice(
    requiredField(root, 'difficulty', ''),
    'difficulty',
    DIFFICULTIES,
  );
  const tags = readStringList(root, 'tags');
  const lists = readStringList(root, 'lists');
  const compare = Object.hasOwn(root, 'compare')
    ? readChoice(root.compare, 'compare', COMPARE_MODES)
    : 'exact';
  const signature = readSignature(
    requiredField(root, 'signature', ''),
    'signature',
  );
  const isOrderFree = compare === 'anyOrder' || compare === 'anyOrderDeep';
  if (signature.kind === 'design' && isOrderFree) {
    fail('compare', `${compare} applies to a function problem only`);
  }
  const cases = readCases(requiredField(root, 'cases', ''), signature);
  return {
    slug,
    title,
    difficulty,
    tags,
    lists,
    signature,
    compare,
    cases,
  };
}

/** Reads a C++ type as a signature may write it; null for any unsupported type. */
export function parseValueType(text: string): ValueType | null {
  const spelled = text
    .trim()
    .replace(/\s*([<>])\s*/g, '$1')
    .replace(/\s+\*/g, '*')
    .replace(/\blong\s+long\b/g, 'long long')
    .replace(/\bstd::(string|vector)\b/g, '$1');
  if (
    spelled === 'void' ||
    spelled === 'ListNode*' ||
    spelled === 'TreeNode*'
  ) {
    return spelled;
  }
  let element = spelled;
  while (element.startsWith('vector<') && element.endsWith('>')) {
    element = element.slice('vector<'.length, -1);
  }
  if (!isScalarType(element)) {
    return null;
  }
  return element === spelled ? element : (spelled as `vector<${string}>`);
}

export function vectorElement(type: ValueType): ValueType | null {
  if (!type.startsWith('vector<')) {
    return null;
  }
  return parseValueType(type.slice('vector<'.length, -1));
}

/** Reads the Testcase tab's text: a JSON array of inputs, without expected answers. */
export function parseCustomCases(
  text: string,
  signature: FunctionSignature | DesignSignature,
): CustomInput[] {
  if (text.trim() === '') {
    return [];
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    fail('', `not JSON: ${error instanceof Error ? error.message : error}`);
  }
  const items = readArray(json, '');
  return items.map((item, index): CustomInput => {
    const path = indexPath('', index);
    if (signature.kind === 'function') {
      return { input: readArgs(item, signature.params, path) };
    }
    const object = readObject(item, path, CUSTOM_DESIGN_KEYS);
    const calls = readDesignCalls(object, signature, path);
    return { ops: calls.ops, args: calls.args };
  });
}

/**
 * A custom case with `expected` read as `problem.json` reads a case's answer;
 * throws a `ProblemError` naming `expected` when it does not fit the signature.
 */
export function answeredCase(
  input: CustomInput,
  expected: unknown,
  signature: FunctionSignature | DesignSignature,
): FunctionCase | DesignCase {
  const object = { ...input, expected, visible: true };
  return signature.kind === 'function'
    ? readFunctionCase(object, signature, '')
    : readDesignCase(object, signature, '');
}

/** The `problem.json` text of a problem: every field but `slug`, 2-space indented. */
export function problemJson(problem: Problem): string {
  const file = {
    title: problem.title,
    difficulty: problem.difficulty,
    tags: problem.tags,
    lists: problem.lists,
    compare: problem.compare,
    signature: problem.signature,
    cases: problem.cases,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

function readSignature(
  value: unknown,
  path: string,
): FunctionSignature | DesignSignature {
  const object = asObject(value, path);
  const kind = readChoice(
    requiredField(object, 'kind', path),
    keyPath(path, 'kind'),
    ['function', 'design'] as const,
  );
  if (kind === 'function') {
    refuseUnknownKeys(object, path, FUNCTION_SIGNATURE_KEYS);
    return {
      kind,
      method: readName(
        requiredField(object, 'method', path),
        keyPath(path, 'method'),
      ),
      params: readParams(
        requiredField(object, 'params', path),
        keyPath(path, 'params'),
      ),
      returns: readType(
        requiredField(object, 'returns', path),
        keyPath(path, 'returns'),
        false,
      ),
    };
  }
  refuseUnknownKeys(object, path, DESIGN_SIGNATURE_KEYS);
  const className = readName(
    requiredField(object, 'className', path),
    keyPath(path, 'className'),
  );
  return {
    kind,
    className,
    constructor: readParams(
      requiredField(object, 'constructor', path),
      keyPath(path, 'constructor'),
    ),
    methods: readMethods(
      requiredField(object, 'methods', path),
      keyPath(path, 'methods'),
      className,
    ),
  };
}

function readMethods(
  value: unknown,
  path: string,
  className: string,
): Method[] {
  const seen = new Set<string>([className]);
  return readArray(value, path).map((item, index) => {
    const methodPath = indexPath(path, index);
    const object = readObject(item, methodPath, METHOD_KEYS);
    const namePath = keyPath(methodPath, 'name');
    const name = readName(requiredField(object, 'name', methodPath), namePath);
    if (seen.has(name)) {
      fail(namePath, `${describe(name)} is the class or another method's name`);
    }
    seen.add(name);
    return {
      name,
      params: readParams(
        requiredField(object, 'params', methodPath),
        keyPath(methodPath, 'params'),
      ),
      returns: readType(
        requiredField(object, 'returns', methodPath),
        keyPath(methodPath, 'returns'),
        true,
      ),
    };
  });
}

function readParams(value: unknown, path: string): Param[] {
  const seen = new Set<string>();
  return readArray(value, path).map((item, index) => {
    const paramPath = indexPath(path, index);
    const object = readObject(item, paramPath, PARAM_KEYS);
    const namePath = keyPath(paramPath, 'name');
    const name = readName(requiredField(object, 'name', paramPath), namePath);
    if (seen.has(name)) {
      fail(namePath, `duplicate param name ${describe(name)}`);
    }
    seen.add(name);
    return {
      name,
      type: readType(
        requiredField(object, 'type', paramPath),
        keyPath(paramPath, 'type'),
        false,
      ),
    };
  });
}

function readType(
  value: unknown,
  path: string,
  allowsVoid: boolean,
): ValueType {
  if (typeof value !== 'string') {
    fail(path, `expected a type name, got ${describe(value)}`);
  }
  const type = parseValueType(value);
  if (type === null) {
    fail(path, `unsupported type ${describe(value)}`);
  }
  if (type === 'void' && !allowsVoid) {
    fail(path, "void is only a design method's return type");
  }
  return type;
}

function readCases(
  value: unknown,
  signature: FunctionSignature | DesignSignature,
): (FunctionCase | DesignCase)[] {
  const items = readArray(value, 'cases');
  if (items.length === 0) {
    fail('cases', 'expected at least one case');
  }
  const cases = items.map((item, index) => {
    const path = indexPath('cases', index);
    return signature.kind === 'function'
      ? readFunctionCase(item, signature, path)
      : readDesignCase(item, signature, path);
  });
  if (!cases.some((testCase) => testCase.visible)) {
    fail('cases', 'expected at least one case with visible: true');
  }
  return cases;
}

function readFunctionCase(
  value: unknown,
  signature: FunctionSignature,
  path: string,
): FunctionCase {
  const object = readObject(value, path, FUNCTION_CASE_KEYS);
  const input = readArgs(
    requiredField(object, 'input', path),
    signature.params,
    keyPath(path, 'input'),
  );
  const expected = readValue(
    requiredField(object, 'expected', path),
    signature.returns,
    keyPath(path, 'expected'),
  );
  return { input, expected, visible: readVisible(object, path) };
}

function readDesignCase(
  value: unknown,
  signature: DesignSignature,
  path: string,
): DesignCase {
  const object = readObject(value, path, DESIGN_CASE_KEYS);
  const calls = readDesignCalls(object, signature, path);
  const expectedPath = keyPath(path, 'expected');
  const expected = readArray(
    requiredField(object, 'expected', path),
    expectedPath,
  );
  if (expected.length !== calls.ops.length) {
    fail(
      expectedPath,
      `expected ${calls.ops.length} answers (one per op), got ${expected.length}`,
    );
  }
  return {
    ops: calls.ops,
    args: calls.args,
    expected: expected.map((answer, index) =>
      readValue(answer, calls.returns[index], indexPath(expectedPath, index)),
    ),
    visible: readVisible(object, path),
  };
}

/** Reads a design case's `ops` and `args`; `returns[k]` is op k's return type, `void` for the constructor. */
function readDesignCalls(
  object: JsonObject,
  signature: DesignSignature,
  path: string,
): { ops: string[]; args: JsonValue[][]; returns: ValueType[] } {
  const opsPath = keyPath(path, 'ops');
  const argsPath = keyPath(path, 'args');
  const opItems = readArray(requiredField(object, 'ops', path), opsPath);
  const argItems = readArray(requiredField(object, 'args', path), argsPath);
  if (opItems.length === 0) {
    fail(opsPath, 'expected at least the constructor');
  }
  if (argItems.length !== opItems.length) {
    fail(
      argsPath,
      `expected ${opItems.length} argument lists (one per op), got ${argItems.length}`,
    );
  }
  const ops: string[] = [];
  const args: JsonValue[][] = [];
  const returns: ValueType[] = [];
  opItems.forEach((op, index) => {
    const opPath = indexPath(opsPath, index);
    if (typeof op !== 'string') {
      fail(opPath, `expected a method name, got ${describe(op)}`);
    }
    const isConstructor = index === 0;
    if (isConstructor && op !== signature.className) {
      fail(
        opPath,
        `expected ${describe(signature.className)}, got ${describe(op)}`,
      );
    }
    const method = isConstructor
      ? undefined
      : signature.methods.find((candidate) => candidate.name === op);
    if (!isConstructor && method === undefined) {
      fail(opPath, `no method ${describe(op)}`);
    }
    const params = method === undefined ? signature.constructor : method.params;
    ops.push(op);
    args.push(readArgs(argItems[index], params, indexPath(argsPath, index)));
    returns.push(method === undefined ? 'void' : method.returns);
  });
  return { ops, args, returns };
}

function readArgs(value: unknown, params: Param[], path: string): JsonValue[] {
  const values = readArray(value, path);
  if (values.length !== params.length) {
    fail(
      path,
      `expected ${params.length} values (one per param), got ${values.length}`,
    );
  }
  return values.map((item, index) =>
    readValue(item, params[index].type, indexPath(path, index)),
  );
}

function readVisible(object: JsonObject, path: string): boolean {
  const visible = requiredField(object, 'visible', path);
  if (typeof visible !== 'boolean') {
    fail(
      keyPath(path, 'visible'),
      `expected true or false, got ${describe(visible)}`,
    );
  }
  return visible;
}

/** A case value checked against its type, a tree's trailing nulls trimmed. */
function readValue(value: unknown, type: ValueType, path: string): JsonValue {
  checkValue(value, type, path);
  return type === 'TreeNode*' ? readTree(value as JsonValue[], path) : value;
}

/**
 * A level-order tree without its trailing nulls; throws when a value has no
 * parent node left to hang from.
 */
function readTree(values: JsonValue[], path: string): JsonValue[] {
  let end = values.length;
  while (end > 0 && values[end - 1] === null) {
    end--;
  }
  const trimmed = values.slice(0, end);
  let nodesAwaitingChildren = trimmed.length === 0 ? 0 : 1;
  for (let index = 1; index < trimmed.length; index += 2) {
    if (nodesAwaitingChildren === 0) {
      fail(path, `the tree has values past its last node at [${index}]`);
    }
    nodesAwaitingChildren--;
    const children = trimmed.slice(index, index + 2);
    nodesAwaitingChildren += children.filter((child) => child !== null).length;
  }
  return trimmed;
}

/** Checks a case value against its type, reporting the first bad element by its own path. */
function checkValue(
  value: unknown,
  type: ValueType,
  path: string,
): asserts value is JsonValue {
  const pending = [{ value, type, path }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const element = vectorElement(item.type);
    if (element === null) {
      if (!matchesNonVector(item.value, item.type)) {
        fail(item.path, `expected ${item.type}, got ${describe(item.value)}`);
      }
      continue;
    }
    if (!Array.isArray(item.value)) {
      fail(item.path, `expected ${item.type}, got ${describe(item.value)}`);
    }
    for (let index = item.value.length - 1; index >= 0; index--) {
      pending.push({
        value: item.value[index],
        type: element,
        path: indexPath(item.path, index),
      });
    }
  }
}

function matchesNonVector(value: unknown, type: ValueType): boolean {
  switch (type) {
    case 'int':
      return isInt(value);
    case 'long long':
      return Number.isSafeInteger(value);
    case 'double':
      return typeof value === 'number' && Number.isFinite(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'char':
      return (
        typeof value === 'string' &&
        value.length === 1 &&
        value.charCodeAt(0) < 128
      );
    case 'string':
      return typeof value === 'string';
    case 'ListNode*':
      return Array.isArray(value) && value.every(isInt);
    case 'TreeNode*':
      return (
        Array.isArray(value) &&
        (value.length === 0 || isInt(value[0])) &&
        value.every((node) => node === null || isInt(node))
      );
    case 'void':
      return value === null;
    default:
      return false;
  }
}

function isInt(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= INT_MIN &&
    value <= INT_MAX
  );
}

function isScalarType(text: string): text is ScalarType {
  return (SCALAR_TYPES as readonly string[]).includes(text);
}

function readObject(
  value: unknown,
  path: string,
  keys: readonly string[],
): JsonObject {
  const object = asObject(value, path);
  refuseUnknownKeys(object, path, keys);
  return object;
}

function asObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${describe(value)}`);
  }
  return value as JsonObject;
}

function refuseUnknownKeys(
  object: JsonObject,
  path: string,
  keys: readonly string[],
): void {
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) {
      fail(keyPath(path, key), 'unknown field');
    }
  }
}

function requiredField(object: JsonObject, key: string, path: string): unknown {
  if (!Object.hasOwn(object, key)) {
    fail(keyPath(path, key), 'required');
  }
  return object[key];
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(path, `expected an array, got ${describe(value)}`);
  }
  return value;
}

function readChoice<T extends string>(
  value: unknown,
  path: string,
  choices: readonly T[],
): T {
  const choice = choices.find((candidate) => candidate === value);
  if (choice === undefined) {
    fail(path, `expected one of ${choices.join(', ')}, got ${describe(value)}`);
  }
  return choice;
}

function readNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') {
    fail(path, `expected a non-empty string, got ${describe(value)}`);
  }
  return value;
}

function readStringList(object: JsonObject, key: string): string[] {
  if (!Object.hasOwn(object, key)) {
    return [];
  }
  return readArray(object[key], key).map((item, index) =>
    readNonEmptyString(item, indexPath(key, index)),
  );
}

function readName(value: unknown, path: string): string {
  if (typeof value !== 'string' || !NAME.test(value)) {
    fail(path, `expected a C++ identifier, got ${describe(value)}`);
  }
  return value;
}

function describe(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function keyPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function indexPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function fail(path: string, reason: string): never {
  throw new ProblemError(path === '' ? '(root)' : path, reason);
}
