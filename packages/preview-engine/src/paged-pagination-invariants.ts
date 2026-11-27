/**
 * 分页不变量：对分页结果的声明式检查与修复。
 *
 * ## 背景
 *
 * Paged.js 对“避免分页”“表格内断开”等情形的处理并不完备，会产生一些版面上
 * 不可接受的结果：表格行丢失或整行重复、标题孤零零留在页末等。此前这类问题
 * 只能各写各的“检测—修复—重排”循环（例如表格行恢复固定 3 轮），既没有统一
 * 的轮数、顺序和失败策略，也没有办法在不改动运行时的情况下增加新的检查。
 *
 * 本模块把“分页之后必须满足什么”抽象成一份清单：
 *
 * - **检测**：给出违反该不变量的对象标识（行 id、标题引用等）；
 * - **修复**（可选）：在重新分页用的源文档上写入分页意图，返回处理的对象数；
 * - **运行器**：统一负责循环、轮数上限、重新分页和未解决项的汇总。
 *
 * 没有修复函数的不变量只做检测，违反时由调用方决定是否报错。以后出现新的
 * Paged.js 问题，只需要增加一条不变量，不需要改动分页流程。
 */

/** 检测与修复函数共享的上下文。 */
export interface PaginationInvariantContext {
  /** 重新分页所用的源文档，修复函数在它上面写入分页意图。 */
  readonly source: ParentNode;
  /** 当前的分页结果。 */
  readonly rendered: ParentNode;
}

/**
 * 违反不变量的严重程度。
 *
 * - `error`：输出内容不正确（行丢失、重复），调用方应当中止导出；
 * - `warning`：只是版面瑕疵（例如标题落在页末），修复失败时保留当前结果。
 */
export type PaginationInvariantSeverity = "error" | "warning";

/** 一条分页不变量。 */
export interface PaginationInvariant {
  /** 稳定标识，用于统计与测试。 */
  readonly id: string;
  /** 面向用户的名称，用于错误信息。 */
  readonly title: string;
  /** 严重程度，默认 `error`。 */
  readonly severity?: PaginationInvariantSeverity;
  /**
   * 检测违反该不变量的对象。
   *
   * @returns 违反项的稳定标识；没有违反时返回空数组
   */
  detect(context: PaginationInvariantContext): readonly string[];
  /**
   * 修复违反项：在源文档上写入分页意图，使下一次分页满足该不变量。
   *
   * 必须是幂等的：对已经施加过修复的违反项返回 0，运行器据此判断无法继续
   * 改善，避免无限重排。
   *
   * @param violations `detect` 返回的违反项
   * @returns 本次新处理的违反项数量
   */
  repair?(
    context: PaginationInvariantContext,
    violations: readonly string[]
  ): number;
}

/** 运行器选项。 */
export interface EnforcePaginationInvariantsOptions {
  readonly invariants: readonly PaginationInvariant[];
  readonly context: PaginationInvariantContext;
  /** 在源文档被修复后重新分页，并使 `context.rendered` 反映新的结果。 */
  readonly repaginate: () => Promise<void>;
  /** 最多修复并重排的轮数，默认 5。 */
  readonly maxAttempts?: number;
}

/** 修复完成后仍然存在的违反项。 */
export interface UnresolvedPaginationInvariant {
  readonly id: string;
  readonly title: string;
  readonly severity: PaginationInvariantSeverity;
  readonly violations: readonly string[];
}

/** 运行器结果。 */
export interface PaginationInvariantRunResult {
  /** 实际执行的修复并重排轮数。 */
  readonly attempts: number;
  /** 每条不变量累计处理的违反项数量。 */
  readonly repaired: Readonly<Record<string, number>>;
  /** 最终仍然违反的不变量。 */
  readonly unresolved: readonly UnresolvedPaginationInvariant[];
}

/** 默认的最大修复轮数。 */
export const DEFAULT_MAX_INVARIANT_ATTEMPTS = 5;

/**
 * 检测所有不变量，返回仍然违反的部分。
 *
 * @param invariants 不变量清单
 * @param context 检测上下文
 */
export function collectPaginationViolations(
  invariants: readonly PaginationInvariant[],
  context: PaginationInvariantContext
): UnresolvedPaginationInvariant[] {
  const unresolved: UnresolvedPaginationInvariant[] = [];
  for (const invariant of invariants) {
    const violations = invariant.detect(context);
    if (violations.length > 0) {
      unresolved.push({
        id: invariant.id,
        title: invariant.title,
        severity: invariant.severity ?? "error",
        violations
      });
    }
  }
  return unresolved;
}

/**
 * 反复修复可修复的不变量并重新分页，直到全部满足、无法继续改善或达到轮数上限。
 *
 * 同一轮内，所有可修复的不变量基于同一份分页结果检测，各自在源文档上写入
 * 分页意图，然后统一重排一次。
 *
 * @returns 运行统计与最终未解决的违反项；是否报错由调用方决定
 */
export async function enforcePaginationInvariants(
  options: EnforcePaginationInvariantsOptions
): Promise<PaginationInvariantRunResult> {
  const maxAttempts = Math.max(
    0,
    options.maxAttempts ?? DEFAULT_MAX_INVARIANT_ATTEMPTS
  );
  const repaired: Record<string, number> = {};
  let attempts = 0;

  while (attempts < maxAttempts) {
    let repairedInThisAttempt = 0;
    for (const invariant of options.invariants) {
      if (!invariant.repair) {
        continue;
      }
      const violations = invariant.detect(options.context);
      if (violations.length === 0) {
        continue;
      }
      const handled = invariant.repair(options.context, violations);
      if (handled > 0) {
        repaired[invariant.id] = (repaired[invariant.id] ?? 0) + handled;
        repairedInThisAttempt += handled;
      }
    }
    if (repairedInThisAttempt === 0) {
      break;
    }
    attempts += 1;
    await options.repaginate();
  }

  return {
    attempts,
    repaired,
    unresolved: collectPaginationViolations(
      options.invariants,
      options.context
    )
  };
}

/**
 * 把未解决的违反项格式化为统一的错误信息。
 *
 * @param unresolved 未解决项
 * @returns 形如 `分页后表格正文行缺失：a, b；……` 的文本
 */
export function describeUnresolvedInvariants(
  unresolved: readonly UnresolvedPaginationInvariant[]
) {
  return unresolved
    .map(
      (item) => `${item.title}：${item.violations.join(", ")}`
    )
    .join("；");
}
