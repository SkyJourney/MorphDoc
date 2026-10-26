import {
  buildPdfEditableContentLines,
  normalizePdfContentText,
  normalizePdfEditableText,
} from "./text.js";
import type {
  EditableParagraphExpectation,
  PdfDocumentSnapshot,
  PdfEditableContentLine,
  PdfParagraphLayoutComparison,
  PdfParagraphLayoutObservation,
  PdfPointBounds,
  VisualDiffIssue,
  VisualPageSemanticExpectation,
} from "./types.js";

const LINE_BREAK_CHARACTER_TOLERANCE = 1;
const BODY_REFLOW_BREAK_CHARACTER_TOLERANCE = 3;
const LINE_X_TOLERANCE_PT = 2;
const COVER_LINE_X_TOLERANCE_PT = 12;
const LINE_HEIGHT_TOLERANCE_PT = 1;
const BASELINE_GAP_TOLERANCE_PT = 1.5;
const COVER_VERTICAL_TOLERANCE_PT = 6;
const BODY_NEAR_BOUNDARY_MIN_CHARACTERS = 30;
const BODY_NEAR_BOUNDARY_MAX_TRAILING_RATIO = 0.05;
const TABLE_COLUMN_CENTER_TOLERANCE_PT = 18;
const TABLE_COLUMN_BOUNDARY_TOLERANCE_PT = 1;
const TABLE_HEADER_CONTINUATION_X_TOLERANCE_PT = 48;
const TABLE_ROW_INITIAL_LINE_TOLERANCE = 8;
const TABLE_ROW_START_SEARCH_LINE_TOLERANCE = 8;
const TABLE_CELL_CONTINUATION_LINE_TOLERANCE = 6;
const TABLE_ROW_CANDIDATE_VERTICAL_DOMAIN_PT = 30;
const TABLE_HEADER_MIN_CLIPPED_IDENTIFIER_COVERAGE = 0.85;

interface MatchCursor {
  lineIndex: number;
  characterIndex: number;
}

interface ParagraphMatchState {
  cursor: MatchCursor;
  activeTableGroupId?: string;
  activeTableRowIndex?: number;
  activeTableRowAnchorLineIndex?: number;
  activeTableRowContinuationPageNumber?: number;
  activeTableRowContinuationBaselineY?: number;
  activeTableRowLastColumnIndex?: number;
  activeTableRowLastColumnCenter?: number;
  activeTableRowLastColumnRight?: number;
  tableStart?: MatchCursor;
  tableRowStart?: MatchCursor;
  tableHighWater?: MatchCursor;
  tableColumnAnchors: Map<number, number>;
  tableColumnLeftAnchors: Map<number, number>;
  occupiedTableCharacters: Set<string>;
}

interface MatchedCharacterRange {
  start: number;
  end: number;
}

interface MatchedCharacterPosition {
  lineIndex: number;
  characterIndex: number;
  character: string;
}

function average(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unionItemBounds(
  items: readonly { bounds: PdfPointBounds }[],
): PdfPointBounds | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const left = Math.min(...items.map((item) => item.bounds.x));
  const top = Math.min(...items.map((item) => item.bounds.y));
  const right = Math.max(
    ...items.map((item) => item.bounds.x + item.bounds.width),
  );
  const bottom = Math.max(
    ...items.map((item) => item.bounds.y + item.bounds.height),
  );
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function characterAdvanceWeight(character: string): number {
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(character)) {
    return 1;
  }
  if (/^[，。、；：！？（）《》【】「」『』〔〕［］｛｝]$/u.test(character)) {
    return 1;
  }
  if (/^[A-Za-z0-9]$/u.test(character)) {
    return 0.55;
  }
  if (/^[.,:;!'"`·]$/u.test(character)) {
    return 0.28;
  }
  if (/^[-–—/\\]$/u.test(character)) {
    return 0.4;
  }
  return 0.6;
}

function weightedCharacterRatio(
  characters: readonly string[],
  offset: number,
): number {
  const weights = characters.map(characterAdvanceWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return offset / Math.max(1, characters.length);
  }
  return weights
    .slice(0, offset)
    .reduce((sum, weight) => sum + weight, 0) / total;
}

function findCharacterSequence(
  haystack: readonly string[],
  needle: readonly string[],
  from = 0,
): number {
  if (needle.length === 0) {
    return Math.min(from, haystack.length);
  }
  for (let index = Math.max(0, from); index <= haystack.length - needle.length; index += 1) {
    if (needle.every((character, offset) => haystack[index + offset] === character)) {
      return index;
    }
  }
  return -1;
}

function matchedLineItems(
  line: PdfEditableContentLine["line"],
  normalizedLineText: string,
  range: MatchedCharacterRange | undefined,
  blockKind: EditableParagraphExpectation["blockKind"],
) {
  if (!range || line.items.length === 0) {
    return { bounds: line.bounds, items: line.items };
  }
  const selected = [];
  const normalizedLineCharacters = Array.from(normalizedLineText);
  let searchFrom = 0;
  for (const item of line.items) {
    // 几何映射必须保留项目符号；可编辑文本匹配仍由行级归一化负责剥离。
    const text = normalizePdfContentText(item.normalizedText);
    if (!text) {
      continue;
    }
    const characters = Array.from(text);
    let start = findCharacterSequence(
      normalizedLineCharacters,
      characters,
      searchFrom,
    );
    let itemOffset = 0;
    let mappedLength = characters.length;
    if (start < 0) {
      // PDF.js/Office 有时把项目符号和正文合并为同一个 text item，
      // 但可编辑行归一化会剥离项目符号。此时按正文在 item 内的真实偏移
      // 裁剪，而不是回退到包含项目符号的整行几何。
      const embeddedLineStart = findCharacterSequence(
        characters,
        normalizedLineCharacters,
      );
      if (embeddedLineStart < 0 || searchFrom > 0) {
        continue;
      }
      start = 0;
      itemOffset = embeddedLineStart;
      mappedLength = normalizedLineCharacters.length;
    }
    const end = start + mappedLength;
    searchFrom = end;
    const overlapStart = Math.max(start, range.start);
    const overlapEnd = Math.min(end, range.end);
    if (overlapStart >= overlapEnd) {
      continue;
    }
    const leftRatio = weightedCharacterRatio(
      characters,
      itemOffset + overlapStart - start,
    );
    const rightRatio = weightedCharacterRatio(
      characters,
      itemOffset + overlapEnd - start,
    );
    const unmatchedPrefix = characters
      .slice(0, itemOffset + overlapStart - start)
      .join("");
    const listMarkerGap = blockKind === "list-item" &&
        /^(?:[\p{L}\p{N}]+[.)、．]|[☐☑☒•◦▪\uf0b7])$/u.test(unmatchedPrefix)
      ? line.bounds.height * 0.525
      : 0;
    selected.push({
      item,
      bounds: {
        ...item.bounds,
        x: item.bounds.x + item.bounds.width * leftRatio + listMarkerGap,
        width: Math.max(
          0,
          item.bounds.width * (rightRatio - leftRatio) - listMarkerGap,
        ),
      },
    });
  }
  return {
    bounds: unionItemBounds(selected) ?? line.bounds,
    items: selected.length > 0
      ? selected.map((entry) => entry.item)
      : line.items,
  };
}

function advanceCursor(
  cursor: MatchCursor,
  lineCharacters: readonly string[][],
): boolean {
  cursor.characterIndex += 1;
  while (
    cursor.lineIndex < lineCharacters.length &&
    cursor.characterIndex >= (lineCharacters[cursor.lineIndex]?.length ?? 0)
  ) {
    cursor.lineIndex += 1;
    cursor.characterIndex = 0;
  }
  return cursor.lineIndex < lineCharacters.length;
}

