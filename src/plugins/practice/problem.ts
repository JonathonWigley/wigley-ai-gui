export type Difficulty = 'easy' | 'medium' | 'hard';

export type CompareMode = 'exact' | 'anyOrder' | 'anyOrderDeep' | 'float';

export type ScalarType =
  | 'int'
  | 'long long'
  | 'double'
  | 'bool'
  | 'char'
  | 'string';

/** A pointer to one of the prelude's node structs. */
export type NodeType = 'ListNode*' | 'TreeNode*' | 'GraphNode*' | 'RandomNode*';

/** The node types a solution spells `Node*`: the driver aliases the one a problem uses. */
export type AliasedNodeType = 'GraphNode*' | 'RandomNode*';

/** A supported C++ type, always in its canonical spelling (see `parseValueType`). */
export type ValueType = ScalarType | NodeType | 'void' | `vector<${string}>`;

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

/** A class whose `decode(encode(x))` must give back `x`, with the encoded value a string. */
export interface CodecSignature {
  kind: 'codec';
  className: string;
  encode: string;
  decode: string;
  type: ValueType;
}

export type Signature = FunctionSignature | DesignSignature | CodecSignature;

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

/** A codec case's answer is its own `input`: the value must come back unchanged. */
export interface CodecCase {
  input: JsonValue;
  visible: boolean;
}

export type Case = FunctionCase | DesignCase | CodecCase;

/** The answer a case expects: a codec case's is its own input. */
export function expectedAnswer(testCase: Case): JsonValue {
  return 'expected' in testCase ? testCase.expected : testCase.input;
}

export interface Problem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  lists: string[];
  signature: Signature;
  compare: CompareMode;
  cases: Case[];
}

export type CustomInput =
  | { input: JsonValue[] }
  | { ops: string[]; args: JsonValue[][] }
  | { value: JsonValue };

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
const CODEC_SIGNATURE_KEYS = ['kind', 'className', 'encode', 'decode', 'type'];
const PARAM_KEYS = ['name', 'type'];
const METHOD_KEYS = ['name', 'params', 'returns'];
const FUNCTION_CASE_KEYS = ['input', 'expected', 'visible'];
const DESIGN_CASE_KEYS = ['ops', 'args', 'expected', 'visible'];
const CODEC_CASE_KEYS = ['input', 'visible'];
const CUSTOM_DESIGN_KEYS = ['ops', 'args'];
const CYCLIC_LIST_KEYS = ['values', 'pos'];
const NODE_TYPES: readonly NodeType[] = [
  'ListNode*',
  'TreeNode*',
  'GraphNode*',
  'RandomNode*',
];
const VECTOR_NODE_TYPES: readonly NodeType[] = ['ListNode*', 'TreeNode*'];
const ALIASED_NODE_TYPES: readonly AliasedNodeType[] = [
  'GraphNode*',
  'RandomNode*',
];

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
  if (signature.kind === 'codec' && compare !== 'exact') {
    fail('compare', 'a codec problem compares exactly');
  }
  const aliased = ALIASED_NODE_TYPES.filter((type) =>
    signatureTypes(signature).includes(type),
  );
  if (aliased.length > 1) {
    fail(
      'signature',
      `uses both ${aliased.join(' and ')}; a solution spells each Node*, so a problem uses one`,
    );
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
  if (spelled === 'void' || isNodeType(spelled)) {
    return spelled;
  }
  let element = spelled;
  while (element.startsWith('vector<') && element.endsWith('>')) {
    element = element.slice('vector<'.length, -1);
  }
  if (element === spelled) {
    return isScalarType(element) ? element : null;
  }
  const isVectorElement =
    isScalarType(element) ||
    (VECTOR_NODE_TYPES as readonly string[]).includes(element);
  return isVectorElement ? (spelled as `vector<${string}>`) : null;
}

/** The node type a problem's solution spells `Node*`, or null when it uses none. */
export function aliasedNodeType(signature: Signature): AliasedNodeType | null {
  const types = signatureTypes(signature);
  return ALIASED_NODE_TYPES.find((type) => types.includes(type)) ?? null;
}

/** Every type a signature names: params, returns, and a codec's value type. */
function signatureTypes(signature: Signature): ValueType[] {
  switch (signature.kind) {
    case 'function':
      return [
        ...signature.params.map((param) => param.type),
        signature.returns,
      ];
    case 'design':
      return [
        ...signature.constructor.map((param) => param.type),
        ...signature.methods.flatMap((method) => [
          ...method.params.map((param) => param.type),
          method.returns,
        ]),
      ];
    case 'codec':
      return [signature.type];
  }
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
  signature: Signature,
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
    switch (signature.kind) {
      case 'function':
        return { input: readArgs(item, signature.params, path) };
      case 'design': {
        const object = readObject(item, path, CUSTOM_DESIGN_KEYS);
        const calls = readDesignCalls(object, signature, path);
        return { ops: calls.ops, args: calls.args };
      }
      case 'codec':
        return { value: readValue(item, signature.type, path, false) };
    }
  });
}

/**
 * A custom function or design case with `expected` read as `problem.json`
 * reads a case's answer; throws a `ProblemError` naming `expected` when it does
 * not fit the signature.
 */
