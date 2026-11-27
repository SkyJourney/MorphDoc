import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_INVARIANT_ATTEMPTS,
  collectPaginationViolations,
  describeUnresolvedInvariants,
  enforcePaginationInvariants,
  type PaginationInvariant,
  type PaginationInvariantContext
} from "../src/paged-pagination-invariants.js";

/** 运行器本身不读取 DOM，测试用空对象占位即可。 */
function createContext() {
  return {
    source: {} as ParentNode,
    rendered: {} as ParentNode
  } satisfies PaginationInvariantContext;
}

/**
 * 用一个极简的“分页器”模拟 Paged.js：源文档是一组条目，`fixed` 记录哪些条目
 * 已经被施加了修复；重新分页后，被修复的条目不再违反不变量。
 */
function createHarness(initialViolations: string[]) {
  const fixed = new Set<string>();
  let repaginateCount = 0;
  const context = createContext();
  const violationsNow = () =>
    initialViolations.filter((item) => !fixed.has(item));
  const invariant: PaginationInvariant = {
    id: "demo",
    title: "演示不变量",
    detect: () => violationsNow(),
    repair: (_context, violations) => {
      let handled = 0;
      for (const item of violations) {
        if (!fixed.has(item)) {
          fixed.add(item);
          handled += 1;
        }
      }
      return handled;
    }
  };
  return {
    context,
    invariant,
    fixed,
    get repaginateCount() {
      return repaginateCount;
    },
    repaginate: async () => {
      repaginateCount += 1;
    }
  };
}