function matchContiguousCharacters(
  start: MatchCursor,
  expectedCharacters: readonly string[],
  lineCharacters: readonly string[][],
  mathCharacterIndexes: ReadonlySet<number> = new Set(),
) {
  const cursor = { ...start };
  const positions: MatchedCharacterPosition[] = [];
  for (
    let expectedIndex = 0;
    expectedIndex < expectedCharacters.length;
    expectedIndex += 1
  ) {
    const expectedCharacter = expectedCharacters[expectedIndex]!;
    const actualCharacter =
      lineCharacters[cursor.lineIndex]?.[cursor.characterIndex];
    const mathTextLayerEquivalent =
      mathCharacterIndexes.has(expectedIndex) &&
      actualCharacter !== undefined &&
      /^\p{L}$/u.test(actualCharacter) &&
      /^\p{L}$/u.test(expectedCharacter);
    if (actualCharacter !== expectedCharacter && !mathTextLayerEquivalent) {
      if (mathCharacterIndexes.has(expectedIndex)) {
        let mathEndIndex = expectedIndex + 1;
        while (
          mathEndIndex < expectedCharacters.length &&
          mathCharacterIndexes.has(mathEndIndex)
        ) {
          mathEndIndex += 1;
        }
        const nextExpectedCharacter = expectedCharacters[mathEndIndex];
        if (
          actualCharacter !== undefined &&
          nextExpectedCharacter !== undefined &&
          actualCharacter === nextExpectedCharacter
        ) {
          for (
            let mathIndex = expectedIndex;
            mathIndex < mathEndIndex;
            mathIndex += 1
          ) {
            positions.push({
              lineIndex: cursor.lineIndex,
              characterIndex: cursor.characterIndex,
              character: expectedCharacters[mathIndex]!,
            });
          }
          expectedIndex = mathEndIndex - 1;
          continue;
        }
      }
      break;
    }
    positions.push({
      lineIndex: cursor.lineIndex,
      characterIndex: cursor.characterIndex,
      character: expectedCharacter,
    });
    advanceCursor(cursor, lineCharacters);
  }
  return { cursor, positions };
}

