import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';

export interface PracticeFixtureDeps {
  files: Files;
  paths: Paths;
}

// The fixture's problems, in the order the list shows them before any
// attempt: Two Sum (easy) above LRU Cache (medium).
export const PRACTICE_FIXTURE_SLUGS = ['two-sum', 'lru-cache'] as const;

type FixtureSlug = (typeof PRACTICE_FIXTURE_SLUGS)[number];

const TWO_SUM_PROBLEM =
  '{"title":"Two Sum","difficulty":"easy","tags":["array","hash table"],"lists":["Blind 75"],"signature":{"kind":"function","method":"twoSum","params":[{"name":"nums","type":"vector<int>"},{"name":"target","type":"int"}],"returns":"vector<int>"},"compare":"anyOrder","cases":[{"input":[[2,7,11,15],9],"expected":[0,1],"visible":true},{"input":[[3,2,4],6],"expected":[1,2],"visible":true},{"input":[[3,3],6],"expected":[0,1],"visible":false}]}';

const TWO_SUM_SOLUTION = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> seen;
        for (int i = 0; i < (int)nums.size(); i++) {
            auto found = seen.find(target - nums[i]);
            if (found != seen.end()) {
                return {found->second, i};
            }
            seen[nums[i]] = i;
        }
        return {};
    }
};
`;

const LRU_CACHE_PROBLEM =
  '{"title":"LRU Cache","difficulty":"medium","tags":["design","hash table","linked list"],"lists":["Blind 75"],"signature":{"kind":"design","className":"LRUCache","constructor":[{"name":"capacity","type":"int"}],"methods":[{"name":"get","params":[{"name":"key","type":"int"}],"returns":"int"},{"name":"put","params":[{"name":"key","type":"int"},{"name":"value","type":"int"}],"returns":"void"}]},"compare":"exact","cases":[{"ops":["LRUCache","put","put","get","put","get","put","get","get","get"],"args":[[2],[1,1],[2,2],[1],[3,3],[2],[4,4],[1],[3],[4]],"expected":[null,null,null,1,null,-1,null,-1,3,4],"visible":true}]}';

// Compiles and returns from every path, so Submit gives Wrong Answer, never
// Runtime Error.
const LRU_CACHE_WRONG_SOLUTION = `class LRUCache {
public:
    LRUCache(int capacity) {}

    int get(int key) {
        return -1;
    }

    void put(int key, int value) {}
};
`;

const LRU_CACHE_REFERENCE = `class LRUCache {
public:
    LRUCache(int capacity) : capacity(capacity) {}

    int get(int key) {
        auto found = entries.find(key);
        if (found == entries.end()) {
            return -1;
        }
        order.splice(order.begin(), order, found->second);
        return found->second->second;
    }

    void put(int key, int value) {
        auto found = entries.find(key);
        if (found != entries.end()) {
            found->second->second = value;
            order.splice(order.begin(), order, found->second);
            return;
        }
        if ((int)entries.size() == capacity) {
            entries.erase(order.back().first);
            order.pop_back();
        }
        order.emplace_front(key, value);
        entries[key] = order.begin();
    }

private:
    int capacity;
    list<pair<int, int>> order;
    unordered_map<int, list<pair<int, int>>::iterator> entries;
};
`;

const APPROACH = "The self-test's approach.\n";

function statement(title: string): string {
  return `# ${title}\n\nThe self-test's ${title}.\n`;
}

// Each fixture problem's files by name.
const PROBLEM_FILES: Record<FixtureSlug, Record<string, string>> = {
  'two-sum': {
    'problem.json': TWO_SUM_PROBLEM,
    'problem.md': statement('Two Sum'),
    'reference.cpp': TWO_SUM_SOLUTION,
    'approach.md': APPROACH,
    'solution.cpp': TWO_SUM_SOLUTION,
  },
  'lru-cache': {
    'problem.json': LRU_CACHE_PROBLEM,
    'problem.md': statement('LRU Cache'),
    'reference.cpp': LRU_CACHE_REFERENCE,
    'approach.md': APPROACH,
    'solution.cpp': LRU_CACHE_WRONG_SOLUTION,
  },
};

// Writes the Practice fixture into `folder` (the practice folder): trashes
// every entry of `<folder>/problems/`, keeping the folder itself, which main
// watches, then writes each fixture problem's files.
export async function writePracticeFixture(
  deps: PracticeFixtureDeps,
  folder: string,
): Promise<void> {
  const { files, paths } = deps;
  const problems = paths.join(folder, 'problems');
  for (const entry of await files.list(problems, { recursive: false })) {
    await files.trash(paths.join(problems, entry.path));
  }
  for (const slug of PRACTICE_FIXTURE_SLUGS) {
    for (const [name, text] of Object.entries(PROBLEM_FILES[slug])) {
      await files.write(paths.join(problems, slug, name), text);
    }
  }
}
