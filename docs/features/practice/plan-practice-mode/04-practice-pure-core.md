# 04 — Practice: pure core

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/practice/problem.ts` · `src/plugins/practice/driver.ts` · `src/plugins/practice/compare.ts` ·
           `src/plugins/practice/compile-errors.ts` · `src/plugins/practice/ladder.ts` ·
           test `src/plugins/practice/problem.test.ts` · `src/plugins/practice/driver.test.ts` ·
           `src/plugins/practice/compare.test.ts` · `src/plugins/practice/compile-errors.test.ts` ·
           `src/plugins/practice/ladder.test.ts`
Consumes:  nothing. These modules are pure: they import nothing outside `src/contracts` and read no clock, file or
           process (plan.md § File Structure, boundary rules).
Produces:
- `problem.ts`:
  - `type Difficulty = 'easy' | 'medium' | 'hard'`
  - `type CompareMode = 'exact' | 'anyOrder' | 'anyOrderDeep' | 'float'`
  - `type ScalarType = 'int' | 'long long' | 'double' | 'bool' | 'char' | 'string'`
  - `type ValueType = ScalarType | 'ListNode*' | 'TreeNode*' | 'void' | \`vector<${string}>\`` — always the
    canonical spelling below
  - `interface Param { name: string; type: ValueType }`
  - `interface FunctionSignature { kind: 'function'; method: string; params: Param[]; returns: ValueType }`
  - `interface DesignSignature { kind: 'design'; className: string; constructor: Param[]; methods: { name: string;
    params: Param[]; returns: ValueType }[] }`
  - `type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }`
  - `interface FunctionCase { input: JsonValue[]; expected: JsonValue; visible: boolean }`
  - `interface DesignCase { ops: string[]; args: JsonValue[][]; expected: JsonValue[]; visible: boolean }`
  - `interface Problem { slug: string; title: string; difficulty: Difficulty; tags: string[]; lists: string[];
    signature: FunctionSignature | DesignSignature; compare: CompareMode; cases: (FunctionCase | DesignCase)[] }`
  - `class ProblemError extends Error { readonly field: string }`, its `message` `<field>: <reason>`
  - `parseProblem(json: unknown, slug: string): Problem`
  - `parseValueType(text: string): ValueType | null`
  - `vectorElement(type: ValueType): ValueType | null`
  - `type CustomInput = { input: JsonValue[] } | { ops: string[]; args: JsonValue[][] }`
  - `parseCustomCases(text: string, signature: FunctionSignature | DesignSignature): CustomInput[]`
  - `problemJson(problem: Problem): string` — the `problem.json` text of a problem (no `slug`), 2-space indented
- `driver.ts`: `preludeSource(): string`; `driverSource(problem: Problem, solutionPath: string): string`;
  `stubSource(problem: Problem): string`.
- `compare.ts`: `answersMatch(expected: JsonValue, actual: JsonValue, mode: CompareMode): boolean`.
- `compile-errors.ts`: `mapCompileErrors(output: string, solutionPath: string): string`.
- `ladder.ts`: `interface ReviewState { step: number | null; due: string | null }`; `nextReview(state: ReviewState,
  outcome: 'clean' | 'peeked', today: string, steps: readonly number[]): ReviewState`; `isDue(state: ReviewState,
  today: string): boolean`; `addDays(day: string, days: number): string`; `dayOf(epochMs: number): string`.

Decisions:
- **`problem.json` schema** (design.md § Problem files; settled here). The file is one JSON object:

  | Field | Required | Value |
  |---|---|---|
  | `title` | yes | a non-empty string |
  | `difficulty` | yes | `easy`, `medium` or `hard` |
  | `tags` | no, default `[]` | an array of non-empty strings |
  | `lists` | no, default `[]` | an array of non-empty strings |
  | `compare` | no, default `exact` | a `CompareMode` |
  | `signature` | yes | a function or a design signature, below |
  | `cases` | yes | a non-empty array of cases, below; at least one case has `visible: true` |

  - Function signature: `{ "kind": "function", "method": "twoSum", "params": [{ "name": "nums", "type":
    "vector<int>" }, { "name": "target", "type": "int" }], "returns": "vector<int>" }`.
  - Design signature: `{ "kind": "design", "className": "LRUCache", "constructor": [{ "name": "capacity", "type":
    "int" }], "methods": [{ "name": "get", "params": [{ "name": "key", "type": "int" }], "returns": "int" }, { "name":
    "put", "params": [...], "returns": "void" }] }`.
  - Function case: `{ "input": [<one value per param>], "expected": <value of returns>, "visible": true }`.
  - Design case: `{ "ops": ["LRUCache", "put", "get"], "args": [[2], [1, 1], [1]], "expected": [null, null, 1],
    "visible": false }`.
  - `visible` is required and boolean on every case.
  - The slug is the problem's folder name, passed in. It matches `^[a-z0-9]+(-[a-z0-9]+)*$`; any other slug is the
    error `slug: <reason>`.