function matchInterleavedTableCellSegments(
  start: MatchCursor,
  segments: readonly string[],
  lines: readonly PdfEditableContentLine[],
  lineCharacters: readonly string[][],
  occupiedCharacters: ReadonlySet<string>,
  preferredX?: number,
  initialLineLimit?: number,
  minimumInitialX?: number,
  initialColumnMinX?: number,
  initialColumnMaxX?: number,
  alternateColumnMinX?: number,
  alternateColumnMaxX?: number,
  preferLeftmostInitial = false,
  preserveLeftmostAcrossLines = false,
  continuationXTolerance = TABLE_COLUMN_CENTER_TOLERANCE_PT,
  preferCenterContinuation = false,
  preferEarliestSamePageContinuation = false,
  initialPageNumber?: number,
  preferredRowY?: number,
  preferredContinuationPageNumber?: number,
  preferredContinuationRowY?: number,
  preferEarliestInitialSegment = false,
) {
  const positions: MatchedCharacterPosition[] = [];
  let segmentStart: MatchCursor = { ...start };
  let anchorX = preferredX;
  let continuationLeftX: number | undefined;
  for (const segment of segments) {
    const expectedCharacters = Array.from(normalizePdfEditableText(segment));
    if (expectedCharacters.length === 0) {
      continue;
    }
    let expectedIndex = 0;
    let searchCursor = { ...segmentStart };
    let lastPosition: MatchedCharacterPosition | undefined;
    while (
      expectedIndex < expectedCharacters.length &&
      searchCursor.lineIndex < lineCharacters.length
    ) {
      const searchingInitialChunk = positions.length === 0 && expectedIndex === 0;
      const remainingLength = expectedCharacters.length - expectedIndex;
      // 窄表格列会被 PDF.js 拆成逐字视觉行（例如 O / D / S、层 / 级）。
      // 表格组、行锚点和列中心已经限定候选区域，因此首段允许从单字开始，
      // 再沿同一列逐行完成；普通正文仍使用独立的连续匹配逻辑。
      const minimumInitialRun = Math.min(1, remainingLength);
      let selected:
        | {
          lineIndex: number;
          characterIndex: number;
           length: number;
           x: number;
           leftX: number;
           y: number;
        }
        | undefined;
      let fallback:
        | {
          lineIndex: number;
          characterIndex: number;
           length: number;
           x: number;
           leftX: number;
           y: number;
        }
        | undefined;
      const preferBestWithinWindow =
        initialLineLimit !== undefined || expectedIndex > 0 || positions.length > 0;
      const continuationBaseLimit =
        searchCursor.lineIndex + TABLE_CELL_CONTINUATION_LINE_TOLERANCE;
      const continuationReferencePosition = lastPosition ?? positions.at(-1);
      const continuationStartPage = continuationReferencePosition === undefined
        ? undefined
        : lines[continuationReferencePosition.lineIndex]?.pageNumber;
      const crossesPageInsideContinuationWindow =
        continuationStartPage !== undefined &&
        lines
          .slice(searchCursor.lineIndex, continuationBaseLimit)
          .some((line) => line.pageNumber !== continuationStartPage);
      const continuationLineLimit = continuationBaseLimit +
        (crossesPageInsideContinuationWindow
          ? TABLE_ROW_INITIAL_LINE_TOLERANCE
          : 0);

      for (
        let lineIndex = searchCursor.lineIndex;
        lineIndex < lineCharacters.length && (
          positions.length === 0 && initialLineLimit !== undefined
            ? lineIndex <= initialLineLimit
            : expectedIndex === 0 && positions.length === 0
              ? true
              : lineIndex <
                continuationLineLimit
        );
        lineIndex += 1
      ) {
        if (
          searchingInitialChunk &&
          selected !== undefined &&
          lines[lineIndex]?.pageNumber !== lines[selected.lineIndex]?.pageNumber
        ) {
          break;
        }
        if (
          searchingInitialChunk &&
          initialPageNumber !== undefined &&
          lines[lineIndex]?.pageNumber !== initialPageNumber
        ) {
          continue;
        }
        const characters = lineCharacters[lineIndex] ?? [];
        const from = lineIndex === searchCursor.lineIndex
          ? searchCursor.characterIndex
          : 0;
        const lineCandidates: Array<{
          lineIndex: number;
          characterIndex: number;
           length: number;
           x: number;
           leftX: number;
           y: number;
        }> = [];
        for (let characterIndex = from; characterIndex < characters.length; characterIndex += 1) {
          if (characters[characterIndex] !== expectedCharacters[expectedIndex]) {
            continue;
          }
          if (occupiedCharacters.has(`${lineIndex}:${characterIndex}`)) {
            continue;
          }
          let length = 0;
          while (
            characterIndex + length < characters.length &&
            expectedIndex + length < expectedCharacters.length &&
            !occupiedCharacters.has(`${lineIndex}:${characterIndex + length}`) &&
            characters[characterIndex + length] ===
              expectedCharacters[expectedIndex + length]
          ) {
            length += 1;
          }
          const line = lines[lineIndex];
          if (!line || length === 0) {
            continue;
          }
          if (line.line.items.length > 0 && length > 1) {
            let previousCharacterBounds: PdfPointBounds | undefined;
            const knownColumnRightX = Math.max(
              ...[
                initialColumnMaxX,
                alternateColumnMaxX,
              ].filter((value): value is number => value !== undefined),
              Number.NEGATIVE_INFINITY,
            );
            for (let offset = 0; offset < length; offset += 1) {
              const characterBounds = matchedLineItems(
                line.line,
                line.normalizedText,
                {
                  start: characterIndex + offset,
                  end: characterIndex + offset + 1,
                },
                "table-cell",
              ).bounds;
              const remainsInsideKnownColumn =
                Number.isFinite(knownColumnRightX) &&
                characterBounds.x + characterBounds.width <=
                  knownColumnRightX + TABLE_COLUMN_BOUNDARY_TOLERANCE_PT;
              if (
                previousCharacterBounds &&
                characterBounds.x -
                  (previousCharacterBounds.x + previousCharacterBounds.width) >
                  line.line.bounds.height * 0.75 &&
                !remainsInsideKnownColumn
              ) {
                length = offset;
                break;
              }
              previousCharacterBounds = characterBounds;
            }
          }
          if (length === 0) {
            continue;
          }
          const bounds = matchedLineItems(
            line.line,
            line.normalizedText,
            { start: characterIndex, end: characterIndex + length },
            "table-cell",
          ).bounds;
          const x = bounds.x + bounds.width / 2;
          const leftX = bounds.x;
          const y = line.line.baselineY;
          if (
            positions.length === 0 &&
            minimumInitialX !== undefined &&
            leftX < minimumInitialX - TABLE_COLUMN_BOUNDARY_TOLERANCE_PT
          ) {
            continue;
          }
          lineCandidates.push({ lineIndex, characterIndex, length, x, leftX, y });
        }
        const targetX = positions.length === 0 && expectedIndex === 0
          ? anchorX
          : preferCenterContinuation
            ? anchorX
            : continuationLeftX ?? anchorX;
        const initialChunk = positions.length === 0 && expectedIndex === 0;
        const candidateX = (candidate: (typeof lineCandidates)[number]) =>
          preferCenterContinuation
            ? candidate.x
            : candidate.leftX;
        const candidateRowDistance = (
          candidate: (typeof lineCandidates)[number],
        ) => preferredRowY === undefined
          ? 0
          : Math.abs(candidate.y - preferredRowY);
        const candidateContinuationRowDistance = (
          candidate: (typeof lineCandidates)[number],
        ) => preferredContinuationRowY === undefined ||
            preferredContinuationPageNumber === undefined ||
            lines[candidate.lineIndex]?.pageNumber !==
              preferredContinuationPageNumber
          ? Number.POSITIVE_INFINITY
          : Math.abs(candidate.y - preferredContinuationRowY);
        const isWithinTargetColumn = (
          candidate: (typeof lineCandidates)[number],
        ) => {
          if (targetX === undefined) {
            return true;
          }
          const sameLineContinuation = !initialChunk &&
            continuationReferencePosition !== undefined &&
            candidate.lineIndex === continuationReferencePosition.lineIndex;
          const boundedSameLineContinuation = sameLineContinuation &&
            (
              !preferCenterContinuation ||
              initialColumnMaxX !== undefined ||
              alternateColumnMaxX !== undefined
            );
          if (
            (initialChunk || boundedSameLineContinuation) &&
            (
              minimumInitialX !== undefined ||
              initialColumnMinX !== undefined ||
              initialColumnMaxX !== undefined ||
              alternateColumnMinX !== undefined ||
              alternateColumnMaxX !== undefined
            )
          ) {
            const insidePrimary =
              (initialColumnMinX === undefined ||
                candidate.x >= initialColumnMinX - TABLE_COLUMN_BOUNDARY_TOLERANCE_PT) &&
              (initialColumnMaxX === undefined ||
                candidate.x <= initialColumnMaxX + TABLE_COLUMN_BOUNDARY_TOLERANCE_PT);
            const insideAlternate = !/^\d$/u.test(expectedCharacters[0] ?? "") &&
              (alternateColumnMinX !== undefined || alternateColumnMaxX !== undefined) &&
              (alternateColumnMinX === undefined ||
                candidate.leftX >= alternateColumnMinX - TABLE_COLUMN_BOUNDARY_TOLERANCE_PT) &&
              (alternateColumnMaxX === undefined ||
                candidate.leftX <= alternateColumnMaxX + TABLE_COLUMN_BOUNDARY_TOLERANCE_PT);
            const insideRowDomain =
              (minimumInitialX === undefined ||
                candidate.leftX >= minimumInitialX - TABLE_COLUMN_BOUNDARY_TOLERANCE_PT) &&
              (
                (
                  initialColumnMaxX === undefined ||
                  candidate.x <= initialColumnMaxX + TABLE_COLUMN_BOUNDARY_TOLERANCE_PT
                ) ||
                (
                  alternateColumnMaxX !== undefined &&
                  candidate.leftX <= alternateColumnMaxX + TABLE_COLUMN_BOUNDARY_TOLERANCE_PT
                )
              );
            return insidePrimary || insideAlternate || insideRowDomain;
          }
          return Math.abs(candidateX(candidate) - targetX) <=
            continuationXTolerance;
        };
        lineCandidates.sort((left, right) => {
          if (targetX !== undefined) {
            const leftDistance = Math.abs(candidateX(left) - targetX);
            const rightDistance = Math.abs(candidateX(right) - targetX);
            const leftInColumn = isWithinTargetColumn(left);
            const rightInColumn = isWithinTargetColumn(right);
            if (leftInColumn !== rightInColumn) {
              return leftInColumn ? -1 : 1;
            }
            return right.length - left.length ||
              leftDistance - rightDistance ||
              candidateRowDistance(left) - candidateRowDistance(right) ||
              left.characterIndex - right.characterIndex;
          }
          if (initialChunk && preserveLeftmostAcrossLines) {
            return left.leftX - right.leftX || right.length - left.length;
          }
          return right.length - left.length ||
            candidateRowDistance(left) - candidateRowDistance(right) ||
            left.characterIndex - right.characterIndex;
        });
        const bestOnLine = lineCandidates[0];
        if (!bestOnLine) {
          continue;
        }
        const bestX = initialChunk ? bestOnLine.x : bestOnLine.leftX;
        const fallbackX = initialChunk ? fallback?.x : fallback?.leftX;
        const prefersSameColumn = targetX !== undefined && fallback !== undefined &&
          fallbackX !== undefined &&
          (
            Math.abs(bestX - targetX) < Math.abs(fallbackX - targetX) ||
            (
              Math.abs(bestX - targetX) === Math.abs(fallbackX - targetX) &&
              (bestOnLine.length > fallback.length ||
                (bestOnLine.length === fallback.length &&
                  bestOnLine.lineIndex < fallback.lineIndex))
            )
          );
        if (
          !fallback ||
          (targetX === undefined && bestOnLine.length > fallback.length) ||
          prefersSameColumn
        ) {
          fallback = bestOnLine;
        }
        const acceptable = bestOnLine.length >= minimumInitialRun && (
          targetX === undefined || isWithinTargetColumn(bestOnLine)
        );
        if (acceptable) {
          if (initialChunk && preferEarliestInitialSegment) {
            // 多个硬换行片段可能围绕同行首列的垂直中心分布，并共享相同
            // 首字。行列坐标已经把搜索限制在当前单元格后，首段应保留
            // 最早候选；否则靠近行中心的第二段会抢占起点，后续再串入
            // 下一表格行中的同名尾字。
            if (
              !selected ||
              bestOnLine.lineIndex < selected.lineIndex ||
              (
                bestOnLine.lineIndex === selected.lineIndex &&
                bestOnLine.length > selected.length
              )
            ) {
              selected = bestOnLine;
            }
          } else if (initialChunk && preferLeftmostInitial) {
            // 同一行首列可能被 Office 拆成 D / WS 这类多条视觉行。
            // 当前行起点已经由上一行 high-water 限定，优先保留最早的
            // 合法首字符，再沿列方向续接；否则稍后正文中的完整同名词
            // 会仅凭更长前缀夺走行锚点，并使其余列发生级联错配。
            if (
              !selected ||
              bestOnLine.lineIndex < selected.lineIndex ||
              (
                bestOnLine.lineIndex === selected.lineIndex &&
                bestOnLine.length > selected.length
              )
            ) {
              selected = bestOnLine;
            }
          } else if (initialChunk && preserveLeftmostAcrossLines) {
            // 首列没有历史列锚点时，以明显更靠左的候选确定列域；同一
            // 近似列内保留较早视觉行，避免稍后的长同前缀跨列抢占。
            // 窄表头的后续 ASCII 列也复用该规则，但只能在当前逻辑行
            // 的垂直域内竞争，不能被下方数据行中更靠左的同前缀夺走。
            const bestInsideRow = preferredRowY === undefined ||
              candidateRowDistance(bestOnLine) <=
                TABLE_ROW_CANDIDATE_VERTICAL_DOMAIN_PT;
            const selectedInsideRow = selected === undefined ||
              preferredRowY === undefined ||
              candidateRowDistance(selected) <=
                TABLE_ROW_CANDIDATE_VERTICAL_DOMAIN_PT;
            if (
              !selected ||
              (
                bestInsideRow &&
                !selectedInsideRow &&
                Math.abs(bestOnLine.leftX - selected.leftX) >
                  TABLE_COLUMN_CENTER_TOLERANCE_PT
              ) ||
              (
                bestInsideRow === selectedInsideRow &&
                bestOnLine.leftX <
                  selected.leftX - TABLE_COLUMN_CENTER_TOLERANCE_PT &&
                (
                  selected.length < remainingLength ||
                  bestOnLine.length >= selected.length
                )
              )
            ) {
              selected = bestOnLine;
            }
          } else {
            const selectedX = selected === undefined
              ? undefined
              : candidateX(selected);
            const bestDistance = targetX === undefined
              ? undefined
              : Math.abs(candidateX(bestOnLine) - targetX);
            const selectedDistance = targetX === undefined || selectedX === undefined
              ? undefined
              : Math.abs(selectedX - targetX);
            const bestContinuationRowDistance =
              candidateContinuationRowDistance(bestOnLine);
            const selectedContinuationRowDistance = selected === undefined
              ? Number.POSITIVE_INFINITY
              : candidateContinuationRowDistance(selected);
            const crossPageContinuationCandidate =
              !initialChunk &&
              continuationReferencePosition !== undefined &&
              selected !== undefined &&
              lines[continuationReferencePosition.lineIndex]?.pageNumber !==
                lines[selected.lineIndex]?.pageNumber &&
              lines[bestOnLine.lineIndex]?.pageNumber ===
                lines[selected.lineIndex]?.pageNumber &&
              (
                Math.abs(
                  (lines[bestOnLine.lineIndex]?.line.bounds.y ?? 0) -
                    (lines[selected.lineIndex]?.line.bounds.y ?? 0),
                ) <= Math.max(
                  lines[bestOnLine.lineIndex]?.line.bounds.height ?? 0,
                  lines[selected.lineIndex]?.line.bounds.height ?? 0,
                ) * 2.5 ||
                (
                  bestOnLine.characterIndex === 0 &&
                  bestOnLine.length ===
                    (lineCharacters[bestOnLine.lineIndex]?.length ?? 0)
                )
              );
            const sameAnchoredContinuationPageCandidate =
              !initialChunk &&
              continuationReferencePosition !== undefined &&
              selected !== undefined &&
              preferredContinuationPageNumber !== undefined &&
              lines[continuationReferencePosition.lineIndex]?.pageNumber !==
                preferredContinuationPageNumber &&
              lines[selected.lineIndex]?.pageNumber ===
                preferredContinuationPageNumber &&
              lines[bestOnLine.lineIndex]?.pageNumber ===
                preferredContinuationPageNumber;
            const closerAnchoredContinuationCandidate =
              sameAnchoredContinuationPageCandidate &&
              bestContinuationRowDistance <
              selectedContinuationRowDistance -
                  TABLE_COLUMN_BOUNDARY_TOLERANCE_PT;
            const completeCrossPageHardBreakSegmentCandidate =
              !initialChunk &&
              segments.length > 1 &&
              expectedIndex === 0 &&
              continuationReferencePosition !== undefined &&
              selected !== undefined &&
              lines[continuationReferencePosition.lineIndex]?.pageNumber !==
                lines[selected.lineIndex]?.pageNumber &&
              lines[bestOnLine.lineIndex]?.pageNumber ===
                lines[selected.lineIndex]?.pageNumber &&
              selected.length < remainingLength &&
              bestOnLine.length === remainingLength;
            if (
              !selected ||
              (
                bestOnLine.length > selected.length &&
                (
                  initialChunk ||
                  bestOnLine.lineIndex === selected.lineIndex ||
                  crossPageContinuationCandidate ||
                  closerAnchoredContinuationCandidate ||
                  completeCrossPageHardBreakSegmentCandidate ||
                  !preferEarliestSamePageContinuation
                ) &&
                (
                  !initialChunk ||
                  preferredRowY === undefined ||
                  candidateRowDistance(bestOnLine) <=
                    Math.max(
                      candidateRowDistance(selected) +
                        TABLE_COLUMN_BOUNDARY_TOLERANCE_PT,
                      TABLE_ROW_CANDIDATE_VERTICAL_DOMAIN_PT,
                    )
                )
              ) ||
              (
                initialChunk &&
                preferredRowY !== undefined &&
                candidateRowDistance(selected) >
                  TABLE_ROW_CANDIDATE_VERTICAL_DOMAIN_PT &&
                candidateRowDistance(bestOnLine) <
                  candidateRowDistance(selected) -
                    TABLE_COLUMN_BOUNDARY_TOLERANCE_PT
              ) ||
              (
                bestOnLine.length === selected.length &&
                initialChunk &&
                preferredRowY !== undefined &&
                candidateRowDistance(bestOnLine) <
                  candidateRowDistance(selected) -
                    TABLE_COLUMN_BOUNDARY_TOLERANCE_PT
              ) ||
              (
                bestOnLine.length === selected.length &&
                sameAnchoredContinuationPageCandidate &&
                bestContinuationRowDistance <
                  selectedContinuationRowDistance -
                    TABLE_COLUMN_BOUNDARY_TOLERANCE_PT
              ) ||
              (
                bestOnLine.length === selected.length &&
                crossPageContinuationCandidate &&
                bestDistance !== undefined &&
                selectedDistance !== undefined &&
                bestDistance <
                  selectedDistance - TABLE_COLUMN_BOUNDARY_TOLERANCE_PT
              ) ||
              (
                !initialChunk &&
                preferCenterContinuation &&
                bestOnLine.length === selected.length &&
                lines[bestOnLine.lineIndex]?.pageNumber ===
                  lines[selected.lineIndex]?.pageNumber &&
                Math.abs(
                  (lines[bestOnLine.lineIndex]?.line.bounds.y ?? 0) -
                    (lines[selected.lineIndex]?.line.bounds.y ?? 0),
                ) <= Math.max(
                  lines[bestOnLine.lineIndex]?.line.bounds.height ?? 0,
                  lines[selected.lineIndex]?.line.bounds.height ?? 0,
                ) * 2 &&
                bestDistance !== undefined &&
                selectedDistance !== undefined &&
                bestDistance < selectedDistance
              )
            ) {
              selected = bestOnLine;
            }
          }
          if (
            searchingInitialChunk &&
            !preferLeftmostInitial &&
            anchorX !== undefined &&
            expectedCharacters.length >= 2 &&
            expectedCharacters.slice(0, 2).every((character) =>
              /[A-Za-z0-9_]/u.test(character)
            ) &&
            bestOnLine.length >= Math.min(2, remainingLength) &&
            (
              preferredRowY === undefined ||
              candidateRowDistance(bestOnLine) <=
                TABLE_ROW_CANDIDATE_VERTICAL_DOMAIN_PT
            )
          ) {
            selected = bestOnLine;
            break;
          }
          if (!preferBestWithinWindow) {
            break;
          }
        }
      }

      selected ??= anchorX === undefined && continuationLeftX === undefined
        ? fallback
        : undefined;
      if (!selected) {
        break;
      }
      anchorX ??= selected.x;
      continuationLeftX ??= selected.leftX;
      for (let offset = 0; offset < selected.length; offset += 1) {
        lastPosition = {
          lineIndex: selected.lineIndex,
          characterIndex: selected.characterIndex + offset,
          character: expectedCharacters[expectedIndex + offset]!,
        };
        positions.push(lastPosition);
      }
      expectedIndex += selected.length;
      searchCursor = expectedIndex < expectedCharacters.length
        ? {
          lineIndex: selected.lineIndex,
          characterIndex: selected.characterIndex + selected.length,
        }
        : {
          lineIndex: selected.lineIndex,
          characterIndex: selected.characterIndex + selected.length,
        };
    }
    if (expectedIndex < expectedCharacters.length || !lastPosition) {
      return { matched: false, positions };
    }
    segmentStart = {
      lineIndex: lastPosition.lineIndex,
      characterIndex: lastPosition.characterIndex + 1,
    };
  }
  return { matched: true, positions };
}

