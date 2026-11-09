import {
  vectorElement,
  type DesignSignature,
  type FunctionSignature,
  type Param,
  type Problem,
} from './problem';

const PRELUDE_HEADERS = [
  'cassert',
  'cctype',
  'cerrno',
  'cfloat',
  'climits',
  'cmath',
  'cstddef',
  'cstdint',
  'cstdio',
  'cstdlib',
  'cstring',
  'ctime',
  'algorithm',
  'any',
  'array',
  'atomic',
  'bit',
  'bitset',
  'charconv',
  'chrono',
  'compare',
  'complex',
  'concepts',
  'deque',
  'exception',
  'functional',
  'initializer_list',
  'iomanip',
  'ios',
  'iostream',
  'istream',
  'iterator',
  'limits',
  'list',
  'map',
  'memory',
  'numbers',
  'numeric',
  'optional',
  'ostream',
  'queue',
  'random',
  'ranges',
  'ratio',
  'set',
  'span',
  'sstream',
  'stack',
  'stdexcept',
  'string',
  'string_view',
  'tuple',
  'type_traits',
  'unordered_map',
  'unordered_set',
  'utility',
  'valarray',
  'variant',
  'vector',
];

const LEETCODE_TYPES = `struct ListNode {
    int val;
    ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
};

struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};
`;