export function answeredCase(
  input: Exclude<CustomInput, { value: JsonValue }>,
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

function readSignature(value: unknown, path: string): Signature {
  const object = asObject(value, path);
  const kind = readChoice(
    requiredField(object, 'kind', path),
    keyPath(path, 'kind'),
    ['function', 'design', 'codec'] as const,
  );
  if (kind === 'codec') {
    refuseUnknownKeys(object, path, CODEC_SIGNATURE_KEYS);
    return readCodecSignature(object, path);
  }
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

function readCodecSignature(object: JsonObject, path: string): CodecSignature {
  const className = readName(
    requiredField(object, 'className', path),
    keyPath(path, 'className'),
  );
  const encode = readName(
    requiredField(object, 'encode', path),
    keyPath(path, 'encode'),
  );
  const decode = readName(
    requiredField(object, 'decode', path),
    keyPath(path, 'decode'),
  );
  if (encode === className || decode === className || encode === decode) {
    fail(path, 'className, encode and decode must be three different names');
  }
  return {
    kind: 'codec',
    className,
    encode,
    decode,
    type: readType(
      requiredField(object, 'type', path),
      keyPath(path, 'type'),
      false,
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

function readCases(value: unknown, signature: Signature): Case[] {
  const items = readArray(value, 'cases');
  if (items.length === 0) {
    fail('cases', 'expected at least one case');
  }
  const cases = items.map((item, index): Case => {
    const path = indexPath('cases', index);
    switch (signature.kind) {
      case 'function':
        return readFunctionCase(item, signature, path);
      case 'design':
        return readDesignCase(item, signature, path);
      case 'codec':
        return readCodecCase(item, signature, path);
    }
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
    false,
  );
  return { input, expected, visible: readVisible(object, path) };
}

function readCodecCase(
  value: unknown,
  signature: CodecSignature,
  path: string,
): CodecCase {
  const object = readObject(value, path, CODEC_CASE_KEYS);
  const input = readValue(
    requiredField(object, 'input', path),
    signature.type,
    keyPath(path, 'input'),
    false,
  );
  return { input, visible: readVisible(object, path) };
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
      readValue(
        answer,
        calls.returns[index],
        indexPath(expectedPath, index),
        false,
      ),
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
    readValue(item, params[index].type, indexPath(path, index), true),
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

/**
 * A case value checked against its type, every tree's trailing nulls trimmed.
 * `allowsCycle` admits a `ListNode*` written `{"values": [...], "pos": k}`,
 * which only an input can be: the driver writes every answer as a plain list.
 */
function readValue(
  value: unknown,
  type: ValueType,
  path: string,
  allowsCycle: boolean,
): JsonValue {
  checkValue(value, type, path, allowsCycle);
  return trimmedTrees(value, type, path);
}

function trimmedTrees(
  value: JsonValue,
  type: ValueType,
  path: string,
): JsonValue {
  if (type === 'TreeNode*') {
    return readTree(value as JsonValue[], path);
  }
  const element = vectorElement(type);
  if (element === null) {
    return value;
  }
  return (value as JsonValue[]).map((item, index) =>
    trimmedTrees(item, element, indexPath(path, index)),
  );
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
  allowsCycle: boolean,
): asserts value is JsonValue {
  const pending = [{ value, type, path }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const element = vectorElement(item.type);
    if (element === null) {
      if (!matchesNonVector(item.value, item.type, allowsCycle)) {
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

function matchesNonVector(
  value: unknown,
  type: ValueType,
  allowsCycle: boolean,
): boolean {
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
      return isIntList(value) || (allowsCycle && isCyclicList(value));
    case 'TreeNode*':
      return (
        Array.isArray(value) &&
        (value.length === 0 || isInt(value[0])) &&
        value.every((node) => node === null || isInt(node))
      );
    case 'GraphNode*':
      return isAdjacencyList(value);
    case 'RandomNode*':
      return isRandomList(value);
    case 'void':
      return value === null;
    default:
      return false;
  }
}

function isIntList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isInt);
}

/** `{"values": [...], "pos": k}`: the tail links back to node `k`, none when `k` is -1. */
function isCyclicList(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const object = value as JsonObject;
  const hasOnlyListKeys = Object.keys(object).every((key) =>
    CYCLIC_LIST_KEYS.includes(key),
  );
  const values = object.values;
  const pos = object.pos;
  return (
    hasOnlyListKeys &&
    isIntList(values) &&
    typeof pos === 'number' &&
    Number.isInteger(pos) &&
    pos >= -1 &&
    pos < values.length
  );
}

/** LeetCode's graph: entry `i` lists the values of node `i + 1`'s neighbours, each in 1..n. */
function isAdjacencyList(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const count = value.length;
  return value.every(
    (neighbours) =>
      isIntList(neighbours) &&
      neighbours.every((node) => node >= 1 && node <= count),
  );
}

/** LeetCode's random list: one `[val, randomIndex]` per node, the index null or in 0..n-1. */
function isRandomList(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const count = value.length;
  return value.every((node) => {
    if (!Array.isArray(node) || node.length !== 2 || !isInt(node[0])) {
      return false;
    }
    const random: unknown = node[1];
    return (
      random === null ||
      (isInt(random) && (random as number) >= 0 && (random as number) < count)
    );
  });
}

function isNodeType(text: string): text is NodeType {
  return (NODE_TYPES as readonly string[]).includes(text);
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