function compareCursor(left: MatchCursor, right: MatchCursor): number {
  return left.lineIndex - right.lineIndex ||
    left.characterIndex - right.characterIndex;
}

function cursorAfterPositions(
  positions: readonly MatchedCharacterPosition[],
): MatchCursor | undefined {
  const last = positions.reduce<MatchedCharacterPosition | undefined>(
    (maximum, position) =>
      !maximum ||
        position.lineIndex > maximum.lineIndex ||
        (
          position.lineIndex === maximum.lineIndex &&
          position.characterIndex > maximum.characterIndex
        )
        ? position
        : maximum,
    undefined,
  );
  return last
    ? { lineIndex: last.lineIndex, characterIndex: last.characterIndex + 1 }
    : undefined;
}

function finishActiveTable(state: ParagraphMatchState): void {
  if (state.tableHighWater && compareCursor(state.tableHighWater, state.cursor) > 0) {
    state.cursor.lineIndex = state.tableHighWater.lineIndex;
    state.cursor.characterIndex = state.tableHighWater.characterIndex;
  }
  delete state.activeTableGroupId;
  delete state.activeTableRowIndex;
  delete state.activeTableRowAnchorLineIndex;
  delete state.activeTableRowContinuationPageNumber;
  delete state.activeTableRowContinuationBaselineY;
  delete state.activeTableRowLastColumnIndex;
  delete state.activeTableRowLastColumnCenter;
  delete state.activeTableRowLastColumnRight;
  delete state.tableStart;
  delete state.tableRowStart;
  delete state.tableHighWater;
  state.tableColumnAnchors.clear();
  state.tableColumnLeftAnchors.clear();
  state.occupiedTableCharacters.clear();
}