const JSON_SUPPORT = String.raw`extern "C" const char* __asan_default_options() { return "detect_leaks=0"; }
extern "C" const char* __ubsan_default_options() { return "halt_on_error=1:print_stacktrace=1"; }

namespace practice_judge {

struct Json {
    enum class Kind { Null, Bool, Number, String, Array };
    Kind kind = Kind::Null;
    bool boolean = false;
    std::string text;
    std::vector<Json> items;
};

class JsonReader {
public:
    explicit JsonReader(const std::string& source) : source_(source) {}

    Json read_document() {
        Json value = read_value();
        skip_space();
        if (pos_ != source_.size()) {
            fail("trailing text");
        }
        return value;
    }

private:
    const std::string& source_;
    std::size_t pos_ = 0;

    [[noreturn]] void fail(const char* what) const {
        throw std::runtime_error(std::string("cases file: ") + what + " at offset " + std::to_string(pos_));
    }

    bool at_end() const { return pos_ >= source_.size(); }

    void skip_space() {
        while (!at_end() && (source_[pos_] == ' ' || source_[pos_] == '\t' || source_[pos_] == '\n' || source_[pos_] == '\r')) {
            ++pos_;
        }
    }

    bool consume(const char* word) {
        std::size_t length = std::strlen(word);
        if (source_.compare(pos_, length, word) != 0) {
            return false;
        }
        pos_ += length;
        return true;
    }

    void skip_digits() {
        while (!at_end() && std::isdigit(static_cast<unsigned char>(source_[pos_]))) {
            ++pos_;
        }
    }

    Json read_value() {
        skip_space();
        if (at_end()) {
            fail("unexpected end");
        }
        Json value;
        char first = source_[pos_];
        if (first == 'n') {
            if (!consume("null")) {
                fail("bad literal");
            }
            return value;
        }
        if (first == 't' || first == 'f') {
            value.kind = Json::Kind::Bool;
            value.boolean = consume("true");
            if (!value.boolean && !consume("false")) {
                fail("bad literal");
            }
            return value;
        }
        if (first == '"') {
            value.kind = Json::Kind::String;
            value.text = read_string();
            return value;
        }
        if (first == '[') {
            value.kind = Json::Kind::Array;
            ++pos_;
            skip_space();
            if (!at_end() && source_[pos_] == ']') {
                ++pos_;
                return value;
            }
            for (;;) {
                value.items.push_back(read_value());
                skip_space();
                if (at_end()) {
                    fail("unterminated array");
                }
                char separator = source_[pos_++];
                if (separator == ']') {
                    return value;
                }
                if (separator != ',') {
                    fail("expected , or ]");
                }
            }
        }
        if (first == '-' || std::isdigit(static_cast<unsigned char>(first))) {
            value.kind = Json::Kind::Number;
            std::size_t start = pos_;
            if (first == '-') {
                ++pos_;
            }
            skip_digits();
            if (!at_end() && source_[pos_] == '.') {
                ++pos_;
                skip_digits();
            }
            if (!at_end() && (source_[pos_] == 'e' || source_[pos_] == 'E')) {
                ++pos_;
                if (!at_end() && (source_[pos_] == '+' || source_[pos_] == '-')) {
                    ++pos_;
                }
                skip_digits();
            }
            value.text = source_.substr(start, pos_ - start);
            return value;
        }
        fail("unexpected character");
    }

    std::uint32_t read_hex4() {
        if (pos_ + 4 > source_.size()) {
            fail("short \\u escape");
        }
        std::uint32_t code = 0;
        for (int i = 0; i < 4; ++i) {
            char digit = source_[pos_++];
            code <<= 4;
            if (digit >= '0' && digit <= '9') {
                code |= static_cast<std::uint32_t>(digit - '0');
            } else if (digit >= 'a' && digit <= 'f') {
                code |= static_cast<std::uint32_t>(digit - 'a' + 10);
            } else if (digit >= 'A' && digit <= 'F') {
                code |= static_cast<std::uint32_t>(digit - 'A' + 10);
            } else {
                fail("bad \\u escape");
            }
        }
        return code;
    }

    static void append_utf8(std::string& out, std::uint32_t code) {
        if (code < 0x80) {
            out += static_cast<char>(code);
        } else if (code < 0x800) {
            out += static_cast<char>(0xC0 | (code >> 6));
            out += static_cast<char>(0x80 | (code & 0x3F));
        } else if (code < 0x10000) {
            out += static_cast<char>(0xE0 | (code >> 12));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (code >> 18));
            out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
        }
    }

    std::string read_string() {
        ++pos_;
        std::string out;
        for (;;) {
            if (at_end()) {
                fail("unterminated string");
            }
            char c = source_[pos_++];
            if (c == '"') {
                return out;
            }
            if (c != '\\') {
                out += c;
                continue;
            }
            if (at_end()) {
                fail("unterminated string");
            }
            char escape = source_[pos_++];
            switch (escape) {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u': {
                    std::uint32_t code = read_hex4();
                    bool is_high_surrogate = code >= 0xD800 && code <= 0xDBFF;
                    if (is_high_surrogate && consume("\\u")) {
                        std::uint32_t low = read_hex4();
                        if (low >= 0xDC00 && low <= 0xDFFF) {
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                        } else {
                            append_utf8(out, code);
                            code = low;
                        }
                    }
                    append_utf8(out, code);
                    break;
                }
                default:
                    fail("bad escape");
            }
        }
    }
};

inline const Json& expect_kind(const Json& json, Json::Kind kind, const char* what) {
    if (json.kind != kind) {
        throw std::runtime_error(std::string("cases file: expected ") + what);
    }
    return json;
}

inline const Json& element(const Json& array, std::size_t index) {
    return expect_kind(array, Json::Kind::Array, "an array").items.at(index);
}

inline int int_of(const Json& json) {
    return static_cast<int>(std::strtoll(expect_kind(json, Json::Kind::Number, "a number").text.c_str(), nullptr, 10));
}

void from_json(const Json& json, int& value);
void from_json(const Json& json, long long& value);
void from_json(const Json& json, double& value);
void from_json(const Json& json, bool& value);
void from_json(const Json& json, char& value);
void from_json(const Json& json, std::string& value);
void from_json(const Json& json, ListNode*& value);
void from_json(const Json& json, TreeNode*& value);
template <typename T>
void from_json(const Json& json, std::vector<T>& value);

void to_json(std::string& out, int value);
void to_json(std::string& out, long long value);
void to_json(std::string& out, double value);
void to_json(std::string& out, bool value);
void to_json(std::string& out, char value);
void to_json(std::string& out, const std::string& value);
void to_json(std::string& out, ListNode* value);
void to_json(std::string& out, TreeNode* value);
template <typename T>
void to_json(std::string& out, const std::vector<T>& value);

void from_json(const Json& json, int& value) {
    value = int_of(json);
}

void from_json(const Json& json, long long& value) {
    value = std::strtoll(expect_kind(json, Json::Kind::Number, "a number").text.c_str(), nullptr, 10);
}

void from_json(const Json& json, double& value) {
    value = std::strtod(expect_kind(json, Json::Kind::Number, "a number").text.c_str(), nullptr);
}

void from_json(const Json& json, bool& value) {
    value = expect_kind(json, Json::Kind::Bool, "true or false").boolean;
}

void from_json(const Json& json, char& value) {
    const std::string& text = expect_kind(json, Json::Kind::String, "a string").text;
    value = text.empty() ? '\0' : text[0];
}

void from_json(const Json& json, std::string& value) {
    value = expect_kind(json, Json::Kind::String, "a string").text;
}

void from_json(const Json& json, ListNode*& value) {
    const Json& array = expect_kind(json, Json::Kind::Array, "an array");
    ListNode* head = nullptr;
    ListNode** tail = &head;
    for (const Json& item : array.items) {
        *tail = new ListNode(int_of(item));
        tail = &(*tail)->next;
    }
    value = head;
}

void from_json(const Json& json, TreeNode*& value) {
    const Json& array = expect_kind(json, Json::Kind::Array, "an array");
    value = nullptr;
    if (array.items.empty()) {
        return;
    }
    value = new TreeNode(int_of(array.items[0]));
    std::queue<TreeNode*> parents;
    parents.push(value);
    std::size_t index = 1;
    while (index < array.items.size()) {
        if (parents.empty()) {
            throw std::runtime_error("cases file: tree has values past its last node");
        }
        TreeNode* parent = parents.front();
        parents.pop();
        if (array.items[index].kind != Json::Kind::Null) {
            parent->left = new TreeNode(int_of(array.items[index]));
            parents.push(parent->left);
        }
        ++index;
        if (index < array.items.size() && array.items[index].kind != Json::Kind::Null) {
            parent->right = new TreeNode(int_of(array.items[index]));
            parents.push(parent->right);
        }
        ++index;
    }
}

template <typename T>
void from_json(const Json& json, std::vector<T>& value) {
    const Json& array = expect_kind(json, Json::Kind::Array, "an array");
    value.clear();
    for (const Json& item : array.items) {
        T element{};
        from_json(item, element);
        value.push_back(std::move(element));
    }
}

void to_json(std::string& out, int value) {
    out += std::to_string(value);
}

void to_json(std::string& out, long long value) {
    out += std::to_string(value);
}

void to_json(std::string& out, double value) {
    if (!std::isfinite(value)) {
        out += "null";
        return;
    }
    char buffer[64];
    std::to_chars_result result = std::to_chars(buffer, buffer + sizeof buffer, value);
    out.append(buffer, result.ptr);
}

void to_json(std::string& out, bool value) {
    out += value ? "true" : "false";
}

void to_json(std::string& out, char value) {
    to_json(out, std::string(1, value));
}

void to_json(std::string& out, const std::string& value) {
    out += '"';
    for (char c : value) {
        unsigned char byte = static_cast<unsigned char>(c);
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            default:
                if (byte < 0x20) {
                    char escaped[8];
                    std::snprintf(escaped, sizeof escaped, "\\u%04x", static_cast<unsigned>(byte));
                    out += escaped;
                } else {
                    out += c;
                }
        }
    }
    out += '"';
}

void to_json(std::string& out, ListNode* value) {
    out += '[';
    for (ListNode* node = value; node != nullptr; node = node->next) {
        if (node != value) {
            out += ',';
        }
        to_json(out, node->val);
    }
    out += ']';
}

void to_json(std::string& out, TreeNode* value) {
    std::vector<TreeNode*> slots;
    if (value != nullptr) {
        slots.push_back(value);
    }
    for (std::size_t index = 0; index < slots.size(); ++index) {
        if (slots[index] != nullptr) {
            slots.push_back(slots[index]->left);
            slots.push_back(slots[index]->right);
        }
    }
    while (!slots.empty() && slots.back() == nullptr) {
        slots.pop_back();
    }
    out += '[';
    for (std::size_t index = 0; index < slots.size(); ++index) {
        if (index > 0) {
            out += ',';
        }
        if (slots[index] == nullptr) {
            out += "null";
        } else {
            to_json(out, slots[index]->val);
        }
    }
    out += ']';
}

template <typename T>
void to_json(std::string& out, const std::vector<T>& value) {
    out += '[';
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (index > 0) {
            out += ',';
        }
        to_json(out, static_cast<T>(value[index]));
    }
    out += ']';
}

std::string read_file(const char* path) {
    std::FILE* file = std::fopen(path, "rb");
    if (file == nullptr) {
        throw std::runtime_error(std::string("cannot open ") + path);
    }
    std::string text;
    char buffer[65536];
    std::size_t count;
    while ((count = std::fread(buffer, 1, sizeof buffer, file)) > 0) {
        text.append(buffer, count);
    }
    std::fclose(file);
    return text;
}

void write_file(const char* path, const std::string& text) {
    std::FILE* file = std::fopen(path, "wb");
    if (file == nullptr) {
        throw std::runtime_error(std::string("cannot write ") + path);
    }
    std::size_t written = std::fwrite(text.data(), 1, text.size(), file);
    bool closed = std::fclose(file) == 0;
    if (written != text.size() || !closed) {
        throw std::runtime_error(std::string("cannot write ") + path);
    }
}

}  // namespace practice_judge
`;