- **Strict keys.** Every object in the schema (the root, a signature, a param, a method, a case) refuses a key the table
  does not name, with the reason `unknown field`. Reason: a typo such as `visable` must fail at import, not silently
  default.
- **Own keys only.** The parser reads each object's keys with `Object.keys` and tests a key with `Object.hasOwn(obj,
  key)`, never with `in` or `obj.key === undefined`. Reason: a design signature has a key named `constructor`, and
  every plain object inherits `Object.prototype.constructor`; `in` would pass a design signature that has no
  `constructor` key. JSON keys such as `__proto__` need own-key reads for the same reason.
- **Error shape.** `parseProblem` throws `ProblemError` on the first problem it finds. `field` is the path in JSON
  path form without a leading `$`: `title`, `tags[1]`, `signature.params[0].type`, `signature.methods[2].name`,
  `cases[3].input[1]`, `cases[3].expected`, `cases[2].ops[1]`, `cases[2].args[1][0]`; the root itself is `(root)`. The
  message is `<field>: <reason>`, for example `cases[3].input[1]: expected int, got "7"`. The problem store (05) adds
  the file in front: `problems/<slug>/problem.json: <message>`. `parseCustomCases` uses the same shape, its paths
  starting at the array: `[1].input[0]: expected int, got 2.5`.
- **Value types** (design.md § Judging, Value types). `parseValueType` accepts this grammar and returns the canonical
  spelling, or null:
  `T := int | long long | double | bool | char | string | vector<T> | ListNode* | TreeNode*`, and `void`.
  Whitespace may appear around `<`, `>` and before `*`, and one or more spaces separate `long long`; `std::` may
  prefix `string` and `vector`. Canonical spelling has no spaces except one in `long long`, and no `std::`:
  `vector < vector<int> >` → `vector<vector<int>>`, `long  long` → `long long`, `ListNode *` → `ListNode*`,
  `std::string` → `string`. Anything else (`unsigned`, `int64_t`, `pair<int,int>`, `vector<ListNode*>`) is null:
  `ListNode*` and `TreeNode*` are top-level types only, never a vector element. `vectorElement('vector<vector<int>>')`
  is `vector<int>`; it is null for every non-vector type.
- **`void`** is valid only as a design method's `returns`. Anywhere else it is the error `<field>: void is only a
  design method's return type`. A function problem whose LeetCode method returns `void` (in-place problems) is out of
  scope: the import tool refuses it.
- **Value checks** per type, applied to every case value and every expected value:

  | Type | Accepted JSON |
  |---|---|
  | `int` | an integer in [-2147483648, 2147483647] |
  | `long long` | an integer with `Number.isSafeInteger` true (JSON numbers past ±2^53−1 lose precision in the app) |
  | `double` | any finite number |
  | `bool` | `true` or `false` |
  | `char` | a string of one character with code point below 128 |
  | `string` | any string |
  | `vector<T>` | an array, each element a `T` |
  | `ListNode*` | an array of `int`s; `[]` is the empty list |
  | `TreeNode*` | an array of `int`s and `null`s in LeetCode level order; `[]` is the empty tree; a non-empty array starts with an `int` |
  | `void` | `null` |

  The reason names the type and the bad value: `expected int, got "7"`, `expected vector<int>, got 3`.
- **Names.** `method`, `className`, each param `name` and each method `name` match `^[A-Za-z_][A-Za-z0-9_]*$`.
  Params of one function, constructor or method have distinct names. Design method names are distinct and differ
  from `className`.