function matchedPositionsBounds(
  positions: readonly MatchedCharacterPosition[],
  lines: readonly PdfEditableContentLine[],
): PdfPointBounds | undefined {
  const firstLineIndex = positions[0]?.lineIndex;
  if (firstLineIndex === undefined) {
    return undefined;
  }
  const firstLinePositions = positions.filter(
    (position) => position.lineIndex === firstLineIndex,
  );
  const firstLine = lines[firstLineIndex];
  if (
    !firstLine ||
    firstLine.line.items.length === 0 ||
    firstLinePositions.length === 0
  ) {
    return undefined;
  }
  const bounds = matchedLineItems(
    firstLine.line,
    firstLine.normalizedText,
    {
      start: Math.min(...firstLinePositions.map((position) => position.characterIndex)),
      end: Math.max(...firstLinePositions.map((position) => position.characterIndex)) + 1,
    },
    "table-cell",
  ).bounds;
  return bounds;
}

function observeParagraph(
  expectation: EditableParagraphExpectation,
  lines: readonly PdfEditableContentLine[],
  lineCharacters: readonly string[][],
  state: ParagraphMatchState,
): PdfParagraphLayoutObservation {
  const expectedCharacters = Array.from(
    normalizePdfEditableText(expectation.text),
  );
  const mathCharacterIndexes = new Set(expectation.mathCharacterIndexes ?? []);
  const matchedByLine = new Map<number, string[]>();
  const matchedRanges = new Map<number, MatchedCharacterRange>();
  let matchedPositions: MatchedCharacterPosition[] = [];
  let matchedCursor: MatchCursor = { ...state.cursor };
  let matched = expectedCharacters.length === 0;
  const interleavedTableCell =
    expectation.blockKind === "table-cell" ||
    expectation.blockKind === "table-header";
  if (interleavedTableCell) {
    const tableGroupId = expectation.tableGroupId ?? "__implicit-table__";
    if (state.activeTableGroupId !== tableGroupId) {
      finishActiveTable(state);
      state.activeTableGroupId = tableGroupId;
      state.tableStart = { ...state.cursor };
    }
    const tableRowIndex = expectation.tableRowIndex;
    const tableColumnIndex = expectation.tableColumnIndex;
    const hasStableTableCoordinates =
      tableRowIndex !== undefined && tableColumnIndex !== undefined;
    if (
      hasStableTableCoordinates &&
      state.activeTableRowIndex !== tableRowIndex
    ) {
      state.activeTableRowIndex = tableRowIndex;
      delete state.activeTableRowAnchorLineIndex;
      delete state.activeTableRowContinuationPageNumber;
      delete state.activeTableRowContinuationBaselineY;
      delete state.activeTableRowLastColumnIndex;
      delete state.activeTableRowLastColumnCenter;
      delete state.activeTableRowLastColumnRight;
      state.tableRowStart = {
        ...(state.tableHighWater ?? state.tableStart ?? state.cursor),
      };
    }
    const tableMatchStart = hasStableTableCoordinates
        ? state.activeTableRowAnchorLineIndex === undefined
          ? state.tableRowStart ?? state.tableStart ?? state.cursor
          : {
            lineIndex: Math.max(
              state.tableRowStart?.lineIndex ?? 0,
              state.activeTableRowAnchorLineIndex -
                TABLE_ROW_INITIAL_LINE_TOLERANCE,
            ),
              characterIndex: 0,
            }
        : state.tableStart ?? state.cursor;
    const preferredColumnX = tableColumnIndex === undefined
      ? undefined
      : state.tableColumnAnchors.get(tableColumnIndex);
    const currentColumnLeftX = tableColumnIndex === undefined
      ? undefined
      : state.tableColumnLeftAnchors.get(tableColumnIndex);
    const nextColumnLeftX = tableColumnIndex === undefined
      ? undefined
      : state.tableColumnLeftAnchors.get(tableColumnIndex + 1);
    const previousColumnLeftX = tableColumnIndex === undefined
      ? undefined
      : state.tableColumnLeftAnchors.get(tableColumnIndex - 1);
    const inferredColumnRightX = nextColumnLeftX !== undefined
      ? nextColumnLeftX - TABLE_COLUMN_BOUNDARY_TOLERANCE_PT * 2
      : currentColumnLeftX !== undefined && previousColumnLeftX !== undefined
        ? currentColumnLeftX + (currentColumnLeftX - previousColumnLeftX)
        : undefined;
    const advancesStableColumn =
      hasStableTableCoordinates &&
      state.activeTableRowLastColumnIndex !== undefined &&
      tableColumnIndex !== undefined &&
      tableColumnIndex > state.activeTableRowLastColumnIndex;
    const repeatedStableCell =
      hasStableTableCoordinates &&
      state.activeTableRowLastColumnIndex === tableColumnIndex;
    // 表头常为短文本，使用中心点可以区分居中列；正文单元格可能是很长的
    // 行内代码并跨多条视觉行，其中心会随每行长度漂移，因此正文复用已经
    // 学到的列左边界。这样同行其他列被 PDF.js 合并时也不会串列。同一稳定
    // 单元格内的连续段落可能分别居左、居中或居右，不能把首段左边界继续当成
    // 后续段落的横向锚点；字符占用与行序约束仍会阻止回退到已经匹配的段落。
    const preferredTableMatchX = repeatedStableCell
      ? undefined
      : expectation.blockKind === "table-header"
        ? preferredColumnX
        : currentColumnLeftX ?? preferredColumnX;
    const attempt = matchInterleavedTableCellSegments(
      tableMatchStart,
      expectation.hardBreakSegments ?? [expectation.text],
      lines,
      lineCharacters,
      state.occupiedTableCharacters,
      preferredTableMatchX,
      state.activeTableRowAnchorLineIndex === undefined
        ? hasStableTableCoordinates
          ? tableMatchStart.lineIndex + TABLE_ROW_START_SEARCH_LINE_TOLERANCE
          : undefined
        : state.activeTableRowAnchorLineIndex +
          TABLE_ROW_INITIAL_LINE_TOLERANCE,
      advancesStableColumn
        ? state.activeTableRowLastColumnRight
        : undefined,
      undefined,
      preferredColumnX === undefined ||
          state.tableColumnAnchors.get((tableColumnIndex ?? 0) + 1) === undefined
        ? undefined
        : (
          preferredColumnX +
          state.tableColumnAnchors.get((tableColumnIndex ?? 0) + 1)!
        ) / 2,
      undefined,
      inferredColumnRightX,
      hasStableTableCoordinates &&
        tableColumnIndex === 0 &&
        expectedCharacters.length <= 8,
      expectation.blockKind === "table-header" &&
        preferredColumnX === undefined,
      expectation.blockKind === "table-header"
        ? TABLE_HEADER_CONTINUATION_X_TOLERANCE_PT
        : TABLE_COLUMN_CENTER_TOLERANCE_PT,
      expectation.blockKind === "table-header",
      expectation.blockKind === "table-cell" && hasStableTableCoordinates,
      state.activeTableRowAnchorLineIndex === undefined || advancesStableColumn
        ? undefined
        : lines[state.activeTableRowAnchorLineIndex]?.pageNumber,
      state.activeTableRowAnchorLineIndex === undefined
        ? undefined
        : lines[state.activeTableRowAnchorLineIndex]?.line.baselineY,
      state.activeTableRowContinuationPageNumber,
      state.activeTableRowContinuationBaselineY,
      hasStableTableCoordinates &&
        (expectation.hardBreakSegments?.filter((segment) =>
          normalizePdfEditableText(segment).length > 0
        ).length ?? 0) > 2,
    );
    const clippedTrailingIdentifier =
      expectation.blockKind === "table-header" &&
      /^[A-Za-z_][A-Za-z0-9_]{11,}$/u.test(expectation.text) &&
      attempt.positions.length < expectedCharacters.length &&
      attempt.positions.length / expectedCharacters.length >=
        TABLE_HEADER_MIN_CLIPPED_IDENTIFIER_COVERAGE &&
      attempt.positions.every(
        (position, index) => position.character === expectedCharacters[index],
      ) &&
      (() => {
        const last = attempt.positions.at(-1);
        return last !== undefined &&
          last.characterIndex ===
            (lineCharacters[last.lineIndex]?.length ?? 0) - 1;
      })();
    matched = attempt.matched || clippedTrailingIdentifier;
    matchedPositions = attempt.positions;
    if (matched) {
      for (const position of matchedPositions) {
        state.occupiedTableCharacters.add(
          `${position.lineIndex}:${position.characterIndex}`,
        );
      }
      const highWater = cursorAfterPositions(matchedPositions);
      if (
        highWater &&
        (!state.tableHighWater || compareCursor(highWater, state.tableHighWater) > 0)
      ) {
        state.tableHighWater = highWater;
      }
      if (
        hasStableTableCoordinates &&
        state.activeTableRowAnchorLineIndex === undefined
      ) {
        state.activeTableRowAnchorLineIndex = Math.min(
          ...matchedPositions.map((position) => position.lineIndex),
        );
      }
      if (hasStableTableCoordinates && state.activeTableRowAnchorLineIndex !== undefined) {
        const anchorPageNumber =
          lines[state.activeTableRowAnchorLineIndex]?.pageNumber;
        const continuationPositions = matchedPositions.filter((position) =>
          anchorPageNumber !== undefined &&
          (lines[position.lineIndex]?.pageNumber ?? anchorPageNumber) >
            anchorPageNumber
        );
        const continuationPageNumber = continuationPositions.reduce(
          (maximum, position) => Math.max(
            maximum,
            lines[position.lineIndex]?.pageNumber ?? maximum,
          ),
          state.activeTableRowContinuationPageNumber ?? anchorPageNumber ?? 0,
        );
        const continuationLine = continuationPositions
          .filter((position) =>
            lines[position.lineIndex]?.pageNumber === continuationPageNumber
          )
          .reduce<MatchedCharacterPosition | undefined>(
            (minimum, position) =>
              minimum === undefined || position.lineIndex < minimum.lineIndex
                ? position
                : minimum,
            undefined,
          );
        if (continuationLine !== undefined) {
          const continuationBaselineY =
            lines[continuationLine.lineIndex]?.line.baselineY;
          if (continuationBaselineY !== undefined) {
            state.activeTableRowContinuationPageNumber = continuationPageNumber;
            state.activeTableRowContinuationBaselineY = continuationBaselineY;
          }
        }
      }
      const matchedBounds = matchedPositionsBounds(matchedPositions, lines);
      if (hasStableTableCoordinates && matchedBounds !== undefined) {
        state.activeTableRowLastColumnIndex = tableColumnIndex;
        state.activeTableRowLastColumnCenter =
          matchedBounds.x + matchedBounds.width / 2;
        state.activeTableRowLastColumnRight =
          matchedBounds.x + matchedBounds.width;
      }
      if (
        tableColumnIndex !== undefined &&
        !state.tableColumnAnchors.has(tableColumnIndex)
      ) {
        if (matchedBounds !== undefined) {
          state.tableColumnAnchors.set(
            tableColumnIndex,
            matchedBounds.x + matchedBounds.width / 2,
          );
          state.tableColumnLeftAnchors.set(tableColumnIndex, matchedBounds.x);
        }
      } else if (tableColumnIndex !== undefined && matchedBounds !== undefined) {
        state.tableColumnLeftAnchors.set(
          tableColumnIndex,
          Math.min(
            state.tableColumnLeftAnchors.get(tableColumnIndex) ??
              matchedBounds.x,
            matchedBounds.x,
          ),
        );
      }
    }
  } else {
    finishActiveTable(state);
    const searchCursor: MatchCursor = { ...state.cursor };
    while (!matched && searchCursor.lineIndex < lineCharacters.length) {
      if (
        (lineCharacters[searchCursor.lineIndex]?.[
          searchCursor.characterIndex
        ] === expectedCharacters[0] ||
          (mathCharacterIndexes.has(0) &&
            /^\p{L}$/u.test(
              lineCharacters[searchCursor.lineIndex]?.[
                searchCursor.characterIndex
              ] ?? "",
            ) &&
            /^\p{L}$/u.test(expectedCharacters[0] ?? "")))
      ) {
        const attempt = matchContiguousCharacters(
          searchCursor,
          expectedCharacters,
          lineCharacters,
          mathCharacterIndexes,
        );
        if (attempt.positions.length > matchedPositions.length) {
          matchedPositions = attempt.positions;
        }
        if (attempt.positions.length === expectedCharacters.length) {
          matched = true;
          matchedPositions = attempt.positions;
          matchedCursor = attempt.cursor;
          break;
        }
      }
      if (!advanceCursor(searchCursor, lineCharacters)) {
        break;
      }
    }
  }

  for (const position of matchedPositions) {
    const matches = matchedByLine.get(position.lineIndex) ?? [];
    matches.push(position.character);
    matchedByLine.set(position.lineIndex, matches);
    const range = matchedRanges.get(position.lineIndex);
    matchedRanges.set(position.lineIndex, {
      start: Math.min(
        range?.start ?? position.characterIndex,
        position.characterIndex,
      ),
      end: Math.max(
        range?.end ?? position.characterIndex + 1,
        position.characterIndex + 1,
      ),
    });
  }
  const matchedCharacterCount = matchedPositions.length;

  const matchedLineIndexes = [...matchedByLine.keys()];
  const matchedLines = matchedLineIndexes.flatMap((index) =>
    lines[index] ? [lines[index]] : [],
  );
  const lineTexts = matchedLineIndexes.map((index) =>
    (matchedByLine.get(index) ?? []).join(""),
  );
  let cumulativeCharacters = 0;
  const lineBreakOffsets = lineTexts.slice(0, -1).map((text) => {
    cumulativeCharacters += Array.from(text).length;
    return cumulativeCharacters;
  });
  const baselineGaps = matchedLines.slice(1).flatMap((line, index) => {
    const previous = matchedLines[index];
    return previous && previous.pageNumber === line.pageNumber
      ? [line.line.baselineY - previous.line.baselineY]
      : [];
  });
  const pageNumbers = [...new Set(matchedLines.map((line) => line.pageNumber))];
  const firstLine = matchedLines[0];
  const averageLineHeightPt = average(
    matchedLines.map((line) => line.line.bounds.height),
  );
  const averageBaselineGapPt = average(baselineGaps);
  const exclusiveGeometry = matchedLineIndexes.every(
    (index) =>
      Array.from(lines[index]?.normalizedText ?? "").length ===
      (matchedByLine.get(index)?.length ?? 0),
  );
  const visualLines = matchedLines.map((line, index) => {
    const matched = matchedLineItems(
      line.line,
      line.normalizedText,
      matchedRanges.get(matchedLineIndexes[index]!),
      expectation.blockKind,
    );
    return {
      pageNumber: line.pageNumber,
      bounds: matched.bounds,
      fontFamilies: [
      ...new Set(
        matched.items.flatMap((item) =>
          item.fontFamily ? [item.fontFamily] : [],
        ),
      ),
    ].sort(),
    };
  });
  if (matched && !interleavedTableCell) {
    state.cursor.lineIndex = matchedCursor.lineIndex;
    state.cursor.characterIndex = matchedCursor.characterIndex;
  }
  return {
    matched,
    matchedCharacterCount,
    expectedCharacterCount: expectedCharacters.length,
    pageNumbers,
    lineCount: matchedLines.length,
    lineTexts,
    lineBreakOffsets,
    ...(firstLine
      ? {
          firstLineXPt: visualLines[0]!.bounds.x,
          firstLineBaselineYPt: firstLine.line.baselineY,
        }
      : {}),
    ...(average(visualLines.map((line) => line.bounds.width)) === undefined
      ? {}
      : {
          maximumLineWidthPt: Math.max(
            ...visualLines.map((line) => line.bounds.width),
          ),
        }),
    ...(averageLineHeightPt === undefined
      ? {}
      : { averageLineHeightPt }),
    ...(averageBaselineGapPt === undefined
      ? {}
      : { averageBaselineGapPt }),
    exclusiveGeometry,
    visualLines,
  };
}