const JUDGE = 'practice_judge::';

/** The `prelude.h` every solution compiles against: the standard headers, `using namespace std;`, LeetCode's node types. */
export function preludeSource(): string {
  const includes = PRELUDE_HEADERS.map((header) => `#include <${header}>`);
  return [
    '#pragma once',
    '',
    ...includes,
    '',
    'using namespace std;',
    '',
    LEETCODE_TYPES,
  ].join('\n');
}

/** The C++ driver that runs one case of a problem against the solution at `solutionPath`. */
export function driverSource(problem: Problem, solutionPath: string): string {
  const signature = problem.signature;
  const body =
    signature.kind === 'function'
      ? functionCaseBody(signature)
      : designCaseBody(signature);
  return [
    '#include "prelude.h"',
    '',
    JSON_SUPPORT,
    includeLine(solutionPath),
    '',
    'int main(int argc, char** argv) {',
    '    if (argc != 4) {',
    '        return 2;',
    '    }',
    `    const ${JUDGE}Json cases = ${JUDGE}JsonReader(${JUDGE}read_file(argv[1])).read_document();`,
    `    const ${JUDGE}Json& item = ${JUDGE}element(cases, std::stoul(argv[2]));`,
    '    std::string out;',
    ...body,
    `    ${JUDGE}write_file(argv[3], out);`,
    '    return 0;',
    '}',
    '',
  ].join('\n');
}

