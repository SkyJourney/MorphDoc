import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  version: 1;
  bounds: WindowBounds;
  maximized: boolean;
}

export interface WindowSize {
  width: number;
  height: number;
}

const WINDOW_STATE_VERSION = 1;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseWindowBounds(value: unknown): WindowBounds | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const bounds = value as Partial<WindowBounds>;
  if (
    !isFiniteNumber(bounds.x) ||
    !isFiniteNumber(bounds.y) ||
    !isFiniteNumber(bounds.width) ||
    !isFiniteNumber(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return undefined;
  }
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}

export function parseWindowState(value: unknown): WindowState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const state = value as Partial<WindowState>;
  const bounds = parseWindowBounds(state.bounds);
  if (
    state.version !== WINDOW_STATE_VERSION ||
    !bounds ||
    typeof state.maximized !== "boolean"
  ) {
    return undefined;
  }
  return {
    version: WINDOW_STATE_VERSION,
    bounds,
    maximized: state.maximized
  };
}

function intersectionArea(left: WindowBounds, right: WindowBounds) {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x)
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y)
  );
  return width * height;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function centerBounds(size: WindowSize, workArea: WindowBounds): WindowBounds {
  const width = Math.min(
    Math.max(1, Math.round(size.width)),
    workArea.width
  );
  const height = Math.min(
    Math.max(1, Math.round(size.height)),
    workArea.height
  );
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
}

export function resolveWindowBounds(
  savedBounds: WindowBounds | undefined,
  workAreas: WindowBounds[],
  primaryWorkArea: WindowBounds,
  defaultSize: WindowSize,
  minimumSize: WindowSize
): WindowBounds {
  if (!savedBounds) {
    return centerBounds(defaultSize, primaryWorkArea);
  }

  let selectedArea = primaryWorkArea;
  let selectedIntersection = 0;
  for (const workArea of workAreas) {
    const area = intersectionArea(savedBounds, workArea);
    if (area > selectedIntersection) {
      selectedArea = workArea;
      selectedIntersection = area;
    }
  }

  if (selectedIntersection === 0) {
    return centerBounds(
      {
        width: Math.min(
          Math.max(savedBounds.width, minimumSize.width),
          primaryWorkArea.width
        ),
        height: Math.min(
          Math.max(savedBounds.height, minimumSize.height),
          primaryWorkArea.height
        )
      },
      primaryWorkArea
    );
  }

  const width = Math.min(
    Math.max(savedBounds.width, minimumSize.width),
    selectedArea.width
  );
  const height = Math.min(
    Math.max(savedBounds.height, minimumSize.height),
    selectedArea.height
  );
  return {
    x: clamp(
      savedBounds.x,
      selectedArea.x,
      selectedArea.x + selectedArea.width - width
    ),
    y: clamp(
      savedBounds.y,
      selectedArea.y,
      selectedArea.y + selectedArea.height - height
    ),
    width,
    height
  };
}

export async function loadWindowState(filePath: string) {
  try {
    return parseWindowState(
      JSON.parse(await readFile(filePath, "utf8")) as unknown
    );
  } catch {
    return undefined;
  }
}

export async function saveWindowState(
  filePath: string,
  state: WindowState
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