- **Function case checks:** `input` holds exactly one value per param (reason `expected <n> values (one per param),
  got <m>`), each checked against its param type; `expected` is checked against `returns`.
- **Design case checks:** `ops`, `args` and `expected` have the same length, at least 1; `ops[0]` equals `className`
  and `args[0]` holds the constructor's params; each later `ops[k]` names a method (reason `no method "<name>"`) and
  `args[k]` holds its params; `expected[0]` is `null`; `expected[k]` is checked against the method's `returns`
  (`null` for `void`).
- **Compare by kind:** `anyOrder` and `anyOrderDeep` apply to a function problem only; on a design problem they are
  the error `compare: anyOrder applies to a function problem only` (or `anyOrderDeep`). `exact` and `float` apply to
  both.
- **Custom cases** (`custom-cases.json`, the Testcase tab's text). The text is a JSON array; each item is a function
  case's `input` array (`[[2,7,11,15], 9]`) or, for a design problem, `{ "ops": [...], "args": [...] }`. Items are
  checked as the matching case fields are. Text that is empty or only whitespace is `[]`. Text that is not JSON is the
  error `(root): not JSON: <the JSON.parse message>`. The result carries no `expected` and no `visible`: Run takes the
  expected answers from `reference.cpp`, and 05 builds each `JudgeCase` from a `CustomInput` (05 § Runs).
- **`problemJson`** writes the fields in the table's order, without `slug`, with canonical type spellings and
  `JSON.stringify(…, null, 2)` plus a final newline. `parseProblem(JSON.parse(problemJson(p)), p.slug)` deep-equals
  `p`.
- **Prelude** (design.md § Judging). `preludeSource()` returns a header file:
  - `#pragma once`
  - these headers, one `#include <…>` each, in this order: `cassert cctype cerrno cfloat climits cmath cstddef cstdint
    cstdio cstdlib cstring ctime algorithm any array atomic bit bitset charconv chrono compare complex concepts deque
    exception functional initializer_list iomanip ios iostream istream iterator limits list map memory numbers numeric
    optional ostream queue random ranges ratio set span sstream stack stdexcept string string_view tuple type_traits
    unordered_map unordered_set utility valarray variant vector`. Reason: Apple clang has no `<bits/stdc++.h>`; this
    is every header a LeetCode C++ solution reaches for, and each compiles under libc++ with `-std=c++20`. 05's real
    clang test compiles it.
  - `using namespace std;`
  - LeetCode's own definitions, verbatim:

    ```cpp
    struct ListNode {
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
    ```
- **Driver** (design.md § Judging). `driverSource(problem, solutionPath)` returns one C++ file with these parts, in this
  order:
  1. `#include "prelude.h"`. The judge (05) compiles with `-I <folder>/.build`, where it writes `prelude.h`.
  2. The JSON support block: a fixed text, the same for every problem, inside `namespace practice_judge`. It holds:
     - `extern "C" const char* __asan_default_options()` returning `"detect_leaks=0"` and `extern "C" const char*
       __ubsan_default_options()` returning `"halt_on_error=1:print_stacktrace=1"`, both outside the namespace.
       Reason: LeetCode inputs (`ListNode*`, `TreeNode*`) are never freed, so leak reports would fail every list
       problem; and UBSan only prints and goes on by default, so `halt_on_error` makes its report a non-zero exit.
       The process runner has no environment option, so the options are compiled in.
     - A JSON reader for null, `true`/`false`, numbers (kept as their text), strings (escapes `\" \\ \/ \b \f \n \r
       \t \uXXXX`, surrogate pairs joined, written as UTF-8) and arrays. It reads no objects: the judge writes no
       objects into the cases file.
     - `from_json(const Json&, T&)` overloads for `int`, `long long`, `double`, `bool`, `char`, `string`, a template
       for `vector<T>`, and `ListNode*` (an array of values, linked in order; `[]` → `nullptr`) and `TreeNode*`
       (LeetCode level order: the first value is the root; a queue of nodes takes the next two values as left and
       right children, `null` leaving a child out; `[]` → `nullptr`).
     - `to_json(string& out, const T&)` overloads that append: integers as decimal text; `double` through
       `std::to_chars` (the shortest form that reads back the same), `null` for NaN and infinity; `bool` as
       `true`/`false`; `char` as a one-character JSON string; `string` escaped (`"` → `\"`, `\` → `\\`, `\n \r \t \b
       \f` as those escapes, any other byte below 0x20 as `\u00XX`, every other byte as it is); `vector<T>` as an
       array, each element written as `static_cast<T>(v[i])` so `vector<bool>` works; `ListNode*` as the array of its
       values; `TreeNode*` in LeetCode level order (breadth-first, `null` for each missing child of a present node,
       trailing `null`s cut, `nullptr` → `[]`).
     - `read_file(path)` and `write_file(path, text)`.
  3. `#include "<solutionPath>"`, the path written as a C string literal (each `\` and `"` escaped). Reason: the JSON
     support sits before the user's code so a user macro cannot change it, and the solution's own line numbers stay
     its own.
  4. `int main(int argc, char** argv)`. Its arguments are, in order: the cases file path, the case index (decimal), the
     result file path. The cases file is a JSON array with one item per case. The driver parses the file, takes the
     item at the index, runs the case, writes the answer as JSON to the result file, and returns 0. It writes nothing
     to stdout or stderr itself, so the user's own output stays separate.
     - **Function:** the item is the case's `input` array. For each param `i`, the driver declares a local of the
       param's type exactly as the signature writes it (`vector<int> p0;`), calls `from_json(item[i], p0)`, then
       calls `Solution().<method>(p0, p1, …)` with the locals as lvalues (so `vector<int>&` params bind) and writes
       `to_json` of the returned value.
     - **Design:** the item is `[ops, args]`. The driver reads the constructor's params from `args[0]` as above and
       makes the object with `new <className>(…)`. For each later index `k` it compares `ops[k]` with each method name,
       reads that method's params from `args[k]`, calls it, and appends `to_json` of the result, or `null` for a
       `void` method. An op that names no method throws `std::runtime_error("no method <name>")`. The result file
       holds the JSON array of every op's answer, `null` first for the constructor.
- **Stub** (LeetCode's shape, design.md § Problem files). 4-space indent, an empty line as the body, a final newline.
  A vector param is taken by reference (`vector<int>& nums`); every other param by value (`int target`, `string s`,
  `ListNode* head`). Function:

  ```cpp
  class Solution {
  public:
      vector<int> twoSum(vector<int>& nums, int target) {
          
      }
  };
  ```

  Design: the constructor, then each method, an empty line between members:

  ```cpp
  class LRUCache {
  public:
      LRUCache(int capacity) {
          
      }
      
      int get(int key) {
          
      }
      
      void put(int key, int value) {
          
      }
  };
  ```

  The body line holds 8 spaces and the line between members 4, as LeetCode's editor writes them.
- **Compare modes** (design.md § Judging, Compare modes):
  - `exact`: deep equality; numbers by `===`; arrays by length and element; objects by key set and value.
  - `anyOrder`: when both are arrays, sort a copy of each by the canonical key `JSON.stringify(element)`, then deep
    equality. When either is not an array, `exact`.
  - `anyOrderDeep`: when both are arrays, sort each element that is an array by the canonical key (one level), then
    sort the outer arrays by the canonical key of the sorted elements, then deep equality. Elements that are not
    arrays stay as they are. When either is not an array, `exact`.
  - `float`: deep equality where two numbers match when `|a − b| ≤ 1e-5` or `|a − b| ≤ 1e-5 × max(|a|, |b|)`. It
    applies to every number at every depth.
- **Compile errors** (design.md § Judging, a failed case). `mapCompileErrors(output, solutionPath)`:
  - replaces each `<solutionPath>:` with `<base name of solutionPath>:` (the text after the last `/` or `\`), so the
    user's `solution.cpp` errors read `solution.cpp:12:5: error: …` and the import tool's reference reads
    `reference.cpp:…`;
  - drops each line that starts with `In file included from `: those lines name only the generated driver;
  - keeps every other line, a driver line included. Reason: an error inside the driver (`no matching member function
    for call to 'twoSum'`) means the user changed the signature, and its text says so.
- **Review ladder** (design.md § Progress; brief). `steps` is the `reviewSteps` setting (default `[1, 3, 7, 14, 30,
  60]`). Days are `YYYY-MM-DD` strings; no function here reads a clock.
  - `nextReview(state, 'clean', today, steps)`: `step` null → `0`; else `min(step + 1, steps.length − 1)`. `due` is
    `addDays(today, steps[newStep])`.
  - `nextReview(state, 'peeked', today, steps)`: `step` `0`, `due` `addDays(today, steps[0])`.
  - `isDue(state, today)`: `state.due !== null && state.due <= today` (string order is date order).
  - `addDays(day, days)`: calendar arithmetic through `Date.UTC`, so month and year ends roll over and no daylight
    saving change moves a day.
  - `dayOf(epochMs)`: the local calendar day of the instant, from `new Date(epochMs)`'s local getters. Callers pass
    `services.clock.now()` (05).

GIVEN a problem.json with `"type": "vector < vector<int> >"` WHEN `parseProblem` reads it THEN the param's type is
`vector<vector<int>>`.
GIVEN a case whose second input is `"7"` for an `int` param WHEN `parseProblem` reads it THEN it throws `ProblemError`
with `field` `cases[0].input[1]`.
GIVEN a design problem with `compare: "anyOrder"` WHEN `parseProblem` reads it THEN it throws with `field` `compare`.
GIVEN the Two Sum signature WHEN `stubSource` runs THEN it returns LeetCode's stub text above.
GIVEN `[[1,2],[3]]` and `[[3],[2,1]]` WHEN compared with `anyOrderDeep` THEN they match, and with `anyOrder` they do not.
GIVEN clang's `/u/leetcode/problems/two-sum/solution.cpp:4:9: error: x` after an `In file included from` line WHEN
`mapCompileErrors` runs THEN the output is `solution.cpp:4:9: error: x` alone.
GIVEN `{ step: 5, due: … }` and steps of length 6 WHEN a clean solve comes THEN `step` stays 5 and `due` is
`today + steps[5]`.

Tests (vitest; `describe` names the function, `it` a sentence; tables by `it.each` with named fields; data built in
the test; error assertions match `field` and the bad value, never the full message):
- `problem.test.ts`, with a builder `validProblem(overrides)` that returns a valid function problem object (Two Sum:
  `nums: vector<int>`, `target: int`, returns `vector<int>`, one visible and one hidden case) and
  `validDesign(overrides)` (a `Counter` class: constructor `start: int`, `add(n: int) → void`, `get() → int`):
  - `parseProblem accepts a valid problem and fills defaults` — `validProblem` without `tags`, `lists`, `compare` →
    `tags []`, `lists []`, `compare 'exact'`, the slug set. Catches a default dropped.
  - `parseProblem refuses each bad shape, naming the field` — `it.each` rows `{ change, field }`, each one change to a
    valid problem: root not an object → `(root)`; `title` `""` → `title`; `difficulty` `"Easy"` → `difficulty`;
    `tags` `[1]` → `tags[0]`; `visable` key on a case → `cases[0].visable`; unknown root key `kind` → `kind`; `cases`
    `[]` → `cases`; no visible case → `cases`; `signature.kind` `"other"` → `signature.kind`; method `two-sum` →
    `signature.method`; duplicate param names → `signature.params[1].name`; type `unsigned` → `signature.params[0]
    .type`; `returns` `void` on a function → `signature.returns`; input of 1 value for 2 params → `cases[0].input`;
    `"7"` for `int` → `cases[0].input[1]`; `2147483648` for `int` → `cases[0].input[1]`; `2.5` for `int` →
    `cases[0].input[1]`; `9007199254740993` for `long long` → its input path; `"ab"` for `char` → its path; TreeNode
    `[null, 1]` → its path; ListNode `[1, null]` → its path; expected of the wrong type → `cases[0].expected`; design
    `ops[0]` not the class → `cases[0].ops[0]`; design op naming no method → `cases[0].ops[2]`; design `expected[0]`
    `1` → `cases[0].expected[0]`; design signature with no `constructor` key → `signature.constructor`; design void
    method with expected `3` → its path; design lengths differ →
    `cases[0].args`; `anyOrder` on design → `compare`; slug `Two Sum` → `slug`. Catches each check removed or
    pointed at the wrong field.
  - `parseValueType reads spellings to the canonical form` — rows: `int`, `long  long` → `long long`, ` vector < int
    > ` → `vector<int>`, `vector<vector<string>>`, `std::vector<std::string>` → `vector<string>`, `ListNode *` →
    `ListNode*`, `TreeNode*`, `void`; null rows: `unsigned`, `pair<int,int>`, `vector<ListNode*>`, `vector<int`,
    `int*`. Catches a spelling the import should accept and a type it must refuse.
  - `parseCustomCases reads the Testcase text` — rows: `''` → `[]`; function `[[[1,2],3]]` → one input; design
    `[{"ops":["Counter","get"],"args":[[1],[]]}]` → one item; `[[[1,2]]]` (one value for two params) → throws with
    field `[0].input`; `not json` → throws with field `(root)`.
  - `problemJson round-trips` — `parseProblem(JSON.parse(problemJson(p)), slug)` deep-equals `p` for the function and
    the design builder. Catches a field `problemJson` leaves out.
- `driver.test.ts`:
  - `stubSource writes LeetCode's stub` — `it.each` rows: Two Sum (function, `vector<int>&` and `int`), a
    `string`/`ListNode*` function (by value), and the `LRUCache` design; each expected text is a literal written in the
    test, as above. Catches a reference dropped from a vector param, a missing constructor, a wrong member order.
  - `driverSource` and `preludeSource` are proved by compiling and running them: 05's `judge.test.ts` real-clang suite
    (this module's tests cannot reach a process: the root layer allows no `node:` import, and a test of the C++ text
    itself would be a change detector).
- `compare.test.ts` — `answersMatch` `it.each` rows `{ expected, actual, mode, match }`: exact `[1,2]`/`[2,1]` false;
  exact `"a"`/`"a"` true; anyOrder `[[1,2],[3]]`/`[[3],[1,2]]` true; anyOrder `[[1,2]]`/`[[2,1]]` false; anyOrderDeep
  `[[1,2],[3]]`/`[[3],[2,1]]` true; anyOrderDeep `[[1,2]]`/`[[1,3]]` false; anyOrder `[1,1,2]`/`[1,2,2]` false;
  anyOrder `3`/`3` true (not arrays); float `0.333333`/`0.3333333333` true; float `1e9`/`1e9 + 5` true (relative);
  float `1.0`/`1.0001` false; float `[1.5, [2.000001]]`/`[1.5, [2]]` true (nested); exact `null`/`[]` false. Catches
  a sort applied at the wrong depth, a tolerance on the wrong side, and a lost duplicate.
- `compile-errors.test.ts` — `mapCompileErrors` `it.each` rows `{ output, path, mapped }`: a solution error line →
  `solution.cpp:4:9: error: …`; an `In file included from /b/.build/two-sum/solution/driver.cpp:210:` line → dropped;
  a driver line `/b/.build/two-sum/solution/driver.cpp:230:31: error: no matching member function` → kept as is; a
  note line pointing into the solution → rewritten; the reference path `/b/.build/x/import/reference.cpp` →
  `reference.cpp:…`; a path holding regex characters (`/u/a+b (1)/solution.cpp`) → rewritten. Catches a regex built
  from the path unescaped and the include lines kept.
- `ladder.test.ts`, steps built in the test as `[2, 5, 9]`:
  - `nextReview moves the ladder` — rows: `{null, null}` clean on `2026-11-09` → `{0, 2026-11-11}`; `{0, …}` clean →
    `{1, 2026-11-14}`; `{2, …}` clean → `{2, 2026-11-18}` (capped); `{1, …}` peeked → `{0, 2026-11-11}`; `{null,
    null}` peeked → `{0, 2026-11-11}`; `{0, …}` clean on `2026-11-30` → due `2026-12-05`; `{0, …}` clean on
    `2026-12-30` → due `2027-01-04`. Catches an off-by-one at the cap and a month or year roll-over.
  - `isDue compares days` — rows: due null → false; due `2026-11-08` on `2026-11-09` → true; due equal → true; due
    `2026-11-10` → false.
  - `dayOf reads the local day` — `new Date(2026, 10, 9, 23, 30).getTime()` → `2026-11-09`; `new Date(2026, 10, 10,
    0, 15).getTime()` → `2026-11-10`. Catches a UTC day used in place of the local one.

Done when: `npm run typecheck` passes, `npm run lint` passes (`scripts/check-layers.mts` finds the root modules
importing only `src/contracts`), and the test gate runs the five test files above, all green.
Commit:    one commit for the group

## Proof