/** LeetCode's starting code for a problem: the class with empty member bodies. */
export function stubSource(problem: Problem): string {
  const signature = problem.signature;
  const members =
    signature.kind === 'function'
      ? [
          stubMember(
            `${signature.returns} ${signature.method}`,
            signature.params,
          ),
        ]
      : [
          stubMember(signature.className, signature.constructor),
          ...signature.methods.map((method) =>
            stubMember(`${method.returns} ${method.name}`, method.params),
          ),
        ];
  const className =
    signature.kind === 'function' ? 'Solution' : signature.className;
  return [
    `class ${className} {`,
    'public:',
    members.join('\n    \n'),
    '};',
    '',
  ].join('\n');
}

function stubMember(head: string, params: Param[]): string {
  const paramList = params
    .map((param) =>
      vectorElement(param.type) !== null
        ? `${param.type}& ${param.name}`
        : `${param.type} ${param.name}`,
    )
    .join(', ');
  return [`    ${head}(${paramList}) {`, '        ', '    }'].join('\n');
}

function functionCaseBody(signature: FunctionSignature): string[] {
  const locals = readParamsInto(signature.params, 'item', 'p', '    ');
  const callArgs = signature.params.map((_, index) => `p${index}`).join(', ');
  return [
    ...locals,
    '    Solution* solution = new Solution();',
    `    ${signature.returns} result = solution->${signature.method}(${callArgs});`,
    `    ${JUDGE}to_json(out, result);`,
  ];
}

function designCaseBody(signature: DesignSignature): string[] {
  const constructorArgs = signature.constructor
    .map((_, index) => `c${index}`)
    .join(', ');
  const branches = signature.methods.map((method) => {
    const callArgs = method.params.map((_, index) => `p${index}`).join(', ');
    const call = `object->${method.name}(${callArgs})`;
    const answer =
      method.returns === 'void'
        ? [`            ${call};`, '            out += "null";']
        : [
            `            ${method.returns} result = ${call};`,
            `            ${JUDGE}to_json(out, result);`,
          ];
    return [
      `if (op == "${method.name}") {`,
      ...readParamsInto(method.params, 'call', 'p', '            '),
      ...answer,
      '        }',
    ].join('\n');
  });
  const unknownOp = [
    '{',
    '            throw std::runtime_error("no method " + op);',
    '        }',
  ].join('\n');
  return [
    `    const ${JUDGE}Json& ops = ${JUDGE}element(item, 0);`,
    `    const ${JUDGE}Json& args = ${JUDGE}element(item, 1);`,
    `    const ${JUDGE}Json& constructor_args = ${JUDGE}element(args, 0);`,
    ...readParamsInto(signature.constructor, 'constructor_args', 'c', '    '),
    `    ${signature.className}* object = new ${signature.className}(${constructorArgs});`,
    '    out += "[null";',
    `    for (std::size_t k = 1; k < ops.items.size(); ++k) {`,
    `        const std::string& op = ${JUDGE}element(ops, k).text;`,
    `        const ${JUDGE}Json& call = ${JUDGE}element(args, k);`,
    "        out += ',';",
    `        ${[...branches, unknownOp].join(' else ')}`,
    '    }',
    "    out += ']';",
  ];
}

/** Declares one local per param, named `<prefix><index>`, read from the array `source`. */
function readParamsInto(
  params: Param[],
  source: string,
  prefix: string,
  indent: string,
): string[] {
  return params.flatMap((param, index) => [
    `${indent}${param.type} ${prefix}${index}{};`,
    `${indent}${JUDGE}from_json(${JUDGE}element(${source}, ${index}), ${prefix}${index});`,
  ]);
}

/** clang reads an `#include "…"` path verbatim, with no escapes, so a `"` or line break cannot be written. */
function includeLine(path: string): string {
  if (/["\n\r]/.test(path)) {
    throw new Error(
      `driverSource: cannot #include a path holding a quote or line break: ${path}`,
    );
  }
  return `#include "${path}"`;
}