function delta(
  baseline: number | undefined,
  candidate: number | undefined,
): number | undefined {
  return baseline === undefined || candidate === undefined
    ? undefined
    : Math.abs(baseline - candidate);
}

function trailingLineCharacterCount(
  observation: PdfParagraphLayoutObservation,
): number {
  return Array.from(observation.lineTexts.at(-1) ?? "").length;
}

function allowsBodyTextReflow(expectation: EditableParagraphExpectation) {
  return expectation.section === "body" && [
    "paragraph",
    "list-item",
    "block-quote",
  ].includes(expectation.blockKind ?? "paragraph");
}

function isBodyNearBoundaryLineCountDifference(
  expectation: EditableParagraphExpectation,
  baseline: PdfParagraphLayoutObservation,
  candidate: PdfParagraphLayoutObservation,
): boolean {
  if (
    expectation.section !== "body" ||
    expectation.role !== "body" ||
    baseline.expectedCharacterCount < BODY_NEAR_BOUNDARY_MIN_CHARACTERS ||
    Math.abs(baseline.lineCount - candidate.lineCount) !== 1
  ) {
    return false;
  }

  const moreLines =
    baseline.lineCount > candidate.lineCount ? baseline : candidate;
  const trailingCharacters = trailingLineCharacterCount(moreLines);
  return (
    trailingCharacters > 0 &&
    trailingCharacters / baseline.expectedCharacterCount <=
      BODY_NEAR_BOUNDARY_MAX_TRAILING_RATIO
  );
}

