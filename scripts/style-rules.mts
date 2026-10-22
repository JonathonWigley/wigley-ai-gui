// The style rules `check-styles.mts` enforces (`DESIGN.md` § Checks): no raw
// colour, length, duration or font stack in CSS or inline styles, and
// `backdrop-filter` only where the caller allows it. Pure functions over text,
// so the rules and the argument reading are tested without walking `src/`.
import ts from 'typescript';

export type StyleRule =
  | 'raw-colour'
  | 'raw-length'
  | 'raw-duration'
  | 'font-stack'
  | 'backdrop-filter';

export interface StyleViolation {
  line: number;
  rule: StyleRule;
  text: string;
}

// The 148 named colours of CSS Color 4.
const NAMED_COLOURS = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
];

const COMMENT = /\/\*[\s\S]*?\*\//g;
const QUOTED_STRING = /"[^"\n]*"|'[^'\n]*'/g;
const URL_ARGUMENT = /url\([^)]*\)/gi;
const DECLARATION = /([-\w]+)\s*:\s*([^;{}]+?)\s*(?=[;}])/dg;
const CUSTOM_PROPERTY_NAME = /--[\w-]+/g;

const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/g;
const COLOUR_FUNCTION = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const NAMED_COLOUR = new RegExp(
  `(?<![\\w-])(${NAMED_COLOURS.join('|')})(?![\\w-])`,
  'gi',
);
const COLOUR_PROPERTY =
  /^(color|background(-color)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|(box|text)-shadow|text-decoration(-color)?|caret-color|accent-color|fill|stroke|column-rule(-color)?|scrollbar-color|--.*)$/;
const LENGTH =
  /(?<![\w.#-])-?(\d*\.)?\d+(px|rem|em|ex|ch|ic|lh|rlh|cap|pt|pc|cm|mm|q|in)\b/gi;
const DURATION = /(?<![\w.#-])-?(\d*\.)?\d+(ms|s)\b/gi;
const FONT_PROPERTIES = new Set(['font-family', 'font']);
const BACKDROP_FILTER_PROPERTIES = new Set([
  'backdrop-filter',
  '-webkit-backdrop-filter',
]);

// Each match's position in the value, so a declaration's violations sort into
// source order.
interface PlacedMatch {
  index: number;
  rule: StyleRule;
  match: string;
}

function blankKeepingNewlines(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

// The CSS with comments blanked, and a copy with quoted strings and `url(…)`
// arguments blanked too, both the same length so one offset reads either.
function readableCss(css: string): { written: string; judged: string } {
  const written = css.replace(COMMENT, blankKeepingNewlines);
  const judged = written
    .replace(
      QUOTED_STRING,
      (text) => `${text[0]}${' '.repeat(text.length - 2)}${text[0]}`,
    )
    .replace(
      URL_ARGUMENT,
      (text) => `url(${blankKeepingNewlines(text.slice(4, -1))})`,
    );
  return { written, judged };
}

function matchesOf(
  pattern: RegExp,
  value: string,
  rule: StyleRule,
  isAllowed: (match: RegExpExecArray) => boolean = () => false,
): PlacedMatch[] {
  return [...value.matchAll(pattern)]
    .filter((match) => !isAllowed(match))
    .map((match) => ({ index: match.index, rule, match: match[0] }));
}

function isZero(match: RegExpExecArray): boolean {
  return Number.parseFloat(match[0]) === 0;
}

function isZeroOrHairline(match: RegExpExecArray): boolean {
  const isHairline =
    Math.abs(Number.parseFloat(match[0])) === 1 &&
    match[2].toLowerCase() === 'px';
  return isZero(match) || isHairline;
}

function valueMatches(
  property: string,
  value: string,
  allowsBackdropFilter: boolean,
): PlacedMatch[] {
  const judged = value.replace(CUSTOM_PROPERTY_NAME, '--x');
  const withoutHex = judged.replace(HEX_COLOUR, blankKeepingNewlines);
  const isColourProperty = COLOUR_PROPERTY.test(property);
  const isFontStack = FONT_PROPERTIES.has(property) && judged.includes(',');
  const isForbiddenBackdropFilter =
    BACKDROP_FILTER_PROPERTIES.has(property) && !allowsBackdropFilter;
  const matches: PlacedMatch[] = [
    ...matchesOf(HEX_COLOUR, judged, 'raw-colour'),
    ...matchesOf(COLOUR_FUNCTION, judged, 'raw-colour'),
    ...(isColourProperty ? matchesOf(NAMED_COLOUR, judged, 'raw-colour') : []),
    ...matchesOf(LENGTH, withoutHex, 'raw-length', isZeroOrHairline),
    ...matchesOf(DURATION, withoutHex, 'raw-duration', isZero),
  ];
  if (isFontStack) {
    matches.push({ index: -1, rule: 'font-stack', match: property });
  }
  if (isForbiddenBackdropFilter) {
    matches.push({ index: -1, rule: 'backdrop-filter', match: property });
  }
  return matches.sort((a, b) => a.index - b.index);
}

function newlinesIn(text: string, start: number, end: number): number {
  let newlines = 0;
  for (let index = start; index < end; index++) {
    if (text[index] === '\n') {
      newlines++;
    }
  }
  return newlines;
}

export function cssViolations(
  css: string,
  allowsBackdropFilter: boolean,
): StyleViolation[] {
  const { written, judged } = readableCss(css);
  const violations: StyleViolation[] = [];
  // Declarations come in source order, so the line count carries forward.
  let line = 1;
  let counted = 0;
  for (const declaration of judged.matchAll(DECLARATION)) {
    const property = declaration[1].toLowerCase();
    const [valueStart, valueEnd] = declaration.indices![2]!;
    const writtenValue = written.slice(valueStart, valueEnd);
    line += newlinesIn(judged, counted, valueStart);
    counted = valueStart;
    for (const { rule, match } of valueMatches(
      property,
      declaration[2],
      allowsBackdropFilter,
    )) {
      const text = `${match} in ${declaration[1]}: ${writtenValue}`;
      violations.push({ line, rule, text });
    }
  }
  return violations;
}

// `paddingLeft` → `padding-left`; a vendor prefix (`webkitBackdropFilter`)
// gains its leading dash.
function kebabCase(property: string): string {
  const kebab = property.replace(
    /[A-Z]/g,
    (letter) => `-${letter.toLowerCase()}`,
  );
  return /^(webkit|moz|ms)-/.test(kebab) ? `-${kebab}` : kebab;
}

// The text a style value holds: a literal's text, or a template's literal
// parts joined by `9`, so a substitution followed by a unit reads as a raw
// length; undefined for any other expression.
function styleValueText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text),
    ].join('9');
  }
  return undefined;
}

function isStyleAccess(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === 'style';
}

function isStringLiteralLike(
  node: ts.Node | undefined,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  );
}