describe("分页不变量运行器", () => {
  it("没有违反项时不修复也不重排", async () => {
    const harness = createHarness([]);

    const result = await enforcePaginationInvariants({
      invariants: [harness.invariant],
      context: harness.context,
      repaginate: harness.repaginate
    });

    expect(result.attempts).toBe(0);
    expect(harness.repaginateCount).toBe(0);
    expect(result.unresolved).toEqual([]);
    expect(result.repaired).toEqual({});
  });

  it("修复后重新分页，违反项消除即结束", async () => {
    const harness = createHarness(["a", "b"]);

    const result = await enforcePaginationInvariants({
      invariants: [harness.invariant],
      context: harness.context,
      repaginate: harness.repaginate
    });

    expect(result.attempts).toBe(1);
    expect(harness.repaginateCount).toBe(1);
    expect(result.repaired).toEqual({ demo: 2 });
    expect(result.unresolved).toEqual([]);
  });

  it("修复只能改善一部分时继续下一轮，直到全部解决", async () => {
    const queue = [["a"], ["b"], ["c"]];
    const fixed = new Set<string>();
    const context = createContext();
    let repaginations = 0;
    // 每次重排只会暴露下一个违反项，模拟标题链被逐级推走
    const invariant: PaginationInvariant = {
      id: "chain",
      title: "链式不变量",
      detect: () => queue.map((group) => group[0]!).filter(
        (item, index) => !fixed.has(item) && index <= repaginations
      ),
      repair: (_context, violations) => {
        let handled = 0;
        for (const item of violations) {
          if (!fixed.has(item)) {
            fixed.add(item);
            handled += 1;
          }
        }
        return handled;
      }
    };

    const result = await enforcePaginationInvariants({
      invariants: [invariant],
      context,
      repaginate: async () => {
        repaginations += 1;
      }
    });

    expect(result.attempts).toBe(3);
    expect(result.repaired).toEqual({ chain: 3 });
    expect(result.unresolved).toEqual([]);
  });

  it("修复函数返回 0 说明无法继续改善，立即停止而不是空转", async () => {
    const context = createContext();
    let repaginations = 0;
    const invariant: PaginationInvariant = {
      id: "stuck",
      title: "无法修复",
      detect: () => ["x"],
      repair: () => 0
    };

    const result = await enforcePaginationInvariants({
      invariants: [invariant],
      context,
      repaginate: async () => {
        repaginations += 1;
      }
    });

    expect(repaginations).toBe(0);
    expect(result.attempts).toBe(0);
    expect(result.unresolved).toEqual([
      { id: "stuck", title: "无法修复", severity: "error", violations: ["x"] }
    ]);
  });

  it("每轮修复都有进展但永远不收敛时，在轮数上限处停止", async () => {
    let counter = 0;
    const context = createContext();
    let repaginations = 0;
    const invariant: PaginationInvariant = {
      id: "endless",
      title: "永不收敛",
      detect: () => [`v${counter}`],
      repair: () => {
        counter += 1;
        return 1;
      }
    };

    const result = await enforcePaginationInvariants({
      invariants: [invariant],
      context,
      repaginate: async () => {
        repaginations += 1;
      },
      maxAttempts: 3
    });

    expect(repaginations).toBe(3);
    expect(result.attempts).toBe(3);
    expect(result.unresolved).toHaveLength(1);
    expect(DEFAULT_MAX_INVARIANT_ATTEMPTS).toBe(5);
  });

  it("只检测不修复的不变量不触发重排，违反时进入未解决清单", async () => {
    const context = createContext();
    let repaginations = 0;
    const detectOnly: PaginationInvariant = {
      id: "fatal",
      title: "只检测",
      detect: () => ["row-1", "row-2"]
    };

    const result = await enforcePaginationInvariants({
      invariants: [detectOnly],
      context,
      repaginate: async () => {
        repaginations += 1;
      }
    });

    expect(repaginations).toBe(0);
    expect(result.unresolved).toEqual([
      {
        id: "fatal",
        title: "只检测",
        severity: "error",
        violations: ["row-1", "row-2"]
      }
    ]);
  });

  it("同一轮内多条不变量基于同一份结果各自修复，只重排一次", async () => {
    const first = createHarness(["a"]);
    const second = createHarness(["b"]);
    let repaginations = 0;

    const result = await enforcePaginationInvariants({
      invariants: [
        { ...first.invariant, id: "first" },
        { ...second.invariant, id: "second" }
      ],
      context: first.context,
      repaginate: async () => {
        repaginations += 1;
      }
    });

    expect(repaginations).toBe(1);
    expect(result.repaired).toEqual({ first: 1, second: 1 });
  });

  it("collectPaginationViolations 只返回仍然违反的不变量", () => {
    const context = createContext();
    const violated: PaginationInvariant = {
      id: "bad",
      title: "违反",
      detect: () => ["x"]
    };
    const satisfied: PaginationInvariant = {
      id: "good",
      title: "满足",
      detect: () => []
    };

    expect(collectPaginationViolations([violated, satisfied], context))
      .toEqual([
        { id: "bad", title: "违反", severity: "error", violations: ["x"] }
      ]);
  });

  it("severity 默认为 error，显式声明 warning 时原样带出", () => {
    const context = createContext();
    const warning: PaginationInvariant = {
      id: "cosmetic",
      title: "版面瑕疵",
      severity: "warning",
      detect: () => ["h1"]
    };
    const error: PaginationInvariant = {
      id: "content",
      title: "内容错误",
      detect: () => ["r1"]
    };

    expect(
      collectPaginationViolations([warning, error], context).map(
        (item) => [item.id, item.severity]
      )
    ).toEqual([
      ["cosmetic", "warning"],
      ["content", "error"]
    ]);
  });

  it("describeUnresolvedInvariants 用统一格式拼接错误信息", () => {
    expect(
      describeUnresolvedInvariants([
        {
          id: "a",
          title: "分页后表格正文行缺失",
          severity: "error",
          violations: ["r1", "r2"]
        },
        {
          id: "b",
          title: "分页后标题孤立",
          severity: "warning",
          violations: ["h1"]
        }
      ])
    ).toBe("分页后表格正文行缺失：r1, r2；分页后标题孤立：h1");
  });
});
