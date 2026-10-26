import type { DocxThemeStyleSnapshot } from "./snapshot.js";
import {
  docxThemeStyleCaptureRequestSchema,
  type DocxThemeStyleCaptureAdapter,
  type DocxThemeStyleCaptureRequest
} from "./runtime.js";

export interface DocxThemeStyleSnapshotCacheOptions {
  maximumEntries?: number;
}

function waitWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) {
    return promise;
  }
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

export class DocxThemeStyleSnapshotCache {
  private readonly maximumEntries: number;
  private readonly entries =
    new Map<string, DocxThemeStyleSnapshot>();
  private readonly pending =
    new Map<string, Promise<DocxThemeStyleSnapshot>>();

  constructor(
    private readonly adapter: DocxThemeStyleCaptureAdapter,
    options: DocxThemeStyleSnapshotCacheOptions = {}
  ) {
    this.maximumEntries = options.maximumEntries ?? 32;
    if (
      !Number.isInteger(this.maximumEntries) ||
      this.maximumEntries < 1 ||
      this.maximumEntries > 1000
    ) {
      throw new Error("DOCX 主题样式缓存容量必须是 1 到 1000 的整数");
    }
  }

  capture(
    input: DocxThemeStyleCaptureRequest,
    signal?: AbortSignal
  ): Promise<DocxThemeStyleSnapshot> {
    const request =
      docxThemeStyleCaptureRequestSchema.parse(input);
    const key = this.createKey(request);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return waitWithSignal(Promise.resolve(cached), signal);
    }
    let operation = this.pending.get(key);
    if (!operation) {
      operation = this.adapter
        .captureThemeStyle(request)
        .then((snapshot) => {
          this.entries.set(key, snapshot);
          this.trim();
          return snapshot;
        })
        .finally(() => {
          this.pending.delete(key);
        });
      this.pending.set(key, operation);
    }
    return waitWithSignal(operation, signal);
  }

  invalidate(themeId?: string) {
    if (!themeId) {
      this.entries.clear();
      return;
    }
    for (const [key, snapshot] of this.entries) {
      if (snapshot.themeId === themeId) {
        this.entries.delete(key);
      }
    }
  }

  get size() {
    return this.entries.size;
  }

  private createKey(request: DocxThemeStyleCaptureRequest) {
    return `${request.themeId}:${request.themeFingerprint}`;
  }

  private trim() {
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }
}