function compareParagraph(
  expectation: EditableParagraphExpectation,
  baseline: PdfParagraphLayoutObservation,
  candidate: PdfParagraphLayoutObservation,
  baselineCoverPageCount: number,
  candidateCoverPageCount: number,
  baselineColumnLeftX?: number,
  candidateColumnLeftX?: number,
): VisualDiffIssue[] {
  const issues: VisualDiffIssue[] = [];
  if (!baseline.matched || !candidate.matched) {
    issues.push({
      code: "EDITABLE_PARAGRAPH_MAPPING_MISMATCH",
      severity: "failure",
      message: `第 ${expectation.index + 1} 个可编辑段落无法完整映射到 PDF 文本行`,
      details: {
        paragraphIndex: expectation.index,
        baselineCoverage:
          baseline.expectedCharacterCount === 0
            ? 1
            : baseline.matchedCharacterCount / baseline.expectedCharacterCount,
        candidateCoverage:
          candidate.expectedCharacterCount === 0
            ? 1
            : candidate.matchedCharacterCount / candidate.expectedCharacterCount,
      },
    });
    return issues;
  }
  if (baseline.lineCount !== candidate.lineCount) {
    const nearBoundary = isBodyNearBoundaryLineCountDifference(
      expectation,
      baseline,
      candidate,
    );
    issues.push({
      code: nearBoundary
        ? "BODY_LINE_COUNT_NEAR_BOUNDARY"
        : "TEXT_BLOCK_LINE_COUNT_MISMATCH",
      severity: nearBoundary ? "warning" : "failure",
      message: nearBoundary
        ? `第 ${expectation.index + 1} 个正文段落仅因末行边界产生一行差异`
        : `第 ${expectation.index + 1} 个${expectation.role === "title" ? "标题" : "段落"}行数不一致：基线 ${baseline.lineCount} 行，候选 ${candidate.lineCount} 行`,
      details: {
        paragraphIndex: expectation.index,
        role: expectation.role,
        baselineLineCount: baseline.lineCount,
        candidateLineCount: candidate.lineCount,
        ...(nearBoundary
          ? {
              trailingCharacters: trailingLineCharacterCount(
                baseline.lineCount > candidate.lineCount
                  ? baseline
                  : candidate,
              ),
              trailingRatio:
                trailingLineCharacterCount(
                  baseline.lineCount > candidate.lineCount
                    ? baseline
                    : candidate,
                ) / baseline.expectedCharacterCount,
            }
          : {}),
      },
    });
  } else {
    const maximumBreakDelta = Math.max(
      0,
      ...baseline.lineBreakOffsets.map((offset, index) =>
        Math.abs(offset - (candidate.lineBreakOffsets[index] ?? offset)),
      ),
    );
    if (maximumBreakDelta > LINE_BREAK_CHARACTER_TOLERANCE) {
      const toleratedReflow =
        allowsBodyTextReflow(expectation) &&
        maximumBreakDelta <= BODY_REFLOW_BREAK_CHARACTER_TOLERANCE;
      issues.push({
        code: "PARAGRAPH_LINE_BREAK_MISMATCH",
        severity: toleratedReflow ? "warning" : "failure",
        message: toleratedReflow
          ? `第 ${expectation.index + 1} 个正文块发生允许的跨引擎行内重排，边界偏差 ${maximumBreakDelta} 个字符`
          : `第 ${expectation.index + 1} 个段落的行内换行边界偏差 ${maximumBreakDelta} 个字符`,
        details: {
          paragraphIndex: expectation.index,
          maximumBreakDelta,
          tolerance: LINE_BREAK_CHARACTER_TOLERANCE,
          reflowTolerance: BODY_REFLOW_BREAK_CHARACTER_TOLERANCE,
          toleratedReflow,
          baselineBreaks: baseline.lineBreakOffsets.join(","),
          candidateBreaks: candidate.lineBreakOffsets.join(","),
        },
      });
    }
  }

  if (expectation.section === "cover") {
    const baselineOnCover =
      baseline.pageNumbers.length === 1 && baseline.pageNumbers[0] === 1;
    const candidateOnCover =
      candidate.pageNumbers.length === 1 && candidate.pageNumbers[0] === 1;
    const verticalDelta = delta(
      baseline.firstLineBaselineYPt,
      candidate.firstLineBaselineYPt,
    );
    if (
      !baselineOnCover ||
      !candidateOnCover ||
      (verticalDelta ?? 0) > COVER_VERTICAL_TOLERANCE_PT
    ) {
      issues.push({
        code: "COVER_LAYOUT_MISMATCH",
        severity: "failure",
        message: `第 ${expectation.index + 1} 个封面段落未保持独立封面页或纵向位置`,
        details: {
          paragraphIndex: expectation.index,
          baselinePages: baseline.pageNumbers.join(","),
          candidatePages: candidate.pageNumbers.join(","),
          verticalDeltaPt: verticalDelta ?? -1,
          tolerancePt: COVER_VERTICAL_TOLERANCE_PT,
        },
      });
    }
  } else if (baselineCoverPageCount > 0 || candidateCoverPageCount > 0) {
    const baselineOutsideCover = baseline.pageNumbers.every(
      (pageNumber) => pageNumber > baselineCoverPageCount,
    );
    const candidateOutsideCover = candidate.pageNumbers.every(
      (pageNumber) => pageNumber > candidateCoverPageCount,
    );
    if (!baselineOutsideCover || !candidateOutsideCover) {
      issues.push({
        code: "COVER_LAYOUT_MISMATCH",
        severity: "failure",
        message: `第 ${expectation.index + 1} 个正文段落回流到独立封面页`,
        details: {
          paragraphIndex: expectation.index,
          baselinePages: baseline.pageNumbers.join(","),
          candidatePages: candidate.pageNumbers.join(","),
          baselineCoverPageCount,
          candidateCoverPageCount,
        },
      });
    }
  }

  if (baseline.exclusiveGeometry && candidate.exclusiveGeometry) {
    const columnRelativeGeometry =
      expectation.tableGroupId !== undefined &&
      expectation.tableColumnIndex !== undefined &&
      baselineColumnLeftX !== undefined &&
      candidateColumnLeftX !== undefined;
    const baselineGeometryX = baseline.firstLineXPt === undefined
      ? undefined
      : baseline.firstLineXPt -
        (columnRelativeGeometry ? baselineColumnLeftX : 0);
    const candidateGeometryX = candidate.firstLineXPt === undefined
      ? undefined
      : candidate.firstLineXPt -
        (columnRelativeGeometry ? candidateColumnLeftX : 0);
    const xDelta = delta(baselineGeometryX, candidateGeometryX);
    const xTolerancePt =
      expectation.section === "cover"
        ? COVER_LINE_X_TOLERANCE_PT
        : LINE_X_TOLERANCE_PT;
    const widthDelta = delta(
      baseline.maximumLineWidthPt,
      candidate.maximumLineWidthPt,
    );
    const heightDelta = delta(
      baseline.averageLineHeightPt,
      candidate.averageLineHeightPt,
    );
    const baselineGapDelta = delta(
      baseline.averageBaselineGapPt,
      candidate.averageBaselineGapPt,
    );
    if (
      (xDelta ?? 0) > xTolerancePt ||
      (heightDelta ?? 0) > LINE_HEIGHT_TOLERANCE_PT ||
      (baselineGapDelta ?? 0) > BASELINE_GAP_TOLERANCE_PT
    ) {
      issues.push({
        code: "PARAGRAPH_LINE_GEOMETRY_MISMATCH",
        severity: "failure",
        message: `第 ${expectation.index + 1} 个段落的行几何偏差超限`,
        details: {
          paragraphIndex: expectation.index,
          xDeltaPt: xDelta ?? 0,
          xTolerancePt,
          columnRelativeGeometry,
          widthDeltaPt: widthDelta ?? 0,
          widthDeltaDiagnosticOnly: true,
          lineHeightDeltaPt: heightDelta ?? 0,
          baselineGapDeltaPt: baselineGapDelta ?? 0,
        },
      });
    }
  }
  return issues;
}