// A judged inline style write: the CSS it amounts to and the node holding its
// value.
interface StyleWrite {
  css: (value: string) => string;
  valueNode: ts.Node;
}

const declarationList = (value: string) => `${value};`;

function assignmentWrite(node: ts.BinaryExpression): StyleWrite | undefined {
  const target = node.left;
  if (!ts.isPropertyAccessExpression(target)) {
    return undefined;
  }
  if (isStyleAccess(target)) {
    return { css: declarationList, valueNode: node.right };
  }
  if (!isStyleAccess(target.expression)) {
    return undefined;
  }
  const property = target.name.text;
  if (property === 'cssText') {
    return { css: declarationList, valueNode: node.right };
  }
  return {
    css: (value) => `${kebabCase(property)}: ${value};`,
    valueNode: node.right,
  };
}

function callWrite(node: ts.CallExpression): StyleWrite | undefined {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) {
    return undefined;
  }
  const [name, value] = node.arguments;
  if (!isStringLiteralLike(name) || value === undefined) {
    return undefined;
  }
  const isStandardSetProperty =
    callee.name.text === 'setProperty' &&
    isStyleAccess(callee.expression) &&
    !name.text.startsWith('--');
  if (isStandardSetProperty) {
    return { css: (text) => `${name.text}: ${text};`, valueNode: value };
  }
  const isStyleAttribute =
    callee.name.text === 'setAttribute' && name.text === 'style';
  if (isStyleAttribute) {
    return { css: declarationList, valueNode: value };
  }
  return undefined;
}

function styleWriteOf(node: ts.Node): StyleWrite | undefined {
  const isAssignment =
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  if (isAssignment) {
    return assignmentWrite(node);
  }
  if (ts.isCallExpression(node)) {
    return callWrite(node);
  }
  return undefined;
}

export function inlineStyleViolations(
  fileName: string,
  source: string,
): StyleViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const violations: StyleViolation[] = [];
  const pending: ts.Node[] = [sourceFile];
  while (pending.length > 0) {
    const node = pending.pop()!;
    const write = styleWriteOf(node);
    const value = write && styleValueText(write.valueNode);
    if (write && value !== undefined) {
      const start = write.valueNode.getStart(sourceFile);
      const line = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
      for (const violation of cssViolations(write.css(value), false)) {
        violations.push({ ...violation, line });
      }
    }
    // Pushed in reverse so they pop in source order.
    pending.push(...[...node.getChildren(sourceFile)].reverse());
  }
  return violations;
}

// Every argument is unknown: the check always judges every file, so a stale
// flag fails instead of running as a plain check.
export function argumentFailures(args: readonly string[]): string[] {
  return args.map((arg) => `check-styles: unknown argument ${arg}`);
}
