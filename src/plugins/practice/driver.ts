import {
  aliasedNodeType,
  vectorElement,
  type CodecSignature,
  type DesignSignature,
  type FunctionSignature,
  type Param,
  type Problem,
  type Signature,
  type ValueType,
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

struct GraphNode {
    int val;
    vector<GraphNode*> neighbors;
    GraphNode() : val(0) {}
    GraphNode(int _val) : val(_val) {}
    GraphNode(int _val, vector<GraphNode*> _neighbors) : val(_val), neighbors(_neighbors) {}
};

struct RandomNode {
    int val;
    RandomNode* next;
    RandomNode* random;
    RandomNode(int _val) : val(_val), next(nullptr), random(nullptr) {}
};
`;

const JSON_SUPPORT = String.raw`extern "C" const char* __asan_default_options() { return "detect_leaks=0"; }
extern "C" const char* __ubsan_default_options() { return "halt_on_error=1:print_stacktrace=1"; }

namespace practice_judge {

struct Json {
    enum class Kind { Null, Bool, Number, String, Array, Object };
    Kind kind = Kind::Null;
    bool boolean = false;
    std::string text;
    std::vector<Json> items;
    // An object's member names, item k's name at k.
    std::vector<std::string> keys;
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
        if (first == '{') {
            value.kind = Json::Kind::Object;
            ++pos_;
            skip_space();
            if (!at_end() && source_[pos_] == '}') {
                ++pos_;
                return value;
            }
            for (;;) {
                skip_space();
                if (at_end() || source_[pos_] != '"') {
                    fail("expected a member name");
                }
                value.keys.push_back(read_string());
                skip_space();
                if (at_end() || source_[pos_++] != ':') {
                    fail("expected :");
                }
                value.items.push_back(read_value());
                skip_space();
                if (at_end()) {
                    fail("unterminated object");
                }
                char separator = source_[pos_++];
                if (separator == '}') {
                    return value;
                }
                if (separator != ',') {
                    fail("expected , or }");
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

inline const Json& member(const Json& object, const char* key) {
    const Json& checked = expect_kind(object, Json::Kind::Object, "an object");
    for (std::size_t index = 0; index < checked.keys.size(); ++index) {
        if (checked.keys[index] == key) {
            return checked.items[index];
        }
    }
    throw std::runtime_error(std::string("cases file: no member ") + key);
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
void from_json(const Json& json, GraphNode*& value);
void from_json(const Json& json, RandomNode*& value);
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
void to_json(std::string& out, GraphNode* value);
void to_json(std::string& out, RandomNode* value);
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

// A plain array, or {"values": [...], "pos": k} whose tail links back to node k.
void from_json(const Json& json, ListNode*& value) {
    bool is_cyclic = json.kind == Json::Kind::Object;
    const Json& array = expect_kind(is_cyclic ? member(json, "values") : json, Json::Kind::Array, "an array");
    int pos = is_cyclic ? int_of(member(json, "pos")) : -1;
    std::vector<ListNode*> nodes;
    for (const Json& item : array.items) {
        nodes.push_back(new ListNode(int_of(item)));
        if (nodes.size() > 1) {
            nodes[nodes.size() - 2]->next = nodes.back();
        }
    }
    if (pos >= 0) {
        nodes.back()->next = nodes.at(static_cast<std::size_t>(pos));
    }
    value = nodes.empty() ? nullptr : nodes[0];
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

// LeetCode's graph: entry i lists node i + 1's neighbours by value; the answer is node 1.
void from_json(const Json& json, GraphNode*& value) {
    const Json& array = expect_kind(json, Json::Kind::Array, "an array");
    std::vector<GraphNode*> nodes;
    for (std::size_t index = 0; index < array.items.size(); ++index) {
        nodes.push_back(new GraphNode(static_cast<int>(index) + 1));
    }
    for (std::size_t index = 0; index < array.items.size(); ++index) {
        for (const Json& neighbour : expect_kind(array.items[index], Json::Kind::Array, "an array").items) {
            nodes[index]->neighbors.push_back(nodes.at(static_cast<std::size_t>(int_of(neighbour) - 1)));
        }
    }
    value = nodes.empty() ? nullptr : nodes[0];
}

// LeetCode's random list: one [val, randomIndex] per node, the index null for none.
void from_json(const Json& json, RandomNode*& value) {
    const Json& array = expect_kind(json, Json::Kind::Array, "an array");
    std::vector<RandomNode*> nodes;
    for (const Json& item : array.items) {
        nodes.push_back(new RandomNode(int_of(element(item, 0))));
        if (nodes.size() > 1) {
            nodes[nodes.size() - 2]->next = nodes.back();
        }
    }
    for (std::size_t index = 0; index < array.items.size(); ++index) {
        const Json& random = element(array.items[index], 1);
        if (random.kind != Json::Kind::Null) {
            nodes[index]->random = nodes.at(static_cast<std::size_t>(int_of(random)));
        }
    }
    value = nodes.empty() ? nullptr : nodes[0];
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
    std::unordered_set<ListNode*> seen;
    out += '[';
    for (ListNode* node = value; node != nullptr; node = node->next) {
        if (!seen.insert(node).second) {
            throw std::runtime_error("the returned list's next pointers loop back");
        }
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

// Every node reachable from start, in breadth-first order.
std::vector<GraphNode*> nodes_of(GraphNode* start) {
    std::vector<GraphNode*> nodes;
    std::unordered_set<GraphNode*> seen;
    if (start != nullptr) {
        nodes.push_back(start);
        seen.insert(start);
    }
    for (std::size_t index = 0; index < nodes.size(); ++index) {
        for (GraphNode* neighbour : nodes[index]->neighbors) {
            if (neighbour != nullptr && seen.insert(neighbour).second) {
                nodes.push_back(neighbour);
            }
        }
    }
    return nodes;
}

// The list's nodes along next; throws when next loops back.
std::vector<RandomNode*> nodes_of(RandomNode* head) {
    std::vector<RandomNode*> nodes;
    std::unordered_set<RandomNode*> seen;
    for (RandomNode* node = head; node != nullptr; node = node->next) {
        if (!seen.insert(node).second) {
            throw std::runtime_error("the returned list's next pointers loop back");
        }
        nodes.push_back(node);
    }
    return nodes;
}

// Throws when the answer holds any node of the input.
template <typename Node>
void require_deep_copy(const std::vector<Node*>& input, const std::vector<Node*>& answer) {
    std::unordered_set<Node*> input_nodes(input.begin(), input.end());
    for (Node* node : answer) {
        if (input_nodes.count(node) != 0) {
            throw std::runtime_error("the answer shares node " + std::to_string(node->val) + " with the input: return a deep copy");
        }
    }
}

// Entry i lists the neighbours of the node with the i-th smallest value, by value.
void to_json(std::string& out, GraphNode* value) {
    std::vector<GraphNode*> nodes = nodes_of(value);
    std::stable_sort(nodes.begin(), nodes.end(), [](GraphNode* a, GraphNode* b) { return a->val < b->val; });
    out += '[';
    for (std::size_t index = 0; index < nodes.size(); ++index) {
        if (index > 0) {
            out += ',';
        }
        out += '[';
        for (std::size_t k = 0; k < nodes[index]->neighbors.size(); ++k) {
            if (k > 0) {
                out += ',';
            }
            GraphNode* neighbour = nodes[index]->neighbors[k];
            out += neighbour == nullptr ? std::string("null") : std::to_string(neighbour->val);
        }
        out += ']';
    }
    out += ']';
}

void to_json(std::string& out, RandomNode* value) {
    std::vector<RandomNode*> nodes = nodes_of(value);
    std::unordered_map<RandomNode*, std::size_t> index_of;
    for (std::size_t index = 0; index < nodes.size(); ++index) {
        index_of[nodes[index]] = index;
    }
    out += '[';
    for (std::size_t index = 0; index < nodes.size(); ++index) {
        if (index > 0) {
            out += ',';
        }
        out += '[';
        to_json(out, nodes[index]->val);
        out += ',';
        RandomNode* random = nodes[index]->random;
        if (random == nullptr) {
            out += "null";
        } else if (index_of.count(random) == 0) {
            throw std::runtime_error("a random pointer of the returned list points at a node outside it");
        } else {
            out += std::to_string(index_of[random]);
        }
        out += ']';
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

/**
 * The `prelude.h` every solution compiles against: the standard headers,
 * `using namespace std;`, LeetCode's node types. LeetCode names its graph and
 * random-list nodes both `Node`, so the prelude names them `GraphNode` and
 * `RandomNode` and the driver aliases the one a problem uses.
 */
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
  const body = caseBody(signature);
  const aliased = aliasedNodeType(signature);
  const nodeAlias =
    aliased === null ? [] : [`using Node = ${aliased.slice(0, -1)};`];
  return [
    '#include "prelude.h"',
    '',
    JSON_SUPPORT,
    ...nodeAlias,
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
  const { className, members } = stubClass(problem.signature);
  return [
    `class ${className} {`,
    'public:',
    members.join('\n    \n'),
    '};',
    '',
  ].join('\n');
}

function stubClass(signature: Signature): {
  className: string;
  members: string[];
} {
  switch (signature.kind) {
    case 'function':
      return {
        className: 'Solution',
        members: [
          stubMember(
            `${spelledType(signature.returns)} ${signature.method}`,
            signature.params,
          ),
        ],
      };
    case 'design':
      return {
        className: signature.className,
        members: [
          stubMember(signature.className, signature.constructor),
          ...signature.methods.map((method) =>
            stubMember(
              `${spelledType(method.returns)} ${method.name}`,
              method.params,
            ),
          ),
        ],
      };
    case 'codec':
      return {
        className: signature.className,
        members: [
          stubMember(`string ${signature.encode}`, [
            { name: 'value', type: signature.type },
          ]),
          stubMember(`${spelledType(signature.type)} ${signature.decode}`, [
            { name: 'data', type: 'string' },
          ]),
        ],
      };
  }
}

function stubMember(head: string, params: Param[]): string {
  const paramList = params
    .map((param) =>
      vectorElement(param.type) !== null
        ? `${param.type}& ${param.name}`
        : `${spelledType(param.type)} ${param.name}`,
    )
    .join(', ');
  return [`    ${head}(${paramList}) {`, '        ', '    }'].join('\n');
}

/** A type as the solution writes it: `Node*` for a graph or random-list node, as on LeetCode. */
function spelledType(type: ValueType): string {
  return type === 'GraphNode*' || type === 'RandomNode*' ? 'Node*' : type;
}

function caseBody(signature: Signature): string[] {
  switch (signature.kind) {
    case 'function':
      return functionCaseBody(signature);
    case 'design':
      return designCaseBody(signature);
    case 'codec':
      return codecCaseBody(signature);
  }
}

function functionCaseBody(signature: FunctionSignature): string[] {
  const locals = readParamsInto(signature.params, 'item', 'p', '    ');
  const callArgs = signature.params.map((_, index) => `p${index}`).join(', ');
  // A graph or random list returned from one passed in is a copy: it may share no node with the input.
  const returnsAliasedNode = aliasedNodeType(signature) === signature.returns;
  const copied = signature.params.flatMap((param, index) =>
    returnsAliasedNode && param.type === signature.returns ? [index] : [],
  );
  const isCopy = copied.length > 0;
  const inputNodes = copied.map(
    (index) =>
      `    for (auto node : ${JUDGE}nodes_of(p${index})) input_nodes.push_back(node);`,
  );
  return [
    ...locals,
    ...(isCopy
      ? [`    std::vector<${signature.returns}> input_nodes;`, ...inputNodes]
      : []),
    '    Solution* solution = new Solution();',
    `    ${signature.returns} result = solution->${signature.method}(${callArgs});`,
    ...(isCopy
      ? [
          `    ${JUDGE}require_deep_copy(input_nodes, ${JUDGE}nodes_of(result));`,
        ]
      : []),
    `    ${JUDGE}to_json(out, result);`,
  ];
}

// Two instances, as LeetCode runs a codec: the decoder never sees the encoder's state.
function codecCaseBody(signature: CodecSignature): string[] {
  return [
    `    ${signature.type} value{};`,
    `    ${JUDGE}from_json(item, value);`,
    `    ${signature.className}* encoder = new ${signature.className}();`,
    `    ${signature.className}* decoder = new ${signature.className}();`,
    `    std::string encoded = encoder->${signature.encode}(value);`,
    `    ${signature.type} result = decoder->${signature.decode}(encoded);`,
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