function status(issues: readonly VisualDiffIssue[]) {
  return issues.some((issue) => issue.severity === "failure")
    ? ("failed" as const)
    : issues.length > 0
      ? ("warning" as const)
      : ("passed" as const);
}

export function comparePdfEditableParagraphLayouts(
  baseline: PdfDocumentSnapshot,
  candidate: PdfDocumentSnapshot,
  expectations: readonly EditableParagraphExpectation[],
  baselinePageSemantics: readonly VisualPageSemanticExpectation[] = [],
  candidatePageSemantics: readonly VisualPageSemanticExpectation[] =
    baselinePageSemantics,
): PdfParagraphLayoutComparison[] {
  const baselineLines = buildPdfEditableContentLines(
    baseline,
    baselinePageSemantics,
  );
  const candidateLines = buildPdfEditableContentLines(
    candidate,
    candidatePageSemantics,
  );
  const baselineCharacters = baselineLines.map((line) =>
    Array.from(line.normalizedText),
  );
  const candidateCharacters = candidateLines.map((line) =>
    Array.from(line.normalizedText),
  );
  const baselineCoverPageCount = baselinePageSemantics.filter(
    (page) => page.kind === "cover",
  ).length;
  const candidateCoverPageCount = candidatePageSemantics.filter(
    (page) => page.kind === "cover",
  ).length;
  const baselineState: ParagraphMatchState = {
    cursor: { lineIndex: 0, characterIndex: 0 },
    tableColumnAnchors: new Map(),
    tableColumnLeftAnchors: new Map(),
    occupiedTableCharacters: new Set(),
  };
  const candidateState: ParagraphMatchState = {
    cursor: { lineIndex: 0, characterIndex: 0 },
    tableColumnAnchors: new Map(),
    tableColumnLeftAnchors: new Map(),
    occupiedTableCharacters: new Set(),
  };

  return expectations.map((expectation) => {
    const baselineObservation = observeParagraph(
      expectation,
      baselineLines,
      baselineCharacters,
      baselineState,
    );
    const candidateObservation = observeParagraph(
      expectation,
      candidateLines,
      candidateCharacters,
      candidateState,
    );
    const issues = compareParagraph(
      expectation,
      baselineObservation,
      candidateObservation,
      baselineCoverPageCount,
      candidateCoverPageCount,
      expectation.tableColumnIndex === undefined
        ? undefined
        : baselineState.tableColumnLeftAnchors.get(expectation.tableColumnIndex),
      expectation.tableColumnIndex === undefined
        ? undefined
        : candidateState.tableColumnLeftAnchors.get(expectation.tableColumnIndex),
    );
    return {
      expectation,
      baseline: baselineObservation,
      candidate: candidateObservation,
      status: status(issues),
      issues,
    };
  });
}
